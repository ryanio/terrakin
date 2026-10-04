import { createHash } from "node:crypto";
import type {
  Action,
  ChatChannel,
  ErrorCode,
  ServerMessage,
  WorldSnapshot,
} from "@terrakin/protocol";
import { PROTOCOL_VERSION } from "@terrakin/protocol";
import {
  type Command,
  commonsPlot,
  DEFAULT_CONFIG,
  hashWorld,
  type Input,
  type ProfileFields,
  parseKey,
  prepare,
  type ResidentKind,
  replay,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
  withinEarshot,
} from "@terrakin/sim";
import { aimedAtReader } from "./injection";
import type { Store } from "./store";
import { cleanText } from "./text";

export type ActResult =
  | { ok: true; seq: number; events: WorldEvent[]; heard?: number }
  | { ok: false; error: { code: ErrorCode; message: string } };

type Listener = (message: ServerMessage) => void;

export interface WorldServiceOptions {
  store: Store;
  config?: WorldConfig;
  /** Residents with no live socket and no REST call for this long are marked offline. */
  idleTimeoutMs?: number;
  now?: () => number;
}

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
  return {
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.shape ? { shape: fields.shape } : {}),
    ...(fields.note !== undefined ? { note: cleanText(fields.note) } : {}),
  };
}

/** Turn away text written as orders for AI readers (see injection.ts). */
function readerRefusal(what: string, words: string): ActResult {
  return {
    ok: false,
    error: {
      code: "bad_request",
      message: `${what} can't include instructions aimed at AI readers ("${words}"). Write it for people, and say it another way.`,
    },
  };
}

/**
 * One full day/night cycle. Short enough that a playtest sees the whole arc,
 * long enough that night feels like night. Tunable; clients read it from the snapshot.
 */
export const DAY_LENGTH_MS = 10 * 60_000;

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
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: WorldServiceOptions) {
    this.store = options.store;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
    this.state = replay(options.config ?? DEFAULT_CONFIG, this.store.loadLog());
    for (const s of this.store.loadSessions()) this.sessions.set(s.tokenHash, s.residentId);
    for (const k of this.store.loadLinkKeys()) this.rememberLinkKey(k.residentId, k.keyHash);
    // Nobody is connected right after a restart. Mark everyone offline so presence is honest.
    for (const r of Object.values(this.state.residents)) {
      if (r.online) this.run({ actor: r.id, command: { type: "leave" } });
    }
  }

  // ---------- identity ----------

  createSession(
    request: { name: string; kind: ResidentKind } & LooseProfile,
  ): ActResult & { residentId?: string; token?: string } {
    const result = this.createResident(request);
    if (!result.ok || !result.residentId) return result;
    const { residentId } = result;
    const token = toBase64Url(randomBytes(32));
    const tokenHash = hashToken(token);
    this.sessions.set(tokenHash, residentId);
    this.store.appendSession({ tokenHash, residentId });
    return { ...result, residentId, token };
  }

  /** A new resident in the world, with no bearer token. `GET /v1/join` gives it a link key instead. */
  createResident(
    request: { name: string; kind: ResidentKind } & LooseProfile,
  ): ActResult & { residentId?: string } {
    const residentId = `r_${toHex(randomBytes(8))}`;
    const { name, kind, ...profile } = request;
    const aimed = profile.note === undefined ? null : aimedAtReader(profile.note);
    if (aimed) return readerRefusal("Notes", aimed);
    const result = this.run({
      actor: residentId,
      command: { type: "join", name: cleanText(name), kind, ...cleanProfile(profile) },
    });
    if (!result.ok) return result;
    this.touch(residentId);
    return { ...result, residentId };
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

  act(residentId: string, action: Action): ActResult {
    this.touch(residentId);
    if (action.type === "chat") return this.chat(residentId, action.text, action.channel);
    if (action.type === "profile") {
      const { type, ...profile } = action;
      const aimed = profile.note === undefined ? null : aimedAtReader(profile.note);
      if (aimed) return readerRefusal("Notes", aimed);
      return this.run({ actor: residentId, command: { type, ...cleanProfile(profile) } });
    }
    if (action.type === "build_starter_home") {
      // Drop absent fields: the sim's types forbid explicit undefined.
      const { walls, windows } = action;
      const command: Command = {
        type: "build_starter_home",
        ...(walls ? { walls } : {}),
        ...(windows ? { windows } : {}),
      };
      return this.run({ actor: residentId, command });
    }
    return this.run({ actor: residentId, command: action satisfies Command });
  }

  private chat(residentId: string, raw: string, channel: ChatChannel = "nearby"): ActResult {
    const r = this.state.residents[residentId];
    if (!r?.online)
      return { ok: false, error: { code: "not_joined", message: "Join the world first." } };
    const text = cleanText(raw);
    if (text === "")
      return { ok: false, error: { code: "bad_request", message: "Empty message." } };
    const aimed = aimedAtReader(text);
    if (aimed) return readerRefusal("Chat", aimed);
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
  private run(input: Input): ActResult {
    const prepared = prepare(this.state, input);
    if (!prepared.ok) return { ok: false, error: prepared.rejection };
    try {
      this.store.appendInput(input);
    } catch (err) {
      console.error("Failed to persist input; world unchanged", err);
      return { ok: false, error: { code: "internal", message: "Couldn't save that. Try again." } };
    }
    const { seq, events } = prepared.commit();
    for (const event of events) this.broadcast({ type: "event", seq, event });
    return { ok: true, seq, events };
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
      config: { ...state.config },
      commons: commonsPlot(state.config),
      residents: Object.values(state.residents).map((r) => ({ ...r })),
      plots: Object.values(state.plots).map((p) => ({ ...p })),
      blocks: Object.entries(state.blocks).map(([key, block]) => {
        const [x, y] = parseKey(key);
        return { x, y, block };
      }),
    };
  }
}
