import { type Action, PROTOCOL_VERSION, ServerMessage } from "@terrakin/protocol";

const TOKEN_KEY = "terrakin.token";

export function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode or storage disabled: the session just won't survive a reload.
  }
}

type Handler = (message: ServerMessage) => void;
type Identity = { token: string } | { name: string; kind: "human"; color?: string };

/** One WebSocket to /v1/live with automatic reconnect and token resume. */
export class Connection {
  private ws: WebSocket | undefined;
  private nextId = 1;
  private retry = 0;
  private identity: Identity;
  private closed = false;

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

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private open() {
    this.onStatus("connecting");
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
        saveToken(msg.token);
        this.onStatus("online");
      }
      if (msg.type === "error" && msg.error.code === "unauthorized") {
        // Stale token (for example, the server's data was reset). Start fresh.
        saveToken(null);
      }
      this.onMessage(msg);
    });

    ws.addEventListener("close", () => {
      this.onStatus("offline");
      if (this.closed) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.open(), delay);
    });
  }
}
