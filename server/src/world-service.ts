import { createHash } from "node:crypto";
import type {
  Action,
  ChatChannel,
  ErrorCode,
  MediaType,
  ServerMessage,
  WorldEvent as WireEvent,
  WorldSnapshot,
} from "@terrakin/protocol";
import { PROTOCOL_VERSION, PUTTER_LIMITS } from "@terrakin/protocol";
import {
  apply,
  type Command,
  chebyshev,
  cloneWorld,
  commonsPlot,
  DEFAULT_CONFIG,
  hashWorld,
  type Input,
  LOOK_MEDIA_KEYS,
  type LookMediaKey,
  ownerPaired,
  type ProfileFields,
  parseKey,
  planPutter,
  prepare,
  type ResidentKind,
  replay,
  TOWN_ACTOR,
  townHallTiles,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
  withinEarshot,
} from "@terrakin/sim";
import { Moderation, type ReviewContext, type Surface } from "./moderation";
import type { Store } from "./store";
import { count, crumb, report, span } from "./telemetry";
import { cleanMultiline, cleanText } from "./text";

export type ActResult =
  | {
      ok: true;
      seq: number;
      events: WireEvent[];
      heard?: number;
      /** `putter` only: who it waved at, or null. */
      greeted?: string | null;
      dry?: true;
    }
  | { ok: false; error: { code: ErrorCode; message: string }; dry?: true };

type Listener = (message: ServerMessage) => void;

export interface WorldServiceOptions {
  store: Store;
  config?: WorldConfig;
  /** Residents with no live socket and no REST call for this long are marked offline. */
  idleTimeoutMs?: number;
  now?: () => number;
  /**
   * Count days for the Town Hall: append `new_day` when a UTC day starts (on boot and on `tick()`),
   * and `close_proposal` once a proposal's closing day has started. Both adapters turn this on.
   * Off by default so a test world's log holds only what the test sent.
   */
  days?: boolean;
  /**
   * The townsfolk grant from config. When it differs from what the world last logged, boot appends
   * a `set_townsfolk` input, so the sim (which keeps them out of every vote) sees the same list on
   * every replay. Leave it out to keep whatever the log says.
   */
  townsfolk?: ReadonlySet<string>;
  /**
   * The edge filters (RFC 0006). Pass the same one to `SocialService`, so a resident's refusals
   * add up across chat, posts, and everything else. Default: a fresh one.
   */
  moderation?: Moderation;
  /**
   * Coins (RFC 0008): once the world counts days, append `open_economy` if it never has. Both
   * adapters turn this on. Off by default so a test world's log holds only what the test sent.
   */
  economy?: boolean;
  /**
   * Maintainers' resident ids from config. Logged as `set_maintainers` when they differ from the
   * log, so the sim keeps townsfolk budgets away from them.
   */
  maintainers?: ReadonlySet<string>;
}

/**
 * What an input's sim events look like on the wire. Owner-pair and maintainer lists stay on the
 * server. A gift also shows as a public `gift` event, without the amount or note, unless
 * townsfolk are on either side: their purses reset to the budget each day, so the public
 * treasury lines would give the amount away.
 */
function toWire(events: WorldEvent[], townsfolk: readonly string[] = []): WireEvent[] {
  const out: WireEvent[] = [];
  for (const e of events) {
    if (
      e.type === "owner_pairs_set" ||
      e.type === "owner_pair_added" ||
      e.type === "owner_pair_removed" ||
      e.type === "maintainers_set"
    ) {
      continue;
    }
    out.push(e.type === "coins" && e.note ? { ...e, trust: "untrusted" } : e);
    if (
      e.type === "coins" &&
      e.reason === "gift_out" &&
      e.with &&
      !townsfolk.includes(e.residentId) &&
      !townsfolk.includes(e.with)
    ) {
      out.push({ type: "gift", from: e.residentId, to: e.with });
    }
  }
  return out;
}

/** What everyone may see: no purse moves. Never empty, so every client's `seq` keeps counting. */
function publicEvents(events: WireEvent[]): WireEvent[] {
  const shown = events.filter((e) => e.type !== "coins");
  return shown.length > 0 ? shown : [{ type: "quiet" }];
}

/** What one resident may see: everything public, plus their own purse moves. */
export function eventsFor(events: WireEvent[], viewer: string): WireEvent[] {
  return events.filter((e) => e.type !== "coins" || e.residentId === viewer);
}

/** How many residents within earshot a putter tries to wave at before it gives up. */
const PUTTER_GREET_TRIES = 5;

/** One UTC day. The Town Hall's clock ticks once per day, at midnight UTC. */
export const DAY_MS = 86_400_000;

/** UTC days since 1970-01-01. */
export const utcDay = (ms: number) => Math.floor(ms / DAY_MS);

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Web Crypto randomness, so this file runs the same on Node and Cloudflare Workers. */
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Drop absent fields (the sim's types forbid explicit undefined) and clean the note text. */
type LooseProfile = { [K in keyof ProfileFields]?: ProfileFields[K] | undefined };

function cleanProfile(fields: LooseProfile): ProfileFields {
  const out: ProfileFields = {
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.shape ? { shape: fields.shape } : {}),
    ...(fields.note !== undefined ? { note: cleanText(fields.note) } : {}),
  };
  // Look fields: absent stays absent, null (clear) is kept.
  if (fields.theme !== undefined) out.theme = fields.theme;
  if (fields.pattern !== undefined) out.pattern = fields.pattern;
  if (fields.wear !== undefined) out.wear = [...fields.wear];
  for (const key of LOOK_MEDIA_KEYS) {
    const value = fields[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** What each look media field may be: still images for art and patterns, `.glb` for models. */
const LOOK_MEDIA_TYPES: Record<LookMediaKey, { types: readonly MediaType[]; what: string }> = {
  patternMedia: {
    types: ["image/png", "image/jpeg", "image/webp"],
    what: "Your pattern must be one of your PNG, JPEG, or WebP uploads.",
  },
  homeArt: {
    types: ["image/png", "image/jpeg", "image/webp"],
    what: "Your home picture must be one of your PNG, JPEG, or WebP uploads.",
  },
  homeModel: {
    types: ["model/gltf-binary"],
    what: "Your home model must be one of your .glb uploads.",
  },
};

/** Look up the type of an upload `owner` made, or undefined if it isn't theirs (or doesn't exist). */
export type OwnedMediaType = (owner: string, mediaId: string) => MediaType | undefined;

/** Run text through the edge filters (moderation.ts). Undefined when it may go ahead. */
function filtered(
  moderation: Moderation,
  surface: Surface,
  text: string | undefined,
  context: ReviewContext,
): ActResult | undefined {
  if (text === undefined || text === "") return undefined;
  const verdict = moderation.review(surface, text, context);
  if (verdict.ok) return undefined;
  return { ok: false, error: { code: verdict.code, message: verdict.message } };
}

/**
 * One full day/night cycle. It doesn't divide 24 hours, so someone who visits at the
 * same time every day sees a different part of the day each time. Tunable; clients
 * read it from the snapshot.
 */
export const DAY_LENGTH_MS = 210 * 60_000;

/**
 * Owns the one authoritative world. Every change goes through `act` or `join`/`leave`,
 * which run the sim, persist the accepted input, and broadcast the resulting events.
 */
export class WorldService {
  readonly state: WorldState;
  private readonly store: Store;
  private readonly sessions = new Map<string, string>(); // tokenHash -> residentId
  /** Link keys (decision 0020): at most one per resident. keyHash -> residentId, and back. */
  private readonly linkKeys = new Map<string, string>();
  private readonly linkKeyOf = new Map<string, string>();
  /** residentId -> their live listeners. Chat goes only to residents within earshot. */
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly lastSeen = new Map<string, number>();
  private readonly sockets = new Map<string, number>(); // residentId -> open socket count
  /** residentId -> callbacks that close their live connections when their tokens are revoked. */
  private readonly revocationWatchers = new Map<string, Set<() => void>>();
  private readonly idleTimeoutMs: number;
  readonly now: () => number;
  private readonly days: boolean;
  private readonly economy: boolean;
  /** The edge filters for names, notes, chat, and proposals. */
  readonly moderation: Moderation;
  /**
   * The UTC day each resident first joined, read from the log (the last `new_day` before their
   * first `join`; 0 if the world wasn't counting days yet). For report weight, never for the sim.
   */
  private readonly joinedDay = new Map<string, number>();
  /**
   * Each resident's last accepted putter and how many they've had today (decision 0049). Today's
   * count is read back from the log at boot, so a restart doesn't reset the daily cap.
   */
  private readonly putters = new Map<string, { at: number; day: number; count: number }>();

  constructor(options: WorldServiceOptions) {
    this.store = options.store;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
    this.days = options.days ?? false;
    const grant = options.townsfolk;
    this.moderation =
      options.moderation ??
      new Moderation({ now: this.now, privileged: (id) => grant?.has(id) === true });
    const log = this.store.loadLog();
    this.state = replay(options.config ?? DEFAULT_CONFIG, log);
    let day = 0;
    const today = utcDay(this.now());
    for (const { actor, command } of log) {
      if (command.type === "new_day") day = command.day;
      if (command.type === "join" && !this.joinedDay.has(actor)) this.joinedDay.set(actor, day);
      if (command.type === "putter" && day === today) {
        const count = (this.putters.get(actor)?.count ?? 0) + 1;
        this.putters.set(actor, { at: 0, day, count });
      }
    }
    for (const s of this.store.loadSessions()) this.sessions.set(s.tokenHash, s.residentId);
    for (const k of this.store.loadLinkKeys()) this.rememberLinkKey(k.residentId, k.keyHash);
    // Nobody is connected right after a restart. Mark everyone offline so presence is honest.
    for (const r of Object.values(this.state.residents)) {
      if (r.online) this.run({ actor: r.id, command: { type: "leave" } });
    }
    if (options.townsfolk) this.syncTownsfolk(options.townsfolk);
    if (options.maintainers) this.syncMaintainers(options.maintainers);
    this.economy = options.economy ?? false;
    // A day may have started (and proposals come due) while the server was down.
    this.tick();
  }

  /** Log the maintainers list when config changed it. */
  private syncMaintainers(grant: ReadonlySet<string>) {
    const ids = [...grant].sort();
    if (ids.join(",") === (this.state.maintainers ?? []).join(",")) return;
    this.run({ actor: TOWN_ACTOR, command: { type: "set_maintainers", ids } });
  }

  /**
   * Log the whole owner-linked pair list when it differs from the world's (decision 0031), so
   * gifts between a person and their AI skip the daily caps. `Api` calls this once at boot, to
   * catch up on any change the log missed; each link and unlink after that logs just its own pair
   * with `addOwnerPair` and `removeOwnerPair` (decision 0042).
   */
  syncOwnerPairs(links: readonly [string, string][]) {
    const pairs = links
      .map(([a, b]): [string, string] => (a < b ? [a, b] : [b, a]))
      .sort(([a, b], [c, d]) => (a === c ? (b < d ? -1 : b > d ? 1 : 0) : a < c ? -1 : 1));
    const key = (list: readonly (readonly string[])[]) => list.map((p) => p.join("+")).join(",");
    if (key(pairs) === key(this.state.ownerPairs ?? [])) return;
    this.run({ actor: TOWN_ACTOR, command: { type: "set_owner_pairs", pairs } });
  }

  /** Log one new owner pair. Nothing is logged when the world already has it. */
  addOwnerPair(a: string, b: string) {
    if (a === b || ownerPaired(this.state, a, b)) return;
    const done = this.run({ actor: TOWN_ACTOR, command: { type: "add_owner_pair", pair: [a, b] } });
    if (!done.ok) console.error(`Couldn't add an owner pair: ${done.error.message}`);
  }

  /** Log one owner pair ending. Nothing is logged when the world doesn't have it. */
  removeOwnerPair(a: string, b: string) {
    if (!ownerPaired(this.state, a, b)) return;
    const done = this.run({
      actor: TOWN_ACTOR,
      command: { type: "remove_owner_pair", pair: [a, b] },
    });
    if (!done.ok) console.error(`Couldn't remove an owner pair: ${done.error.message}`);
  }

  /** Whether two residents block each other, from the social layer. Gifts can't cross a block. */
  blockedEither: (a: string, b: string) => boolean = () => false;

  /**
   * Send a putter's wave from one resident to another, through the social layer's gestures.
   * True when it went; false when blocks, gesture limits, or today's putter wave for the pair
   * stopped it. Without a social layer nobody is greeted.
   */
  greet: (from: string, to: string) => boolean = () => false;

  // ---------- the town's clock ----------

  /** Log the townsfolk list when config changed it, so the sim keeps them out of votes. */
  syncTownsfolk(grant: ReadonlySet<string>) {
    const ids = [...grant].sort();
    if (ids.join(",") === (this.state.townsfolk ?? []).join(",")) return;
    this.run({ actor: TOWN_ACTOR, command: { type: "set_townsfolk", ids } });
  }

  /**
   * Move the world's day forward to today (UTC) and close proposals whose closing day has started.
   * Cheap when nothing is due, so the adapters call it on every request and once a minute. Each
   * step is a logged input, so replay never needs the clock.
   */
  tick() {
    if (!this.days) return;
    const today = utcDay(this.now());
    if (this.state.day === undefined || today > this.state.day) {
      this.run({ actor: TOWN_ACTOR, command: { type: "new_day", day: today } });
    }
    const day = this.state.day;
    if (day === undefined) return;
    if (this.economy && !this.state.economy) {
      const opened = this.run({ actor: TOWN_ACTOR, command: { type: "open_economy" } });
      if (!opened.ok) console.error(`Couldn't open coins: ${opened.error.message}`);
    }
    const due = (this.state.town?.proposals ?? []).filter(
      (p) => p.status === "open" && p.closesDay !== undefined && p.closesDay <= day,
    );
    for (const p of due) {
      const closed = this.run({
        actor: TOWN_ACTOR,
        command: { type: "close_proposal", proposal: p.id },
      });
      if (!closed.ok) console.error(`Couldn't close ${p.id}: ${closed.error.message}`);
    }
  }

  /** A maintainer voids a proposal. Logged as a world input naming them. */
  voidProposal(proposal: string, by: string): ActResult {
    return this.run({ actor: TOWN_ACTOR, command: { type: "void_proposal", proposal, by } });
  }

  /** Whole UTC days since a resident first joined. Residents from before days were counted are old. */
  residentAgeDays(residentId: string): number {
    const joined = this.joinedDay.get(residentId);
    return joined === undefined ? 0 : utcDay(this.now()) - joined;
  }

  // ---------- identity ----------

  createSession(
    request: { name: string; kind: ResidentKind } & LooseProfile,
  ): ActResult & { residentId?: string; token?: string } {
    const result = this.createResident(request);
    if (!result.ok || !result.residentId) return result;
    const { residentId } = result;
    const token = this.issueToken(residentId);
    return { ...result, residentId, token };
  }

  /** A new resident in the world, with no bearer token. `GET /v1/join` gives it a link key instead. */
  createResident(
    request: { name: string; kind: ResidentKind } & LooseProfile,
  ): ActResult & { residentId?: string } {
    const residentId = `r_${toHex(randomBytes(8))}`;
    const { name, kind, ...profile } = request;
    const refused =
      filtered(this.moderation, "name", cleanText(name), {}) ??
      filtered(this.moderation, "note", profile.note && cleanText(profile.note), {});
    if (refused) return refused;
    // A brand-new resident owns no uploads, so any media here is refused.
    const media = this.checkLookMedia(residentId, profile);
    if (media) return media;
    const result = this.run({
      actor: residentId,
      command: { type: "join", name: cleanText(name), kind, ...cleanProfile(profile) },
    });
    if (!result.ok) return result;
    this.joinedDay.set(residentId, utcDay(this.now()));
    this.touch(residentId);
    return { ...result, residentId };
  }

  // ---------- look media (RFC 0005) ----------

  private mediaType: OwnedMediaType | undefined;
  private onLookMedia: ((residentId: string, mediaIds: string[]) => void) | undefined;

  /**
   * Connect the uploads the look fields may name. `type` answers which of a resident's uploads
   * exist and what they are; `pinned` hears a resident's look media after each accepted change,
   * so the upload sweep never deletes media the world still shows. Without this, look media are
   * refused.
   */
  useMedia(type: OwnedMediaType, pinned: (residentId: string, mediaIds: string[]) => void) {
    this.mediaType = type;
    this.onLookMedia = pinned;
  }

  /** The upload ids a resident's look names. */
  lookMedia(residentId: string): string[] {
    const r = this.state.residents[residentId];
    if (!r) return [];
    return LOOK_MEDIA_KEYS.flatMap((key) => (r[key] ? [r[key]] : []));
  }

  /** Every resident's look media, for pinning them all after a restart. */
  allLookMedia(): Map<string, string[]> {
    const all = new Map<string, string[]>();
    for (const id of Object.keys(this.state.residents)) {
      const media = this.lookMedia(id);
      if (media.length > 0) all.set(id, media);
    }
    return all;
  }

  /** Refuse look media that aren't the resident's own uploads of the right kind. */
  private checkLookMedia(residentId: string, fields: LooseProfile): ActResult | undefined {
    for (const key of LOOK_MEDIA_KEYS) {
      const id = fields[key];
      if (id === undefined || id === null) continue;
      const rule = LOOK_MEDIA_TYPES[key];
      const type = this.mediaType?.(residentId, id);
      if (!type || !rule.types.includes(type)) {
        return { ok: false, error: { code: "bad_request", message: rule.what } };
      }
    }
    return undefined;
  }

  // ---------- link keys (decision 0020) ----------

  /**
   * Make a new link key for a resident and turn off the one they had. Returns the key, which is
   * shown once and never stored or logged; only its hash is kept.
   */
  mintLinkKey(residentId: string): string {
    const key = `k_${toBase64Url(randomBytes(32))}`;
    const keyHash = hashToken(key);
    // Save first: a key that isn't saved must not work, or it would stop working on restart.
    this.store.saveLinkKey({ residentId, keyHash });
    this.rememberLinkKey(residentId, keyHash);
    return key;
  }

  /** Turn off a resident's link key. Returns whether there was one. */
  revokeLinkKey(residentId: string): boolean {
    if (!this.linkKeyOf.has(residentId)) return false;
    this.store.saveLinkKey({ residentId, keyHash: null });
    this.rememberLinkKey(residentId, null);
    return true;
  }

  /** Resolve a link key to a resident id, or undefined if it's unknown or turned off. */
  authenticateLinkKey(key: string): string | undefined {
    if (!key.startsWith("k_")) return undefined;
    return this.linkKeys.get(hashToken(key));
  }

  private rememberLinkKey(residentId: string, keyHash: string | null) {
    const old = this.linkKeyOf.get(residentId);
    if (old !== undefined) this.linkKeys.delete(old);
    if (keyHash === null) {
      this.linkKeyOf.delete(residentId);
      return;
    }
    this.linkKeys.set(keyHash, residentId);
    this.linkKeyOf.set(residentId, keyHash);
  }

  /** A new bearer token for an existing resident. Only its hash is kept. */
  issueToken(residentId: string): string {
    const token = toBase64Url(randomBytes(32));
    const tokenHash = hashToken(token);
    this.store.appendSession({ tokenHash, residentId });
    this.sessions.set(tokenHash, residentId);
    return token;
  }

  /**
   * Make every token this resident holds stop working, now and after a restart, and close their
   * live connections. Persisted first, so a failed write leaves the old tokens working rather
   * than half revoked.
   */
  revokeTokens(residentId: string) {
    this.store.revokeSessions(residentId);
    for (const [tokenHash, id] of this.sessions) {
      if (id === residentId) this.sessions.delete(tokenHash);
    }
    for (const close of [...(this.revocationWatchers.get(residentId) ?? [])]) close();
  }

  /** Run `close` if this resident's tokens are revoked. Returns a function that stops watching. */
  watchRevocation(residentId: string, close: () => void): () => void {
    let set = this.revocationWatchers.get(residentId);
    if (!set) {
      set = new Set();
      this.revocationWatchers.set(residentId, set);
    }
    set.add(close);
    return () => {
      set.delete(close);
      if (set.size === 0 && this.revocationWatchers.get(residentId) === set) {
        this.revocationWatchers.delete(residentId);
      }
    };
  }

  /** Resolve a bearer token to a resident id, or undefined if unknown. */
  authenticate(token: string): string | undefined {
    return this.sessions.get(hashToken(token));
  }

  /** Bring a known resident back online if they went idle or the server restarted. */
  ensureOnline(residentId: string): ActResult {
    this.touch(residentId);
    const r = this.state.residents[residentId];
    if (!r) return { ok: false, error: { code: "unauthorized", message: "Unknown resident." } };
    if (r.online) return { ok: true, seq: this.state.seq, events: [] };
    return this.run({ actor: residentId, command: { type: "join", name: r.name, kind: r.kind } });
  }

  leave(residentId: string): ActResult {
    if (!this.state.residents[residentId]?.online)
      return { ok: true, seq: this.state.seq, events: [] };
    return this.run({ actor: residentId, command: { type: "leave" } });
  }

  // ---------- actions ----------

  /**
   * Do one action, or with `dry: true` only check it: every check a real call makes (text filters
   * included, so a refused text still counts as a strike), then the sim's `prepare()`. A dry run
   * never persists, commits, or broadcasts, and answers with the current `seq`.
   */
  act(residentId: string, action: Action): ActResult {
    const { dry, ...rest } = action;
    if (!dry) return this.perform(residentId, rest as Action, false);
    if (action.type === "chat") {
      return {
        ok: false,
        dry: true,
        error: {
          code: "bad_request",
          message: "Chat has no dry run. Send it without dry when you mean to say it.",
        },
      };
    }
    return { ...this.perform(residentId, rest as Action, true), dry: true };
  }

  private perform(residentId: string, action: Action, dry: boolean): ActResult {
    this.touch(residentId);
    const context = { resident: residentId };
    if (action.type === "chat") return this.chat(residentId, action.text, action.channel);
    if (action.type === "putter") return this.putter(residentId, dry);
    if (action.type === "profile") {
      const { type, ...profile } = action;
      const note = profile.note && cleanText(profile.note);
      const refused = filtered(this.moderation, "note", note, context);
      if (refused) return refused;
      const media = this.checkLookMedia(residentId, profile);
      if (media) return media;
      const command: Command = { type, ...cleanProfile(profile) };
      const result = this.run({ actor: residentId, command }, dry);
      if (result.ok && !dry) this.onLookMedia?.(residentId, this.lookMedia(residentId));
      return result;
    }
    if (action.type === "build_starter_home") {
      // Drop absent fields: the sim's types forbid explicit undefined.
      const { walls, windows } = action;
      const command: Command = {
        type: "build_starter_home",
        ...(walls ? { walls } : {}),
        ...(windows ? { windows } : {}),
      };
      return this.run({ actor: residentId, command }, dry);
    }
    if (action.type === "propose") {
      // Proposal text is read by everyone, agents included: clean it and turn away text written
      // as orders to AI readers before it's logged. The sim stores what's logged.
      const title = cleanText(action.title);
      const text = cleanMultiline(action.text ?? "");
      const refused =
        filtered(this.moderation, "proposal_title", title, context) ??
        filtered(this.moderation, "proposal_text", text, context);
      if (refused) return refused;
      const { blocks, remove } = action;
      const command: Command = {
        type: "propose",
        kind: action.kind,
        title,
        text,
        ...(blocks?.length ? { blocks } : {}),
        ...(remove?.length ? { remove } : {}),
      };
      return this.run({ actor: residentId, command }, dry);
    }
    if (action.type === "give_coins") {
      // Blocks live in the social layer; a gift can't cross one either way (decision 0024).
      if (this.blockedEither(residentId, action.to)) {
        return {
          ok: false,
          error: { code: "forbidden", message: "You can't send coins to this resident." },
        };
      }
      const note = action.note === undefined ? "" : cleanText(action.note);
      const refused = filtered(this.moderation, "gift_note", note, context);
      if (refused) return refused;
      const command: Command = {
        type: "give_coins",
        to: action.to,
        amount: action.amount,
        ...(note ? { note } : {}),
      };
      return this.run({ actor: residentId, command }, dry);
    }
    return this.run({ actor: residentId, command: action satisfies Command }, dry);
  }

  // ---------- putter (decision 0049) ----------

  /**
   * A short walk the sim's planner picks, then a wave at the nearest online resident within
   * earshot. Limited to once a minute and `PUTTER_LIMITS.perDay` a UTC day, counting only accepted
   * putters. The logged command carries the planned steps, so replay never runs the planner. A dry
   * run plans and checks the walk but greets nobody and uses up nothing.
   */
  private putter(residentId: string, dry: boolean): ActResult {
    const limited = this.putterLimited(residentId);
    if (limited) return limited;
    // Plan from where the resident would be: a dry run for someone marked offline checks them as
    // if they had come back, like `check()` does.
    let state = this.state;
    const me = state.residents[residentId];
    if (me && !me.online) {
      state = cloneWorld(state);
      apply(state, { actor: me.id, command: { type: "join", name: me.name, kind: me.kind } });
    }
    const steps = planPutter(state, residentId);
    const result = this.run({ actor: residentId, command: { type: "putter", steps } }, dry);
    if (!result.ok || dry) return result;
    const now = this.now();
    const today = utcDay(now);
    const used = this.putters.get(residentId);
    const count = used?.day === today ? used.count + 1 : 1;
    this.putters.set(residentId, { at: now, day: today, count });
    return { ...result, greeted: this.greetNearby(residentId) };
  }

  /** The refusal when a resident has puttered too recently or too often today. */
  private putterLimited(residentId: string): ActResult | undefined {
    const used = this.putters.get(residentId);
    if (!used) return undefined;
    const now = this.now();
    if (used.day === utcDay(now) && used.count >= PUTTER_LIMITS.perDay) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: `You've puttered ${PUTTER_LIMITS.perDay} times today, the most in one day. Try again after midnight UTC.`,
        },
      };
    }
    const wait = used.at + PUTTER_LIMITS.secondsBetween * 1000 - now;
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: `You puttered a moment ago. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
        },
      };
    }
    return undefined;
  }

  /** Wave at the nearest online resident within earshot who can take one. Their id, or null. */
  private greetNearby(residentId: string): string | null {
    const me = this.state.residents[residentId];
    if (!me) return null;
    const near = Object.values(this.state.residents)
      .filter((r) => r.online && r.id !== residentId && withinEarshot(me, r))
      .sort((a, b) => chebyshev(me, a) - chebyshev(me, b) || (a.id < b.id ? -1 : 1))
      .slice(0, PUTTER_GREET_TRIES);
    for (const r of near) {
      try {
        if (this.greet(residentId, r.id)) return r.id;
      } catch (err) {
        // The walk already happened; a failed wave shouldn't turn it into an error.
        report(err, "world.putter_greet", { command: "putter" });
        return null;
      }
    }
    return null;
  }

  private chat(residentId: string, raw: string, channel: ChatChannel = "nearby"): ActResult {
    const r = this.state.residents[residentId];
    if (!r?.online)
      return { ok: false, error: { code: "not_joined", message: "Join the world first." } };
    const text = cleanText(raw);
    if (text === "")
      return { ok: false, error: { code: "bad_request", message: "Empty message." } };
    const refused = filtered(this.moderation, "chat", text, { resident: residentId });
    if (refused) return refused;
    const message: ServerMessage = {
      type: "chat",
      trust: "untrusted",
      from: { id: r.id, name: r.name, kind: r.kind },
      text,
      channel,
      seq: this.state.seq,
    };
    // Only residents with a live connection receive chat: online, and nearby unless it's `world`.
    // The speaker always gets their own message back.
    let heard = 0;
    for (const [id, set] of this.listeners) {
      const other = this.state.residents[id];
      if (!other?.online) continue;
      if (channel === "nearby" && !withinEarshot(r, other)) continue;
      if (id !== residentId) heard++;
      for (const listener of set) listener(message);
    }
    return { ok: true, seq: this.state.seq, events: [], heard };
  }

  /**
   * The only path that changes the world. Order matters: check, persist, then commit. If the
   * write fails, the world is untouched, so memory never gets ahead of the log.
   */
  private run(input: Input, dry = false): ActResult {
    const command = input.command.type;
    if (dry) {
      const result = this.check(input);
      count("world.dry_run", { command, outcome: result.ok ? "ok" : result.error.code });
      return result;
    }
    return span(
      "world.run",
      "sim",
      () => {
        const result = this.runTraced(input);
        const outcome = result.ok ? "ok" : result.error.code;
        crumb("world", command, { outcome });
        count("world.command", { command, outcome });
        return result;
      },
      { command },
    );
  }

  /**
   * A dry run: the sim's checks and nothing else. A resident marked offline (idle, or signed out
   * elsewhere) is checked as if they had come back, the way a real call would bring them back
   * first, against a copy of the world so this one stays untouched.
   */
  private check(input: Input): ActResult {
    let state = this.state;
    const me = state.residents[input.actor];
    if (me && !me.online) {
      state = cloneWorld(state);
      apply(state, { actor: me.id, command: { type: "join", name: me.name, kind: me.kind } });
    }
    const prepared = prepare(state, input);
    if (!prepared.ok) return { ok: false, error: prepared.rejection };
    return { ok: true, seq: this.state.seq, events: [] };
  }

  private runTraced(input: Input): ActResult {
    const prepared = prepare(this.state, input);
    if (!prepared.ok) return { ok: false, error: prepared.rejection };
    try {
      this.store.appendInput(input);
    } catch (err) {
      console.error("Failed to persist input; world unchanged", err);
      report(err, "world.persist", { command: input.command.type });
      return { ok: false, error: { code: "internal", message: "Couldn't save that. Try again." } };
    }
    const { seq, events } = prepared.commit();
    const wire = toWire(events, this.state.townsfolk);
    for (const event of publicEvents(wire)) this.broadcast({ type: "event", seq, event });
    // Purse moves go only to the purse's owner (RFC 0008: purses are private).
    for (const event of wire) {
      if (event.type === "coins") this.notify(event.residentId, { type: "event", seq, event });
    }
    return { ok: true, seq, events: eventsFor(wire, input.actor) };
  }

  // ---------- presence ----------

  socketOpened(residentId: string) {
    this.sockets.set(residentId, (this.sockets.get(residentId) ?? 0) + 1);
    this.touch(residentId);
  }

  socketClosed(residentId: string) {
    const left = (this.sockets.get(residentId) ?? 1) - 1;
    if (left > 0) {
      this.sockets.set(residentId, left);
      return;
    }
    this.sockets.delete(residentId);
    this.leave(residentId);
  }

  /** Mark residents offline if they have no socket and haven't called the API recently. */
  sweepIdle() {
    const cutoff = this.now() - this.idleTimeoutMs;
    for (const r of Object.values(this.state.residents)) {
      if (!r.online || this.sockets.has(r.id)) continue;
      if ((this.lastSeen.get(r.id) ?? 0) < cutoff) this.leave(r.id);
    }
    // Forget offline residents so this map stays the size of the online population.
    for (const id of this.lastSeen.keys()) {
      if (!this.state.residents[id]?.online) this.lastSeen.delete(id);
    }
    // Putters from before today no longer limit anything.
    const today = utcDay(this.now());
    for (const [id, used] of this.putters) if (used.day < today) this.putters.delete(id);
  }

  private touch(residentId: string) {
    this.lastSeen.set(residentId, this.now());
  }

  // ---------- views ----------

  subscribe(residentId: string, listener: Listener): () => void {
    let set = this.listeners.get(residentId);
    if (!set) {
      set = new Set();
      this.listeners.set(residentId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      // Only drop the entry if it's still ours: a newer socket may have made a fresh set.
      if (set.size === 0 && this.listeners.get(residentId) === set) {
        this.listeners.delete(residentId);
      }
    };
  }

  /** Send a message to one resident's open sockets only, like a gesture meant for them. */
  notify(residentId: string, message: ServerMessage) {
    for (const listener of this.listeners.get(residentId) ?? []) listener(message);
  }

  private broadcast(message: ServerMessage) {
    for (const set of this.listeners.values()) for (const listener of set) listener(message);
  }

  /** Notes held back from view (a quarantine, RFC 0006): the snapshot shows them empty. */
  noteHidden: (residentId: string) => boolean = () => false;

  hash(): string {
    return hashWorld(this.state);
  }

  onlineCount(): number {
    return Object.values(this.state.residents).filter((r) => r.online).length;
  }

  snapshot(): WorldSnapshot {
    const { state } = this;
    return {
      v: PROTOCOL_VERSION,
      seq: state.seq,
      hash: this.hash(),
      // The sim never sees a clock; this is presentation state, anchored by the server.
      time: { nowMs: this.now(), dayLengthMs: DAY_LENGTH_MS },
      config: {
        width: state.config.width,
        height: state.config.height,
        plotSize: state.config.plotSize,
        maxPlotsPerResident: state.config.maxPlotsPerResident,
        reach: state.config.reach,
      },
      commons: commonsPlot(state.config),
      residents: Object.values(state.residents).map((r) =>
        this.noteHidden(r.id) ? { ...r, note: "" } : { ...r },
      ),
      plots: Object.values(state.plots).map((p) => ({
        px: p.px,
        py: p.py,
        ownerId: p.ownerId,
        ...(p.coOwners ? { coOwners: [...p.coOwners] } : {}),
        ...(p.claimedDay === undefined ? {} : { claimedDay: p.claimedDay }),
      })),
      blocks: Object.entries(state.blocks).map(([key, block]) => {
        const [x, y] = parseKey(key);
        return { x, y, block };
      }),
      ...(state.day === undefined ? {} : { day: state.day }),
      townHall: townHallTiles(state.config),
      ...(state.town
        ? {
            townBuilt: Object.entries(state.town.built).map(([key, proposal]) => {
              const [x, y] = parseKey(key);
              return { x, y, proposal };
            }),
          }
        : {}),
      ...(state.townsfolk?.length ? { townsfolk: [...state.townsfolk] } : {}),
    };
  }
}
