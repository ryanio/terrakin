import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import {
  Action,
  buildOpenApi,
  ClientMessage,
  CreateSessionRequest,
  type ErrorCode,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "@terrakin/protocol";
import { WebSocketServer } from "ws";
import { RateLimiters } from "./rate-limit";
import type { WorldService } from "./world-service";

const MAX_BODY_BYTES = 16 * 1024;
const HELLO_TIMEOUT_MS = 5_000;

const require = createRequire(import.meta.url);
const SKILL_MD = readFileSync(require.resolve("@terrakin/protocol/SKILL.md"), "utf8");
const OPENAPI = JSON.stringify(buildOpenApi());

const STATUS: Partial<Record<ErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  internal: 500,
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

export interface AppOptions {
  service: WorldService;
  /** Serve a built client from this directory (optional). */
  staticDir?: string;
  /** Actions per second allowed per resident (burst = 2x). Default 10. */
  actionsPerSecond?: number;
  /** New sessions per minute allowed per IP (burst = 5). Default 3. */
  sessionsPerMinute?: number;
  /**
   * Number of reverse proxies in front of this server (default 0). With N > 0, the client IP is
   * the Nth address from the right of X-Forwarded-For. Never set this without a proxy that
   * appends to that header, or clients can spoof their IP.
   */
  trustedProxies?: number;
}

/** The client's IP, honoring X-Forwarded-For only for the configured number of trusted hops. */
export function clientIp(req: IncomingMessage, trustedProxies = 0): string {
  const direct = req.socket.remoteAddress ?? "unknown";
  if (!Number.isInteger(trustedProxies) || trustedProxies <= 0) return direct;
  const header = req.headers["x-forwarded-for"];
  const hops = (Array.isArray(header) ? header.join(",") : (header ?? ""))
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  // Fewer hops than trusted proxies means the request didn't come through them all: trust nothing
  // the client wrote.
  return hops[hops.length - trustedProxies] ?? direct;
}

/** HTTP + WebSocket front door. All rules live in the sim; this layer only parses, authenticates, and routes. */
export function createApp(options: AppOptions): Server {
  const { service } = options;
  const rate = options.actionsPerSecond ?? 10;
  const actionLimits = new RateLimiters(rate * 2, rate);
  // Every session adds a resident to the log forever, so creating them is much more limited.
  // Behind a reverse proxy, set trustedProxies so limits key on the real client IP.
  const sessionLimits = new RateLimiters(5, (options.sessionsPerMinute ?? 3) / 60);

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) sendError(res, "internal", "Something broke on our side.");
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const route = `${req.method} ${url.pathname}`;

    switch (route) {
      case "GET /v1/health":
        return sendJson(res, 200, {
          ok: true,
          v: PROTOCOL_VERSION,
          seq: service.state.seq,
          hash: service.hash(),
          online: service.onlineCount(),
        });
      case "GET /v1/world":
        return sendJson(res, 200, service.snapshot());
      case "GET /v1/skill":
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        return res.end(SKILL_MD);
      case "GET /v1/openapi.json":
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(OPENAPI);

      case "POST /v1/session": {
        if (!sessionLimits.take(clientIp(req, options.trustedProxies))) {
          return sendError(res, "rate_limited", "Too many new sessions. Try again in a minute.");
        }
        const parsed = CreateSessionRequest.safeParse(await readJson(req));
        if (!parsed.success) return sendError(res, "bad_request", parsed.error.message);
        const result = service.createSession(parsed.data);
        if (!result.ok)
          return sendError(res, "bad_request", result.error.message, result.error.code);
        return sendJson(res, 201, {
          residentId: result.residentId,
          token: result.token,
          world: service.snapshot(),
        });
      }

      case "DELETE /v1/session": {
        const residentId = authenticate(req);
        if (!residentId) return sendError(res, "unauthorized", "Missing or unknown bearer token.");
        service.leave(residentId);
        res.writeHead(204);
        return res.end();
      }

      case "POST /v1/actions": {
        const residentId = authenticate(req);
        if (!residentId) return sendError(res, "unauthorized", "Missing or unknown bearer token.");
        if (!actionLimits.take(residentId)) return sendError(res, "rate_limited", "Slow down.");
        const parsed = Action.safeParse(await readJson(req));
        if (!parsed.success) return sendError(res, "bad_request", parsed.error.message);
        service.ensureOnline(residentId);
        return sendJson(res, 200, service.act(residentId, parsed.data));
      }
    }

    if (req.method === "GET" && options.staticDir && !url.pathname.startsWith("/v1/")) {
      return serveStatic(options.staticDir, url.pathname, res);
    }
    return sendError(res, "not_found", `No route for ${route}.`);
  }

  function authenticate(req: IncomingMessage): string | undefined {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    return match?.[1] ? service.authenticate(match[1]) : undefined;
  }

  // ---------- WebSocket ----------

  const wss = new WebSocketServer({ server, path: "/v1/live", maxPayload: MAX_BODY_BYTES });
  wss.on("connection", (socket, req) => {
    const ip = clientIp(req, options.trustedProxies);
    let residentId: string | undefined;
    let unsubscribe: (() => void) | undefined;
    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const fail = (code: ErrorCode, message: string, id?: string) =>
      send({ type: "error", ...(id === undefined ? {} : { id }), error: { code, message } });

    const helloTimer = setTimeout(() => socket.close(4000, "hello timeout"), HELLO_TIMEOUT_MS);

    socket.on("message", (data) => {
      try {
        onMessage(data.toString());
      } catch (err) {
        console.error(err);
        fail("internal", "Something broke on our side.");
      }
    });

    function onMessage(text: string) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        return fail("bad_request", "Messages must be JSON.");
      }
      const parsed = ClientMessage.safeParse(raw);
      if (!parsed.success) return fail("bad_request", parsed.error.message);
      const msg = parsed.data;

      if (msg.type === "hello") {
        if (residentId) return fail("bad_request", "Already said hello.");
        if (msg.v !== PROTOCOL_VERSION) {
          fail("version_mismatch", `This server speaks v${PROTOCOL_VERSION}.`);
          return socket.close(4001, "version mismatch");
        }
        let id: string;
        let token: string;
        if (msg.token) {
          const known = service.authenticate(msg.token);
          if (!known) return fail("unauthorized", "Unknown token.");
          const online = service.ensureOnline(known);
          if (!online.ok) return fail(online.error.code, online.error.message);
          id = known;
          token = msg.token;
        } else {
          if (!msg.name || !msg.kind)
            return fail("bad_request", "Send a token, or a name and kind.");
          if (!sessionLimits.take(ip)) {
            return fail("rate_limited", "Too many new sessions. Try again in a minute.");
          }
          const created = service.createSession({ ...msg, name: msg.name, kind: msg.kind });
          if (!created.ok) return fail(created.error.code, created.error.message);
          if (!created.residentId || !created.token) return fail("internal", "No session.");
          id = created.residentId;
          token = created.token;
        }
        // Only now is this socket bound to a resident.
        residentId = id;
        clearTimeout(helloTimer);
        service.socketOpened(id);
        send({ type: "welcome", residentId: id, token, world: service.snapshot() });
        unsubscribe = service.subscribe(id, send);
        return;
      }

      if (!residentId) return fail("bad_request", "Say hello first.");
      if (msg.type === "ping")
        return send({ type: "pong", ...(msg.id === undefined ? {} : { id: msg.id }) });
      if (!actionLimits.take(residentId)) return fail("rate_limited", "Slow down.", msg.id);
      // The resident may have been marked offline (DELETE /v1/session from another client).
      // An open socket means they're here, so bring them back.
      service.ensureOnline(residentId);
      const result = service.act(residentId, msg.action);
      if (!result.ok) return fail(result.error.code, result.error.message, msg.id);
      send({ type: "ack", ...(msg.id === undefined ? {} : { id: msg.id }), seq: result.seq });
    }

    socket.on("close", () => {
      clearTimeout(helloTimer);
      unsubscribe?.();
      if (residentId) service.socketClosed(residentId);
    });
  });

  const sweep = setInterval(() => {
    service.sweepIdle();
    actionLimits.prune();
    sessionLimits.prune();
  }, 60_000);
  sweep.unref();
  server.on("close", () => {
    clearInterval(sweep);
    for (const client of wss.clients) client.terminate();
    wss.close();
  });

  return server;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  code: ErrorCode,
  message: string,
  bodyCode: ErrorCode = code,
) {
  sendJson(res, STATUS[code] ?? 400, { error: { code: bodyCode, message } });
}

function serveStatic(root: string, pathname: string, res: ServerResponse) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendError(res, "not_found", "Not found.");
  }
  const rel = normalize(decoded).replace(/^([/\\])+/, "");
  const base = normalize(root + sep);
  let file = join(base, rel || "index.html");
  if (!file.startsWith(base)) return sendError(res, "not_found", "Not found.");
  let body: Buffer;
  try {
    body = readFileSync(file);
  } catch {
    // Single-page app fallback.
    file = join(base, "index.html");
    try {
      body = readFileSync(file);
    } catch {
      return sendError(res, "not_found", "Not found.");
    }
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}
