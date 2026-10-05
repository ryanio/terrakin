import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import { cards } from "@terrakin/cards/node";
import { buildOpenApi } from "@terrakin/protocol";
import { WebSocketServer } from "ws";
import { adminAssetPath } from "./admin-host";
import { AGENT_RECHECK_EVERY_MS } from "./agent-links";
import { Api, type ApiOptions, type ApiResponse, ipKey, MAX_BODY_BYTES } from "./api";
import { MEDIA_ID, mediaHeaders, type ReadableMediaStore, sniffMediaType } from "./media";
import { applyEdits } from "./meta-html";
import {
  type CardDeps,
  matchCardPath,
  pageImage,
  RENDERS_PER_MINUTE,
  serveCard,
  windowLimiter,
} from "./og";
import { type ApiGet, loadPage, matchPage, pageEdits } from "./page-meta";
import {
  ADMIN_ASSET_PREFIX,
  ADMIN_PAGE_HEADERS,
  adminRedirect,
  isAdminHost,
  negotiate,
  pageHeaders,
  twinHeaders,
} from "./pages";
import { materializePlot } from "./plot-photo";
import type { SocialService } from "./social-service";
import { report } from "./telemetry";
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
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

export interface AppOptions {
  service: WorldService;
  /** Serve a built client from this directory (optional). */
  staticDir?: string;
  /** Actions per second allowed per resident (burst = 2x). Default 10. */
  actionsPerSecond?: number;
  /** New sessions per minute allowed per IP (burst = 5, or this many when higher). Default 3. */
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
  /** See `ApiOptions.maxWatchers`. */
  maxWatchers?: number;
  /** See `ApiOptions.maxWatchersPerNetwork`. */
  maxWatchersPerNetwork?: number;
  /** See `ApiOptions.onResponse`. Tests use it to check responses against the route table. */
  onResponse?: ApiOptions["onResponse"];
  /** See `ApiOptions.staff`. Node has no Cloudflare Access, so staff sign in with a token. */
  staff?: ApiOptions["staff"];
  /** See `ApiOptions.now`. Default Date.now. */
  now?: ApiOptions["now"];
  /** See `ApiOptions.photos`. Default: drawn in this process with the cards renderer. `false`: none. */
  photos?: ApiOptions["photos"] | false;
  /**
   * Tests only (`TERRAKIN_TEST_CLOCK=1`): answers `POST /v1/test/advance-day` by moving the clock
   * a day on. It's deliberately outside the route table, so it never appears in the API docs, and
   * the Cloudflare adapter has no way to turn it on.
   */
  testClock?: { advanceDay(): number | null; grantMaintainer?(residentId: string): void };
}

/** The test clock's route that moves the world to the next day. See `AppOptions.testClock`. */
export const TEST_ADVANCE_DAY_PATH = "/v1/test/advance-day";
/** Tests only, with the test clock: `POST {"residentId"}` makes that resident a maintainer. */
export const TEST_MAINTAINER_PATH = "/v1/test/maintainer";

/** Whether a socket address is this machine (IPv4, IPv6, or IPv4 mapped into IPv6). */
export const isLoopback = (address: string | undefined) =>
  address === "::1" || /^(::ffff:)?127\./.test(address ?? "");

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

/** One value of a header Node may hand back as a list. */
const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

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
    ...(options.staff ? { staff: options.staff } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.maxWatchers === undefined ? {} : { maxWatchers: options.maxWatchers }),
    ...(options.maxWatchersPerNetwork === undefined
      ? {}
      : { maxWatchersPerNetwork: options.maxWatchersPerNetwork }),
    // Node has one process, so plot photos are drawn here, like the link cards.
    ...(options.photos === false
      ? {}
      : {
          photos:
            options.photos ??
            (async (spec) => {
              const card = await materializePlot(spec, async (id) =>
                MEDIA_ID.test(id) ? options.media?.get(id) : undefined,
              );
              return (await cards.render(card)).bytes;
            }),
        }),
  });

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) send(res, apiError("internal", "Something broke on our side."));
    });
  });

  /** A GET against our own API, for page meta and cards: the same data every client sees. */
  const get: ApiGet = async (path) => {
    const url = new URL(path, "http://localhost");
    const response = await api.handle({
      method: "GET",
      pathname: url.pathname,
      ip: "internal",
      authorization: undefined,
      query: url.searchParams,
      readJson: async () => undefined,
      readBytes: async () => undefined,
      contentLength: undefined,
    });
    if (!response) return { status: 404, body: undefined };
    const json =
      response.headers["content-type"]?.startsWith("application/json") &&
      typeof response.body === "string";
    return {
      status: response.status,
      body: json ? JSON.parse(response.body as string) : undefined,
    };
  };

  // Cards drawn here stay in memory, the most recent few dozen.
  const rendered = new Map<string, Uint8Array>();
  const allowRender = windowLimiter(RENDERS_PER_MINUTE, 60_000);
  const cardDeps: CardDeps = {
    get,
    loadMedia: async (id) => options.media?.get(id),
    render: (card) => cards.render(card),
    cache: {
      get: async (key) => rendered.get(key),
      put: (key, png) => {
        rendered.set(key, png);
        if (rendered.size > 64) rendered.delete(rendered.keys().next().value ?? key);
      },
    },
    allowRender: (ip) => allowRender(ipKey(ip)),
  };

  /** A page's HTML with its title, meta tags, JSON-LD and noscript copy filled in. */
  const decorate = async (pathname: string, html: string) => {
    const loaded = await loadPage(matchPage(pathname), get);
    const edits = pageEdits(loaded, await pageImage(loaded));
    return edits ? { status: edits.status, html: applyEdits(html, edits) } : { status: 200, html };
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (options.testClock && req.method === "POST" && url.pathname === TEST_ADVANCE_DAY_PATH) {
      const day = options.testClock.advanceDay();
      return send(res, {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({ day }),
      });
    }
    const grant = options.testClock?.grantMaintainer;
    if (grant && req.method === "POST" && url.pathname === TEST_MAINTAINER_PATH) {
      // Only from this machine, so a self-host that forgot NODE_ENV can't be taken over remotely.
      if (!isLoopback(req.socket.remoteAddress)) {
        return send(res, {
          status: 404,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
          body: JSON.stringify({ error: { code: "not_found", message: "Not found." } }),
        });
      }
      const body = (await readJson(req)) as { residentId?: unknown } | undefined;
      const id = typeof body?.residentId === "string" ? body.residentId : "";
      const known = /^r_[0-9a-f]{16}$/.test(id) && options.service.state.residents[id];
      if (known) grant(id);
      return send(res, {
        status: known ? 200 : 400,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({ ok: Boolean(known) }),
      });
    }
    const reading = req.method === "GET" || req.method === "HEAD";
    // The staff app has its own host (admin.localhost here, admin.terrakin.org in production).
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (isAdminHost(host)) return admin(req, res, url);
    const moved = adminRedirect(new URL(url.pathname, `http://${req.headers.host ?? "localhost"}`));
    if (moved) {
      res.writeHead(302, { location: moved, "cache-control": "no-store" });
      return res.end();
    }
    if (url.pathname.startsWith(ADMIN_ASSET_PREFIX)) {
      return send(res, apiError("not_found", "Not found."));
    }
    const card = reading ? matchCardPath(url.pathname) : undefined;
    if (card) {
      const out = await serveCard(
        {
          route: card,
          version: url.searchParams.get("v"),
          ifNoneMatch: req.headers["if-none-match"] ?? null,
          ip: clientIp(req, options.trustedProxies),
        },
        cardDeps,
      );
      res.writeHead(out.status, out.headers);
      return res.end(req.method === "HEAD" ? undefined : out.body);
    }
    // An agent asking for Markdown gets the page's twin: a static file, or built from live data.
    const twin = reading
      ? negotiate(url.pathname, url.searchParams, req.headers.accept)
      : undefined;
    if (twin) {
      const live = await callApi(req, twin, url.searchParams);
      if (live) return send(res, { ...live, headers: { ...live.headers, ...twinHeaders() } });
      if (options.staticDir) return serveStatic(options.staticDir, twin, res, twinHeaders());
    }
    const response = await callApi(req, url.pathname, url.searchParams);
    if (response) return send(res, response);
    const mediaId = /^\/media\/([^/]+)$/.exec(url.pathname)?.[1];
    if (req.method === "GET" && mediaId !== undefined && options.media) {
      return serveMedia(options.media, mediaId, req, res);
    }
    if (options.staticDir) {
      return serveStatic(options.staticDir, url.pathname, res, {}, reading ? decorate : undefined);
    }
    return send(res, apiError("not_found", `No route for ${req.method} ${url.pathname}.`));
  }

  /** admin.*: the staff app's files, uploads, and the API it calls. */
  async function admin(req: IncomingMessage, res: ServerResponse, url: URL) {
    const response = await callApi(req, url.pathname, url.searchParams);
    if (response) return send(res, response);
    const mediaId = /^\/media\/([^/]+)$/.exec(url.pathname)?.[1];
    if (req.method === "GET" && mediaId !== undefined && options.media) {
      return serveMedia(options.media, mediaId, req, res);
    }
    if (!options.staticDir) return send(res, apiError("not_found", "Not found."));
    const file = adminAssetPath(url.pathname);
    return serveStatic(options.staticDir, file, res, ADMIN_PAGE_HEADERS, undefined, false);
  }

  function callApi(req: IncomingMessage, pathname: string, query: URLSearchParams) {
    const key = req.headers["idempotency-key"];
    return api.handle({
      method: req.method ?? "GET",
      pathname,
      ip: clientIp(req, options.trustedProxies),
      authorization: req.headers.authorization,
      query,
      readJson: () => readJson(req),
      readBytes: (max) => readBytes(req, max),
      contentLength:
        req.headers["content-length"] === undefined
          ? undefined
          : Number(req.headers["content-length"]),
      idempotencyKey: Array.isArray(key) ? key[0] : key,
      browserOrigin: req.headers.origin,
      fetchSite: header(req.headers["sec-fetch-site"]),
      contentType: req.headers["content-type"],
      ...requestOrigin(req, options.trustedProxies),
    });
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
  // Agent link rechecks (RFC 0007), the same rhythm as the Worker's alarm.
  const recheck = setInterval(() => {
    api.recheckAgentLinks().catch((err: unknown) => {
      console.error("Agent link recheck failed", err);
      report(err, "agent_link.recheck");
    });
  }, AGENT_RECHECK_EVERY_MS);
  recheck.unref();
  server.on("close", () => {
    clearInterval(sweep);
    clearInterval(recheck);
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

/** Rewrites a page's HTML before it's sent (`page-meta.ts`), and may change its status. */
type Decorate = (pathname: string, html: string) => Promise<{ status: number; html: string }>;

async function serveStatic(
  root: string,
  pathname: string,
  res: ServerResponse,
  extra: Record<string, string> = {},
  decorate?: Decorate,
  /** Answer unknown paths with the app's index.html (the main site does; the admin app doesn't). */
  spaFallback = true,
) {
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
  // The file itself, then `/docs` as docs.html (how Cloudflare's assets serve it too), then the
  // single-page app for every other deep link.
  const candidates = [file];
  if (extname(file) === "") candidates.push(`${file.replace(/[\\/]+$/, "")}.html`);
  if (spaFallback) candidates.push(join(base, "index.html"));
  let body: Buffer | undefined;
  for (const candidate of candidates) {
    try {
      body = readFileSync(candidate);
      file = candidate;
      break;
    } catch {
      // Missing, or a directory: try the next one.
    }
  }
  if (!body) return send(res, apiError("not_found", "Not found."));
  const type = MIME[extname(file)] ?? "application/octet-stream";
  const headers = { "content-type": type, ...pageHeaders(pathname, type), ...extra };
  if (decorate && extname(file) === ".html") {
    const page = await decorate(pathname, body.toString("utf8"));
    res.writeHead(page.status, { ...headers, "cache-control": "no-cache" });
    return res.end(page.html);
  }
  res.writeHead(200, headers);
  res.end(body);
}
