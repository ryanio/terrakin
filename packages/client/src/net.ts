import {
  type Action,
  type CreateSessionRequest,
  type PostMessage,
  PROTOCOL_VERSION,
  ServerMessage,
} from "@terrakin/protocol";
import { appCrumb } from "./telemetry";

const TOKEN_KEY = "terrakin.token";
/** Our own resident id, saved next to the token so the feed knows which profile is yours. */
const RESIDENT_KEY = "terrakin.resident";

export function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function savedResidentId(): string | null {
  try {
    return localStorage.getItem(RESIDENT_KEY);
  } catch {
    return null;
  }
}

export function saveResidentId(id: string) {
  try {
    localStorage.setItem(RESIDENT_KEY, id);
  } catch {
    // Storage disabled: we just ask the server again next time.
  }
}

/** Fired on window when the saved token changes, so the top bar can repaint. */
export const SESSION_EVENT = "terrakin:session";

/** Remember who you are in this browser (or forget, with null). The world and the feed both read it. */
export function saveToken(token: string | null, residentId?: string) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      if (residentId) localStorage.setItem(RESIDENT_KEY, residentId);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(RESIDENT_KEY);
    }
  } catch {
    // Private mode or storage disabled: the session just won't survive a reload.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_EVENT));
}

type Handler = (message: ServerMessage) => void;

/**
 * How long to wait before reconnect number `retry`: doubling from `base` up to `max`, then a random
 * half to all of it, so pages that lost the server together don't all come back in the same instant.
 */
export function backoff(retry: number, base: number, max: number, random = Math.random): number {
  const full = Math.min(max, base * 2 ** retry);
  return full / 2 + random() * (full / 2);
}
/** A saved key, or a new person: a name and their look, sent with hello to join. */
export type Identity =
  | { token: string }
  | ({ name: string; kind: "human" } & Pick<
      CreateSessionRequest,
      "color" | "shape" | "note" | "hair" | "hairColor" | "wear"
    >);

/** One WebSocket to /v1/live with automatic reconnect and token resume. */
export class Connection {
  private ws: WebSocket | undefined;
  private nextId = 1;
  private retry = 0;
  private identity: Identity;
  private closed = false;
  private reconnect: ReturnType<typeof setTimeout> | undefined;

  constructor(
    identity: Identity,
    private readonly onMessage: Handler,
    private readonly onStatus: (status: "connecting" | "online" | "offline") => void,
  ) {
    this.identity = identity;
    this.open();
  }

  /** Send an action. Returns its request id, or undefined if the socket isn't open (nothing sent). */
  send(action: Action): string | undefined {
    if (this.ws?.readyState !== WebSocket.OPEN) return undefined;
    const id = `c${this.nextId++}`;
    this.ws.send(JSON.stringify({ type: "action", id, action }));
    return id;
  }

  /** Close for good: no reconnect, including one already waiting to fire. */
  close() {
    this.closed = true;
    clearTimeout(this.reconnect);
    this.reconnect = undefined;
    this.ws?.close();
  }

  private open() {
    this.reconnect = undefined;
    if (this.closed) return;
    this.onStatus("connecting");
    appCrumb("live", "connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/v1/live`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "hello", v: PROTOCOL_VERSION, ...this.identity }));
    });

    ws.addEventListener("message", (e) => {
      const parsed = ServerMessage.safeParse(JSON.parse(String(e.data)));
      if (!parsed.success) {
        console.warn("Ignoring malformed server message", parsed.error);
        return;
      }
      const msg = parsed.data;
      if (msg.type === "welcome") {
        this.retry = 0;
        this.identity = { token: msg.token };
        saveToken(msg.token, msg.residentId);
        this.onStatus("online");
        appCrumb("live", "online");
      }
      if (msg.type === "error") appCrumb("live", `error ${msg.error.code}`);
      if (msg.type === "error" && msg.error.code === "unauthorized") {
        // Stale token (for example, the server's data was reset). Start fresh.
        saveToken(null);
      }
      this.onMessage(msg);
    });

    ws.addEventListener("close", (e) => {
      this.onStatus("offline");
      appCrumb("live", `closed ${e.code}`);
      if (this.closed) return;
      const delay = backoff(this.retry++, 500, 10_000);
      this.reconnect = setTimeout(() => this.open(), delay);
    });
  }
}

/** How many times a dropped watch socket tries again before it ends and the page polls. */
const WATCH_RETRIES = 5;
/** A watch socket pings this often, so the server keeps it and a dead connection is noticed. */
const WATCH_PING_MS = 45_000;
/** No pong within this long means the connection is gone (a phone that slept, say). */
const WATCH_PONG_MS = 10_000;

export interface PostWatchOptions {
  /** Only posts by people you follow (and your own). Needs a saved token. */
  following: boolean;
  onPost(message: PostMessage): void;
  onLive(live: boolean): void;
  /**
   * It won't reconnect on its own: the server ended it after its lifetime (`expired`), or turned
   * it away or it dropped WATCH_RETRIES times (`refused`).
   */
  onEnd(why: "expired" | "refused"): void;
}

/**
 * A light socket to /v1/live that only hears about new posts (`watch`): no world, no presence.
 * It sends the saved token when there is one, so posts across a block stay away.
 */
export class PostWatch {
  private ws: WebSocket | undefined;
  private retry = 0;
  private closed = false;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private pinger: ReturnType<typeof setInterval> | undefined;
  private pongDue: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: PostWatchOptions) {
    this.open();
  }

  /** Close for good, including a reconnect already waiting. */
  close() {
    this.closed = true;
    clearTimeout(this.reconnect);
    this.reconnect = undefined;
    this.stopPings();
    this.ws?.close();
    this.options.onLive(false);
  }

  private end(why: "expired" | "refused") {
    if (this.closed) return;
    this.close();
    this.options.onEnd(why);
  }

  private stopPings() {
    clearInterval(this.pinger);
    clearTimeout(this.pongDue);
    this.pinger = undefined;
    this.pongDue = undefined;
  }

  private open() {
    this.reconnect = undefined;
    if (this.closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/v1/live`);
    this.ws = ws;
    ws.addEventListener("open", () => {
      const token = savedToken();
      ws.send(
        JSON.stringify({
          type: "watch",
          v: PROTOCOL_VERSION,
          ...(token ? { token } : {}),
          ...(token && this.options.following ? { following: true } : {}),
        }),
      );
    });
    ws.addEventListener("message", (e) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const parsed = ServerMessage.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "watching") {
        this.retry = 0;
        this.options.onLive(true);
        appCrumb("live", "watching");
        this.pinger = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: "ping", id: "w" }));
          this.pongDue ??= setTimeout(() => ws.close(), WATCH_PONG_MS);
        }, WATCH_PING_MS);
      } else if (msg.type === "pong") {
        clearTimeout(this.pongDue);
        this.pongDue = undefined;
      } else if (msg.type === "post") {
        this.options.onPost(msg);
      } else if (msg.type === "error") {
        appCrumb("live", `watch error ${msg.error.code}`);
        this.end("refused");
      }
    });
    ws.addEventListener("close", (e) => {
      this.stopPings();
      if (this.closed) return;
      this.options.onLive(false);
      if (e.code === 4008) return this.end("expired");
      if (this.retry >= WATCH_RETRIES) return this.end("refused");
      this.reconnect = setTimeout(() => this.open(), backoff(this.retry++, 1000, 30_000));
    });
  }
}
