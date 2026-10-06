import { createHash } from "node:crypto";
import { KARMA } from "@terrakin/protocol";
import {
  apply,
  bountyHeld,
  type Command,
  canonicalJson,
  createWorld,
  eventHeld,
  hashWorld,
  type Input,
  REPLAY_VERSION,
  type WorldConfig,
  type WorldState,
} from "@terrakin/sim";
import type { Store } from "./store";
import { report } from "./telemetry";

/**
 * World snapshots (RFC 0014). The log stays the truth; a snapshot is a cache of the world at one
 * `seq`, plus what the server reads from the log besides the world, so a boot can start there and
 * replay only the inputs after it. A snapshot is used only once a replay has reproduced it.
 */

/** The snapshot body's layout. A boot skips snapshots in any other format. */
export const SNAPSHOT_FORMAT = 1;
/** The most UTF-8 bytes in one `world_snapshot_part` row. Durable Object rows cap at 2 MB. */
export const PART_BYTES = 1_000_000;
/** Take a snapshot once this many inputs have been logged since the newest one. */
export const SNAPSHOT_TAIL = 50_000;
/** How many verified snapshots to keep. Newer unverified ones are kept as well. */
export const KEEP_VERIFIED = 3;
/** The most inputs one minute's sweep replays while verifying a snapshot. */
export const VERIFY_SLICE = 25_000;
/** About the most JSON one page of the staff log export holds, whatever its row count. */
export const LOG_PAGE_BYTES = 4_000_000;

/**
 * A gift, a Town Hall vote, or a bounty paid, read from the log for karma (decisions 0055 and
 * 0062). `to` is who got a gift or a bounty's pay; `proposal` is what a vote was on.
 */
export type WorldCredit =
  | { kind: "gift"; from: string; to: string; day: number }
  | { kind: "vote"; from: string; proposal: string; day: number }
  /** A bounty paid `to`. `from` is its poster, or `town` for a town bounty a maintainer confirmed. */
  | { kind: "bounty"; from: string; to: string; bounty: string; day: number };

/** The credit an accepted input earns, if any, on `day`. */
function creditFor(actor: string, command: Command, day: number): WorldCredit | undefined {
  if (command.type === "give_coins" || command.type === "give") {
    return { kind: "gift", from: actor, to: command.to, day };
  }
  if (command.type === "vote")
    return { kind: "vote", from: actor, proposal: command.proposal, day };
  if (command.type === "confirm_bounty" || command.type === "confirm_town_bounty") {
    return { kind: "bounty", from: actor, to: command.to, bounty: command.bounty, day };
  }
  return undefined;
}

/** A snapshot's `server` section: everything `LogFacts` holds, as JSON. */
export interface ServerSection {
  joinedDay: Record<string, number>;
  done: Record<string, string[]>;
  /** Putters on the day the snapshot was taken, per resident. */
  putters: Record<string, { day: number; count: number }>;
  /** Credits on `creditsFrom` or later, in log order. */
  credits: WorldCredit[];
  creditsFrom: number;
}

/**
 * What `WorldService` reads from the log besides the world: the UTC day each resident first
 * joined (the world's day at their first `join`), the command kinds each has had accepted, each
 * resident's putters today, and karma's credits. Built while the boot replays, kept up as inputs
 * commit, and saved in every snapshot's `server` section.
 */
export class LogFacts {
  readonly joinedDay = new Map<string, number>();
  readonly done = new Map<string, Set<string>>();
  /** The last accepted putter (`at`, 0 when read from the log) and how many on `day`. */
  readonly putters = new Map<string, { at: number; day: number; count: number }>();
  credits: WorldCredit[] = [];

  /**
   * Note one accepted input, with `day` the world's day after it. Credits before `creditsFrom`
   * are left out. With `today`, a putter on that day counts toward today's: the boot counts them
   * this way, while a live putter counts itself with the time it happened.
   */
  note({ actor, command }: Input, day: number, creditsFrom = -Infinity, today?: number) {
    if (command.type === "join" && !this.joinedDay.has(actor)) this.joinedDay.set(actor, day);
    const credit = day >= creditsFrom ? creditFor(actor, command, day) : undefined;
    if (credit) this.credits.push(credit);
    const kinds = this.done.get(actor);
    if (kinds) kinds.add(command.type);
    else this.done.set(actor, new Set([command.type]));
    if (command.type === "putter" && day === today) {
      const count = (this.putters.get(actor)?.count ?? 0) + 1;
      this.putters.set(actor, { at: 0, day, count });
    }
  }

  /** The `server` section for a snapshot taken on `today`. */
  section(today: number, creditsFrom: number): ServerSection {
    return {
      joinedDay: Object.fromEntries(this.joinedDay),
      done: Object.fromEntries([...this.done].map(([id, kinds]) => [id, [...kinds]])),
      putters: Object.fromEntries(
        [...this.putters]
          .filter(([, p]) => p.day === today)
          .map(([id, p]) => [id, { day: p.day, count: p.count }]),
      ),
      credits: this.credits.filter((c) => c.day >= creditsFrom),
      creditsFrom,
    };
  }

  /** Facts from a snapshot's `server` section, booting on `today`. */
  static from(section: ServerSection, today: number, creditsFrom: number): LogFacts {
    const facts = new LogFacts();
    for (const [id, day] of Object.entries(section.joinedDay)) facts.joinedDay.set(id, day);
    for (const [id, kinds] of Object.entries(section.done)) facts.done.set(id, new Set(kinds));
    for (const [id, p] of Object.entries(section.putters)) {
      if (p.day === today) facts.putters.set(id, { at: 0, day: p.day, count: p.count });
    }
    facts.credits = section.credits.filter((c) => c.day >= creditsFrom);
    return facts;
  }
}

/** 1 once a replay reproduced the snapshot, 0 until one has, -1 when one didn't or it won't load. */
export type Verified = 1 | 0 | -1;

/** A snapshot's row in `world_snapshot`. */
export interface SnapshotHeader {
  /** The world's `seq` the snapshot is at, which is also its last `world_log` row. */
  seq: number;
  format: number;
  /** The sim's `REPLAY_VERSION` when it was written. */
  replayVersion: number;
  /** `hashWorld` of its world: what `GET /v1/health` served at this `seq`. */
  hash: string;
  /** SHA-256 of the whole body, hex. */
  sha256: string;
  parts: number;
  bytes: number;
  verified: Verified;
}

/** Where snapshots are kept: two tables next to `world_log` (`SqlStore`). */
export interface SnapshotStore {
  /** Every snapshot's header, newest first. */
  list(): SnapshotHeader[];
  /** A snapshot's body: its parts, joined in order. */
  body(seq: number): string;
  /** Write a snapshot and delete the ones at `drop`, in one transaction. */
  save(header: SnapshotHeader, parts: readonly string[], drop: readonly number[]): void;
  /** Set a snapshot's `verified` and delete the ones at `drop`, in one transaction. */
  mark(seq: number, verified: 1 | -1, drop: readonly number[]): void;
}

interface SnapshotBody {
  format: number;
  world: WorldState;
  server: ServerSection;
}

/** Why a snapshot can't be used. `stale` ones are fine but not for this code; the rest are bad. */
type Unusable = "sha256" | "parse" | "seq" | "hash" | "supply" | "stale";

class SnapshotError extends Error {
  constructor(readonly code: Unusable) {
    super(`Snapshot unusable: ${code}`);
  }
}

/** A replay that stopped, in words with no resident data: only codes and `seq`s. */
class ReplayError extends Error {}

/**
 * What may be reported about an error from snapshot work. The store can throw while it reads a
 * row (`JSON.parse` quotes part of the text it choked on, which can be a name or a note), so
 * anything that isn't one of this file's own errors is reported by its kind alone.
 */
export const reportable = (err: unknown): Error =>
  err instanceof SnapshotError || err instanceof ReplayError
    ? err
    : new ReplayError(
        `Log or snapshot storage failed: ${err instanceof Error ? err.name : typeof err}`,
      );

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Cut `text` into pieces of at most `maxBytes` UTF-8 bytes each, never between the two halves of
 * a surrogate pair, so every piece is valid text on its own. Returns the pieces and the total.
 */
export function splitUtf8(text: string, maxBytes: number): { parts: string[]; bytes: number } {
  const parts: string[] = [];
  let start = 0;
  let size = 0;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    const n = c < 0x80 ? 1 : c < 0x800 ? 2 : pair ? 4 : 3;
    if (size + n > maxBytes && i > start) {
      parts.push(text.slice(start, i));
      start = i;
      size = 0;
    }
    size += n;
    total += n;
    if (pair) i++;
  }
  parts.push(text.slice(start));
  return { parts, bytes: total };
}

/**
 * The world's coins all accounted for:
 * `sum(coins) + treasury + bountyHeld + eventHeld == minted - burned`, where `eventHeld` is what
 * Commons bookings hold. Always true for a world the sim built; a boot checks it on every snapshot
 * it loads.
 */
export function supplyHolds(state: WorldState): boolean {
  const econ = state.economy;
  if (!econ) return true;
  let held = 0;
  for (const n of Object.values(econ.coins)) held += n;
  return held + econ.treasury + bountyHeld(state) + eventHeld(state) === econ.minted - econ.burned;
}

/**
 * A snapshot of `world` (whose `hashWorld` is `hash`) and the server's facts, ready to save. The
 * body is plain `JSON.stringify`, not `canonicalJson`: parsing it back rebuilds every record in
 * the order the replay made it, so the inputs after it emit events byte for byte as a straight
 * replay would.
 */
export function encodeSnapshot(
  world: WorldState,
  hash: string,
  server: ServerSection,
): { header: SnapshotHeader; parts: string[] } {
  const body = JSON.stringify({ format: SNAPSHOT_FORMAT, world, server } satisfies SnapshotBody);
  const { parts, bytes } = splitUtf8(body, PART_BYTES);
  return {
    header: {
      seq: world.seq,
      format: SNAPSHOT_FORMAT,
      replayVersion: REPLAY_VERSION,
      hash,
      sha256: sha256(body),
      parts: parts.length,
      bytes,
      verified: 0,
    },
    parts,
  };
}

/**
 * Load a snapshot and check everything a boot relies on: the body's SHA-256, that it parses, its
 * `seq`, its world hash, and the coin supply. Throws a `SnapshotError` when one fails, or `stale`
 * when it was made for another world config.
 */
function openSnapshot(store: SnapshotStore, header: SnapshotHeader, config: WorldConfig) {
  const body = store.body(header.seq);
  if (sha256(body) !== header.sha256) throw new SnapshotError("sha256");
  let parsed: SnapshotBody;
  try {
    parsed = JSON.parse(body) as SnapshotBody;
  } catch {
    throw new SnapshotError("parse");
  }
  if (parsed.format !== header.format || !parsed.world || !parsed.server) {
    throw new SnapshotError("parse");
  }
  if (parsed.world.seq !== header.seq) throw new SnapshotError("seq");
  if (hashWorld(parsed.world) !== header.hash) throw new SnapshotError("hash");
  if (!supplyHolds(parsed.world)) throw new SnapshotError("supply");
  if (canonicalJson(parsed.world.config) !== canonicalJson(config)) {
    throw new SnapshotError("stale");
  }
  return parsed;
}

/** Whether this code can boot from or verify a snapshot at all. */
const readable = (h: SnapshotHeader) =>
  h.format === SNAPSHOT_FORMAT && h.replayVersion === REPLAY_VERSION;

/** The newest verified snapshot this code can boot from, if any. */
export const newestVerified = (headers: readonly SnapshotHeader[]) =>
  headers.find((h) => h.verified === 1 && readable(h));

/**
 * Which snapshots to delete, given every header newest first: all but the newest
 * `KEEP_VERIFIED` verified ones and the unverified ones newer than those, which wait their turn.
 */
export function prunable(headers: readonly SnapshotHeader[]): number[] {
  const verified = headers.filter((h) => h.verified === 1);
  const keep = new Set(verified.slice(0, KEEP_VERIFIED).map((h) => h.seq));
  const newest = verified[0]?.seq ?? Number.NEGATIVE_INFINITY;
  for (const h of headers) if (h.verified === 0 && readable(h) && h.seq > newest) keep.add(h.seq);
  return headers.filter((h) => !keep.has(h.seq)).map((h) => h.seq);
}

/**
 * Mark a snapshot that failed, report why, and prune with it. Storage refusing the mark is
 * reported too, never thrown: a boot still has older snapshots and the first input to fall back
 * on.
 */
function fail(store: SnapshotStore, seq: number, err: unknown, where: string) {
  report(reportable(err), where);
  try {
    const headers = store.list().map((h) => (h.seq === seq ? { ...h, verified: -1 as const } : h));
    store.mark(seq, -1, prunable(headers));
  } catch (marking) {
    report(reportable(marking), where);
  }
}

/**
 * Apply the log's inputs after `state.seq` (up to `until`) to `state`, noting each in `facts`.
 * Each row's `seq` must be the next one: a gap means the log and the snapshot don't line up.
 * Returns how many inputs it applied.
 */
function replayOnto(
  store: Store,
  state: WorldState,
  facts: LogFacts,
  creditsFrom: number,
  today?: number,
  until?: number,
): number {
  let n = 0;
  store.eachInput(
    state.seq,
    (input, seq) => {
      if (seq !== state.seq + 1) throw new ReplayError(`Log skips from seq ${state.seq} to ${seq}`);
      const result = apply(state, input);
      if (!result.ok) {
        throw new ReplayError(`Replay diverged at entry ${seq - 1}: ${result.rejection.code}`);
      }
      facts.note(input, state.day ?? 0, creditsFrom, today);
      n++;
    },
    until,
  );
  return n;
}

/**
 * Rows of the log after `after`, up to `end`, for the staff export: it stops before a row that
 * would take the page past `maxBytes` of JSON, though a page always holds at least one row. `full`
 * says it stopped there.
 */
export function pageRows(store: Store, after: number, end: number, maxBytes = LOG_PAGE_BYTES) {
  const rows: { seq: number; input: Input }[] = [];
  let bytes = 0;
  let full = false;
  store.eachInput(
    after,
    (input, seq) => {
      const size = JSON.stringify(input).length;
      if (rows.length > 0 && bytes + size > maxBytes) {
        full = true;
        return false;
      }
      rows.push({ seq, input });
      bytes += size;
      return true;
    },
    end,
  );
  return { rows, full };
}

export interface Booted {
  state: WorldState;
  facts: LogFacts;
  /** The snapshot the boot started from, or undefined for the first input. */
  snapshot: SnapshotHeader | undefined;
  /** How many inputs it replayed. */
  inputs: number;
  /**
   * Whether every `world_log` row's `seq` matched the world's. Snapshots are found by row `seq`,
   * so without that they're never taken.
   */
  aligned: boolean;
}

/**
 * Rebuild the world on `today`: from the newest verified snapshot and the inputs after it, else
 * the next older one, else from the first input, one input at a time. A snapshot that fails a
 * check is reported, marked, and skipped, so a bad one can make a boot slower but never wrong.
 */
export function boot(store: Store, config: WorldConfig, today: number): Booted {
  const creditsFrom = today - KARMA.windowDays;
  const snapshots = store.snapshots;
  for (const header of snapshots?.list() ?? []) {
    if (!snapshots || header.verified !== 1 || !readable(header)) continue;
    let opened: SnapshotBody;
    try {
      opened = openSnapshot(snapshots, header, config);
    } catch (err) {
      if (err instanceof SnapshotError && err.code === "stale") continue;
      fail(snapshots, header.seq, err, "world.snapshot_boot");
      continue;
    }
    try {
      const facts = LogFacts.from(opened.server, today, creditsFrom);
      const inputs = replayOnto(store, opened.world, facts, creditsFrom, today);
      return { state: opened.world, facts, snapshot: header, inputs, aligned: true };
    } catch (err) {
      // The log after it didn't replay onto it. An older snapshot, or the first input, decides.
      report(reportable(err), "world.snapshot_boot");
    }
  }
  const state = createWorld(config);
  const facts = new LogFacts();
  let inputs = 0;
  let aligned = true;
  store.eachInput(0, (input, seq) => {
    if (seq !== state.seq + 1) aligned = false;
    const result = apply(state, input);
    if (!result.ok) {
      throw new Error(`Replay diverged at entry ${inputs}: ${result.rejection.code}`);
    }
    facts.note(input, state.day ?? 0, creditsFrom, today);
    inputs++;
  });
  if (!aligned && snapshots) {
    report(
      new ReplayError("world_log seq doesn't match the world's; snapshots are off"),
      "world.boot",
    );
  }
  return { state, facts, snapshot: undefined, inputs, aligned };
}

/** A replay in progress toward one unverified snapshot. */
interface Job {
  target: SnapshotHeader;
  /** The target's own server section, to compare with what the replay builds. */
  expect: ServerSection;
  /**
   * SHA-256 of the target's world as canonical JSON. `hashWorld` is 32 bits, too few to vouch for
   * a world on its own, so a replay has to match this too.
   */
  digest: string;
  world: WorldState;
  facts: LogFacts;
}

/** A world's SHA-256, independent of key order. */
const worldDigest = (world: WorldState) => sha256(canonicalJson(world));

/** The facts a verification compares: join days, done kinds, and credits from `creditsFrom`. */
function comparable(section: ServerSection, creditsFrom: number): string {
  const byKey = <T>(a: [string, T], b: [string, T]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return JSON.stringify([
    Object.entries(section.joinedDay).sort(byKey),
    Object.entries(section.done)
      .map(([id, kinds]): [string, string[]] => [id, [...kinds].sort()])
      .sort(byKey),
    section.credits.filter((c) => c.day >= creditsFrom),
  ]);
}

/**
 * Verifies new snapshots off the request path, a bounded slice of inputs per call, oldest
 * unverified first. A snapshot is replayed from the previous verified one, or from the first input
 * when there is none and once a week (a snapshot taken on a day where `day % 7 === 0`), which
 * also proves today's code still replays the whole log as it was made. It passes when the replay
 * reaches its `seq` with the same world hash, join days, done kinds, and credits.
 */
export class SnapshotVerifier {
  private job: Job | undefined;

  constructor(
    private readonly store: Store,
    private readonly snapshots: SnapshotStore,
    private readonly config: WorldConfig,
    private readonly slice = VERIFY_SLICE,
  ) {}

  /** Replay one slice. Returns the header of a snapshot that just passed, if one did. */
  step(): SnapshotHeader | undefined {
    const job = this.job ?? this.start();
    if (!job) return undefined;
    const { target } = job;
    const until = Math.min(target.seq, job.world.seq + this.slice);
    let moved: number;
    try {
      moved = replayOnto(
        this.store,
        job.world,
        job.facts,
        job.expect.creditsFrom,
        undefined,
        until,
      );
    } catch (err) {
      this.job = undefined;
      fail(this.snapshots, target.seq, err, "world.snapshot_verify");
      return undefined;
    }
    if (job.world.seq < target.seq) {
      if (moved > 0) return undefined;
      this.job = undefined;
      fail(
        this.snapshots,
        target.seq,
        new ReplayError("Log ends before the snapshot"),
        "world.snapshot_verify",
      );
      return undefined;
    }
    this.job = undefined;
    const same =
      hashWorld(job.world) === target.hash &&
      worldDigest(job.world) === job.digest &&
      comparable(job.facts.section(-1, job.expect.creditsFrom), job.expect.creditsFrom) ===
        comparable(job.expect, job.expect.creditsFrom);
    if (!same) {
      fail(
        this.snapshots,
        target.seq,
        new ReplayError("Snapshot doesn't match its replay"),
        "world.snapshot_verify",
      );
      return undefined;
    }
    const passed = { ...target, verified: 1 as const };
    const headers = this.snapshots.list().map((h) => (h.seq === target.seq ? passed : h));
    this.snapshots.mark(target.seq, 1, prunable(headers));
    return passed;
  }

  /** Pick the oldest unverified snapshot and where its replay starts. */
  private start(): Job | undefined {
    const headers = this.snapshots.list();
    const target = headers.findLast((h) => h.verified === 0 && readable(h));
    if (!target) return undefined;
    let opened: SnapshotBody;
    try {
      opened = openSnapshot(this.snapshots, target, this.config);
    } catch (err) {
      fail(this.snapshots, target.seq, err, "world.snapshot_verify");
      return undefined;
    }
    const expect = opened.server;
    const digest = worldDigest(opened.world);
    const base = (opened.world.day ?? 0) % 7 === 0 ? undefined : this.base(headers, target, expect);
    this.job = {
      target,
      expect,
      digest,
      ...(base ?? { world: createWorld(this.config), facts: new LogFacts() }),
    };
    return this.job;
  }

  /** The verified snapshot before `target` to replay from, if one loads and covers its credits. */
  private base(
    headers: readonly SnapshotHeader[],
    target: SnapshotHeader,
    expect: ServerSection,
  ): { world: WorldState; facts: LogFacts } | undefined {
    const header = headers.find((h) => h.verified === 1 && readable(h) && h.seq < target.seq);
    if (!header) return undefined;
    try {
      const base = openSnapshot(this.snapshots, header, this.config);
      if (base.server.creditsFrom > expect.creditsFrom) return undefined;
      return { world: base.world, facts: LogFacts.from(base.server, -1, expect.creditsFrom) };
    } catch (err) {
      // One made for another world config is fine, only not a base here.
      if (!(err instanceof SnapshotError && err.code === "stale")) {
        fail(this.snapshots, header.seq, err, "world.snapshot_verify");
      }
      return undefined;
    }
  }
}
