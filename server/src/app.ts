import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import { buildOpenApi } from "@terrakin/protocol";
import { WebSocketServer } from "ws";
import { Api, type ApiOptions, type ApiResponse, MAX_BODY_BYTES } from "./api";
import { MEDIA_ID, mediaHeaders, type ReadableMediaStore, sniffMediaType } from "./media";
import type { SocialService } from "./social-service";
import type { WorldService } from "./world-service";

const require = createRequire(import.meta.url);
const SKILL_MD = readFileSync(require.resolve("@terrakin/protocol/SKILL.md"), "utf8");
const OPENAPI = JSON.stringify(buildOpenApi());

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
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
  /** The social layer (RFC 0003). Pass `media` too so uploads can be served at `/media/:id`. */
  social?: SocialService;
  media?: ReadableMediaStore;
  /** See `ApiOptions.ipUploadBytesPerDay`. */
  ipUploadBytesPerDay?: number;
  /** See `ApiOptions.onResponse`. Tests use it to check responses against the route table. */
  onResponse?: ApiOptions["onResponse"];
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

/**
 * The scheme and host the client used, for absolute links in Markdown answers. Only a plain
 * host[:port] is accepted, so a strange Host header can't put anything else into a page. Behind
 * trusted proxies, `X-Forwarded-Proto` says whether the client used https.
 */
export function requestOrigin(req: IncomingMessage, trustedProxies = 0): { origin?: string } {
  const host = req.headers.host ?? "";
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return {};
  const forwarded = trustedProxies > 0 ? req.headers["x-forwarded-proto"] : undefined;
  const scheme = forwarded === "https" ? "https" : "http";
  return { origin: `${scheme}://${host}` };
}

/** Node adapter: HTTP + WebSocket around the runtime-neutral `Api`. */
export function createApp(options: AppOptions): Server {
  const api = new Api({
    service: options.service,
    skill: SKILL_MD,
    openapi: OPENAPI,
    ...(options.actionsPerSecond === undefined
      ? {}
      : { actionsPerSecond: options.actionsPerSecond }),
    ...(options.sessionsPerMinute === undefined
      ? {}
      : { sessionsPerMinute: options.sessionsPerMinute }),
    ...(options.social ? { social: options.social } : {}),
    ...(options.ipUploadBytesPerDay === undefined
      ? {}
      : { ipUploadBytesPerDay: options.ipUploadBytesPerDay }),
    ...(options.onResponse ? { onResponse: options.onResponse } : {}),
  });

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) send(res, apiError("internal", "Something broke on our side."));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const response = await api.handle({
      method: req.method ?? "GET",
      pathname: url.pathname,
      ip: clientIp(req, options.trustedProxies),
      authorization: req.headers.authorization,
      query: url.searchParams,
      readJson: () => readJson(req),
      readBytes: (max) => readBytes(req, max),
      contentLength:
        req.headers["content-length"] === undefined
          ? undefined
          : Number(req.headers["content-length"]),
      ...requestOrigin(req, options.trustedProxies),
    });
    if (response) return send(res, response);
    const mediaId = /^\/media\/([^/]+)$/.exec(url.pathname)?.[1];
    if (req.method === "GET" && mediaId !== undefined && options.media) {
      return serveMedia(options.media, mediaId, req, res);
    }
    if (options.staticDir) return serveStatic(options.staticDir, url.pathname, res);
    return send(res, apiError("not_found", `No route for ${req.method} ${url.pathname}.`));
  }

  const wss = new WebSocketServer({ server, path: "/v1/live", maxPayload: MAX_BODY_BYTES });
  wss.on("connection", (socket, req) => {
    const session = api.live(clientIp(req, options.trustedProxies), {
      send: (text) => {
        if (socket.readyState === socket.OPEN) socket.send(text);
      },
      close: (code, reason) => socket.close(code, reason),
    });
    socket.on("message", (data) => session.onMessage(data.toString()));
    socket.on("close", () => session.onClose());
  });

  const sweep = setInterval(() => api.sweep(), 60_000);
  sweep.unref();
  server.on("close", () => {
    clearInterval(sweep);
    for (const client of wss.clients) client.terminate();
    wss.close();
  });

  return server;
}

async function readBytes(req: IncomingMessage, maxBytes: number): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) return undefined;
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const bytes = await readBytes(req, MAX_BODY_BYTES);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

/** Serve an upload, with byte ranges so phones can stream video. */
async function serveMedia(
  store: ReadableMediaStore,
  id: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const bytes = MEDIA_ID.test(id) ? await store.get(id) : undefined;
  const type = bytes ? sniffMediaType(bytes) : undefined;
  if (!bytes || !type) return send(res, apiError("not_found", "Not found."));
  const headers = { ...mediaHeaders(type), "accept-ranges": "bytes" };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}` });
    return res.end(bytes.subarray(start, end + 1));
  }
  res.writeHead(200, headers);
  res.end(bytes);
}

function send(res: ServerResponse, response: ApiResponse) {
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

function apiError(code: "internal" | "not_found", message: string): ApiResponse {
  return {
    status: code === "internal" ? 500 : 404,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ error: { code, message } }),
  };
}

function serveStatic(root: string, pathname: string, res: ServerResponse) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return send(res, apiError("not_found", "Not found."));
  }
  const rel = normalize(decoded).replace(/^([/\\])+/, "");
  const base = normalize(root + sep);
  let file = join(base, rel || "index.html");
  if (!file.startsWith(base)) return send(res, apiError("not_found", "Not found."));
  let body: Buffer;
  try {
    body = readFileSync(file);
  } catch {
    // Single-page app fallback.
    file = join(base, "index.html");
    try {
      body = readFileSync(file);
    } catch {
      return send(res, apiError("not_found", "Not found."));
    }
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(body);
}
