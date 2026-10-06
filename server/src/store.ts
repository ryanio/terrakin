import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Input } from "@terrakin/sim";
import type { SnapshotStore } from "./snapshots";

export interface SessionRecord {
  /** sha256 of the bearer token. The raw token is never stored. */
  tokenHash: string;
  residentId: string;
}

/** A resident's link key (decision 0020), or `keyHash: null` once it's turned off. */
export interface LinkKeyRecord {
  residentId: string;
  /** sha256 of the link key. The raw key is never stored. */
  keyHash: string | null;
}

/**
 * Durable storage for the world. The log of accepted inputs is the truth: on boot the server
 * replays it through the sim, from the first input or from a verified snapshot (RFC 0014). That
 * keeps one source of truth and makes every state auditable.
 */
export interface Store {
  loadLog(): Input[];
  /**
   * Call `visit` with each logged input whose `seq` is above `after` and at most `until`, oldest
   * first, holding as few as the store can, until `visit` returns `false`. An input's `seq` is its
   * place in the log, from 1. The boot replays through this, so its memory is the world's size,
   * not the log's.
   */
  eachInput(after: number, visit: InputVisitor, until?: number): void;
  appendInput(input: Input): void;
  loadSessions(): SessionRecord[];
  appendSession(session: SessionRecord): void;
  /** Link key changes, oldest first. The last record for a resident is the one that counts. */
  loadLinkKeys(): LinkKeyRecord[];
  saveLinkKey(record: LinkKeyRecord): void;
  /** Forget every session of one resident, so none of their tokens work again (owner revoke). */
  revokeSessions(residentId: string): void;
  /** Where world snapshots are kept (RFC 0014). Stores without one always boot from the first input. */
  readonly snapshots?: SnapshotStore;
}

/** Sees one logged input and its `seq`. Returning `false` stops the walk. */
export type InputVisitor = (input: Input, seq: number) => unknown;

/** A line in sessions.jsonl that ends every earlier session of `residentId`. */
interface RevocationRecord {
  revoked: string;
}

export class MemoryStore implements Store {
  readonly log: Input[] = [];
  readonly sessions: SessionRecord[] = [];
  loadLog() {
    return [...this.log];
  }
  eachInput(after: number, visit: InputVisitor, until = Infinity) {
    const end = Math.min(this.log.length, until);
    for (let i = Math.max(0, after); i < end; i++) {
      if (visit(this.log[i] as Input, i + 1) === false) return;
    }
  }
  appendInput(input: Input) {
    this.log.push(input);
  }
  loadSessions() {
    return [...this.sessions];
  }
  appendSession(session: SessionRecord) {
    this.sessions.push(session);
  }
  readonly linkKeys: LinkKeyRecord[] = [];
  loadLinkKeys() {
    return [...this.linkKeys];
  }
  saveLinkKey(record: LinkKeyRecord) {
    this.linkKeys.push(record);
  }
  revokeSessions(residentId: string) {
    const kept = this.sessions.filter((s) => s.residentId !== residentId);
    this.sessions.splice(0, this.sessions.length, ...kept);
  }
}

/**
 * Append-only JSON Lines files in a directory. Good enough for Phase 1 and trivially inspectable
 * with `cat`. Postgres replaces this once an RFC settles the schema.
 */
export class JsonlStore implements Store {
  private readonly logPath: string;
  private readonly sessionsPath: string;
  private readonly linkKeysPath: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.logPath = join(dir, "world.log.jsonl");
    this.sessionsPath = join(dir, "sessions.jsonl");
    this.linkKeysPath = join(dir, "link-keys.jsonl");
  }

  loadLog(): Input[] {
    return readJsonl<Input>(this.logPath);
  }
  eachInput(after: number, visit: InputVisitor, until = Infinity) {
    let seq = 0;
    eachJsonl<Input>(this.logPath, (input) => {
      seq++;
      if (seq <= after) return true;
      return seq <= until && visit(input, seq) !== false;
    });
  }
  appendInput(input: Input) {
    appendFileSync(this.logPath, `${JSON.stringify(input)}\n`);
  }
  loadSessions(): SessionRecord[] {
    // Append-only: a revocation line drops the sessions before it for that resident.
    let sessions: SessionRecord[] = [];
    for (const line of readJsonl<SessionRecord | RevocationRecord>(this.sessionsPath)) {
      if ("revoked" in line) sessions = sessions.filter((s) => s.residentId !== line.revoked);
      else sessions.push(line);
    }
    return sessions;
  }
  appendSession(session: SessionRecord) {
    appendFileSync(this.sessionsPath, `${JSON.stringify(session)}\n`);
  }
  loadLinkKeys(): LinkKeyRecord[] {
    return readJsonl<LinkKeyRecord>(this.linkKeysPath);
  }
  saveLinkKey(record: LinkKeyRecord) {
    appendFileSync(this.linkKeysPath, `${JSON.stringify(record)}\n`);
  }
  revokeSessions(residentId: string) {
    const line: RevocationRecord = { revoked: residentId };
    appendFileSync(this.sessionsPath, `${JSON.stringify(line)}\n`);
  }
}

/**
 * Read a JSON Lines file. A crash mid-append can leave a partial last line; that line is skipped
 * with a warning, since its input was never acknowledged. Corruption anywhere else is fatal.
 */
export function readJsonl<T>(path: string): T[] {
  const out: T[] = [];
  eachJsonl<T>(path, (value) => {
    out.push(value);
    return true;
  });
  return out;
}

/**
 * `readJsonl` one parsed line at a time, so only the file's text is held, never every value.
 * Stops when `visit` returns false.
 */
function eachJsonl<T>(path: string, visit: (value: T) => boolean) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  for (const [i, line] of lines.entries()) {
    let value: T;
    try {
      value = JSON.parse(line) as T;
    } catch (err) {
      if (i === lines.length - 1) {
        console.warn(`Skipping truncated last line of ${path}`);
        return;
      }
      throw new Error(`Corrupt line ${i + 1} in ${path}`, { cause: err });
    }
    if (!visit(value)) return;
  }
}
