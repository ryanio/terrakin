import { createHash, randomBytes } from "node:crypto";
import type { Action, ErrorCode, ServerMessage, WorldSnapshot } from "@terrakin/protocol";
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
} from "@terrakin/sim";
import type { Store } from "./store";
import { cleanText } from "./text";

export type ActResult =
  | { ok: true; seq: number; events: WorldEvent[] }
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

/** Drop absent fields (the sim's types forbid explicit undefined) and clean the note text. */
type LooseProfile = { [K in keyof ProfileFields]?: ProfileFields[K] | undefined };

function cleanProfile(fields: LooseProfile): ProfileFields {
  return {
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.shape ? { shape: fields.shape } : {}),
    ...(fields.note !== undefined ? { note: cleanText(fields.note) } : {}),
  };
}

/**
 * Owns the one authoritative world. Every change goes through `act` or `join`/`leave`,
 * which run the sim, persist the accepted input, and broadcast the resulting events.
 */
export class WorldService {
  readonly state: WorldState;
  private readonly store: Store;
  private readonly sessions = new Map<string, string>(); // tokenHash -> residentId
  private readonly listeners = new Set<Listener>();
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
    // Nobody is connected right after a restart. Mark everyone offline so presence is honest.
    for (const r of Object.values(this.state.residents)) {
      if (r.online) this.run({ actor: r.id, command: { type: "leave" } });
    }
  }

  // ---------- identity ----------

  createSession(
    request: { name: string; kind: ResidentKind } & LooseProfile,
  ): ActResult & { residentId?: string; token?: string } {
    const residentId = `r_${randomBytes(8).toString("hex")}`;
    const { name, kind, ...profile } = request;
    const result = this.run({
      actor: residentId,
      command: { type: "join", name: cleanText(name), kind, ...cleanProfile(profile) },
    });
    if (!result.ok) return result;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    this.sessions.set(tokenHash, residentId);
    this.store.appendSession({ tokenHash, residentId });
    this.touch(residentId);
    return { ...result, residentId, token };
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
    if (action.type === "chat") return this.chat(residentId, action.text);
    if (action.type === "profile") {
      const { type, ...profile } = action;
      return this.run({ actor: residentId, command: { type, ...cleanProfile(profile) } });
    }
    return this.run({ actor: residentId, command: action satisfies Command });
  }

  private chat(residentId: string, raw: string): ActResult {
    const r = this.state.residents[residentId];
    if (!r?.online)
      return { ok: false, error: { code: "not_joined", message: "Join the world first." } };
    const text = cleanText(raw);
    if (text === "")
      return { ok: false, error: { code: "bad_request", message: "Empty message." } };
    this.broadcast({
      type: "chat",
      trust: "untrusted",
      from: { id: r.id, name: r.name, kind: r.kind },
      text,
      seq: this.state.seq,
    });
    return { ok: true, seq: this.state.seq, events: [] };
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

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
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
