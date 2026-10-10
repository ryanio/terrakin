import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import { cards } from "@terrakin/cards/node";
import { buildOpenApi } from "@terrakin/protocol";
import { WebSocketServer } from "ws";
import { adminAssetPath } from "./admin-host";
import { AGENT_RECHECK_EVERY_MS } from "./agent-links";
import { Api, type ApiOptions, type ApiResponse, MAX_BODY_BYTES } from "./api";
import { CHATTER_EVERY_MS, type ChatterService } from "./chatter";
import { staticArrival } from "./discovery-log";
import { ipKey } from "./handlers/shared";
import { MEDIA_ID, mediaHeaders, type ReadableMediaStore, sniffMediaType } from "./media";
import { applyEdits } from "./meta-html";
import {
  type CardDeps,
  matchCardPath,
  PICTURE_DRAWS_PER_MINUTE,
  PICTURES_PER_MINUTE,
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
import type { TownsfolkLessons } from "./townsfolk-lessons";
import { TIPS_CHECK_MS, type TownsfolkTips } from "./townsfolk-tips";
import type { TownsfolkWelcome } from "./townsfolk-welcome";
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
  /** Townsfolk chatter, run every `CHATTER_EVERY_MS` like the Worker's cron. Default: none. */
  chatter?: ChatterService;
  /** The townsfolk's daily coin tips, asked every `TIPS_CHECK_MS`; they run once a day. Default: none. */
  tips?: TownsfolkTips;
  /** Welcome visits and greetings (decisions 0142, 0237), run by the minute sweep. Default: none. */
  welcome?: TownsfolkWelcome;
  /** Townsfolk lessons (RFC 0024), run by the minute sweep. Default: none. */
  lessons?: TownsfolkLessons;
  /**
   * Tests only (`TERRAKIN_TEST_CLOCK=1`): answers `POST /v1/test/advance-day` by moving the clock
   * a day on, or `?days=N` days (1 to 400) in one jump, which the world takes as one `new_day`, or
   * `?minutes=N` minutes on (1 to 1,440), for an event's start, and `POST /v1/test/sweep` by
   * running the minute sweep now (idle residents, routines, snapshots), and `POST /v1/test/grant`
   * (`TEST_GRANT_PATH`), `POST /v1/test/open-recipes` (`TEST_OPEN_RECIPES_PATH`), and
   * `POST /v1/test/open-levels` (`TEST_OPEN_LEVELS_PATH`) from this machine. It's deliberately outside
   * the route table, so it never appears in the API docs, and the Cloudflare adapter has no way to
   * turn it on.
   */
  testClock?: {
    advanceDay(days: number, minutes?: number): number | null;
    grantMaintainer?(residentId: string): void;
  };
}

/** The test clock's route that moves the world to the next day. See `AppOptions.testClock`. */
export const TEST_ADVANCE_DAY_PATH = "/v1/test/advance-day";
/** Tests only, with the test clock: `POST {"residentId"}` makes that resident a maintainer. */
const TEST_MAINTAINER_PATH = "/v1/test/maintainer";
/** Tests only, with the test clock: runs the minute sweep now, so routines due now take their steps. */
export const TEST_SWEEP_PATH = "/v1/test/sweep";
/**
 * Tests only, with the test clock, from this machine: `POST {"residentId", "coins"?, "stacks"?}`
 * gives a resident coins from the treasury and stacks of things (decision 0147).
 */
export const TEST_GRANT_PATH = "/v1/test/grant";
/**
 * Tests only, with the test clock, from this machine: logs `open_recipes` now (RFC 0024), so a spec
 * can make residents before and after it. Answers the sim's refusal when recipes are already open.
 */
export const TEST_OPEN_RECIPES_PATH = "/v1/test/open-recipes";
/**
 * Tests only, with the test clock, from this machine: logs `open_levels` now (RFC 0029) with the
 * one-time credit from the collection book, so a spec or a `pnpm dev:test` world has levels.
 * Answers the sim's refusal when levels are already open.
 */
export const TEST_OPEN_LEVELS_PATH = "/v1/test/open-levels";

/**
 * How long an idle keep-alive connection stays open (decision 0130). A client that reuses a
 * connection just as the server closes it gets ECONNRESET, and clients that keep connections in a
 * pool (Node's agent, Playwright's request context) don't retry. Node's default is 5 seconds, which
 * pooled clients and the reverse proxies in front of a self-hosted server both outlast; 65 seconds
 * is longer than the 60 that nginx and most load balancers keep an idle upstream connection.
 */
const KEEP_ALIVE_MS = 65_000;

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
function requestOrigin(req: IncomingMessage, trustedProxies = 0): { origin?: string } {
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
    ...(options.chatter ? { chatter: options.chatter } : {}),
    ...(options.tips ? { tips: options.tips } : {}),
    ...(options.welcome ? { welcome: options.welcome } : {}),
    ...(options.lessons ? { lessons: options.lessons } : {}),
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
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  // A request's headers on a reused connection must arrive within this, so it outlasts the idle
  // wait, or Node can drop a connection the client was about to use.
  server.headersTimeout = KEEP_ALIVE_MS + 1_000;

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

  // Cards drawn here stay in memory, the most recent few dozen, and so do the short-lived
  // pointers to which picture by link a path shows.
  const rendered = new Map<string, { bytes: Uint8Array; until: number }>();
  const allowRender = windowLimiter(RENDERS_PER_MINUTE, 60_000);
  const allowPicture = windowLimiter(PICTURES_PER_MINUTE, 60_000);
  const allowDraw = windowLimiter(PICTURE_DRAWS_PER_MINUTE, 60_000);
  const cardDeps: CardDeps = {
    get,
    loadMedia: async (id) => options.media?.get(id),
    render: (card) => cards.render(card),
    cache: {
      get: async (key) => {
        const entry = rendered.get(key);
        if (entry && entry.until <= Date.now()) rendered.delete(key);
        return entry && entry.until > Date.now() ? entry.bytes : undefined;
      },
      put: (key, bytes, ttl) => {
        rendered.delete(key);
        rendered.set(key, { bytes, until: ttl === undefined ? Infinity : Date.now() + ttl * 1000 });
        if (rendered.size > 128) rendered.delete(rendered.keys().next().value ?? key);
      },
    },
    allowRender: (ip, take) => allowRender(ipKey(ip), take),
    picture: async (route) => api.pictureSpec(route),
    allowPicture: (ip) => allowPicture(ipKey(ip)),
    allowDraw: () => allowDraw("all"),
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
      const days = Math.min(
        400,
        Math.max(1, Math.trunc(Number(url.searchParams.get("days"))) || 1),
      );
      const asked = Math.trunc(Number(url.searchParams.get("minutes")));
      const minutes = asked >= 1 ? Math.min(1_440, asked) : undefined;
      const day = options.testClock.advanceDay(days, minutes);
      return send(res, {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({ day }),
      });
    }
    if (options.testClock && req.method === "POST" && url.pathname === TEST_SWEEP_PATH) {
      api.sweep();
      return send(res, {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({ ok: true }),
      });
    }
    if (options.testClock && req.method === "POST" && url.pathname === TEST_GRANT_PATH) {
      const json = { "content-type": "application/json", "cache-control": "no-store" };
      // Coins and things: only from this machine, like the maintainer grant below.
      if (!isLoopback(req.socket.remoteAddress)) {
        return send(res, {
          status: 404,
          headers: json,
          body: JSON.stringify({ error: { code: "not_found", message: "Not found." } }),
        });
      }
      const body = (await readJson(req)) as
        | { residentId?: unknown; coins?: unknown; stacks?: unknown }
        | undefined;
      const stacks = body?.stacks;
      const counts =
        stacks !== null &&
        typeof stacks === "object" &&
        !Array.isArray(stacks) &&
        Object.values(stacks).every((n) => typeof n === "number");
      if (
        typeof body?.residentId !== "string" ||
        (body.coins !== undefined && typeof body.coins !== "number") ||
        (stacks !== undefined && !counts)
      ) {
        return send(res, {
          status: 400,
          headers: json,
          body: JSON.stringify({
            ok: false,
            error: { code: "invalid_body", message: "Bad grant." },
          }),
        });
      }
      const result = options.service.testGrant(
        body.residentId,
        body.coins as number | undefined,
        stacks as Record<string, number> | undefined,
      );
      return send(res, {
        status: result.ok ? 200 : 400,
        headers: json,
        body: JSON.stringify(result.ok ? { ok: true } : { ok: false, error: result.error }),
      });
    }
    // The switches a test turns on now: recipes (RFC 0024) and levels (RFC 0029). Only from this
    // machine, like the grant above.
    const openNow =
      url.pathname === TEST_OPEN_RECIPES_PATH
        ? () => options.service.testOpenRecipes()
        : url.pathname === TEST_OPEN_LEVELS_PATH
          ? () => options.service.testOpenLevels()
          : undefined;
    if (options.testClock && req.method === "POST" && openNow) {
      const json = { "content-type": "application/json", "cache-control": "no-store" };
      if (!isLoopback(req.socket.remoteAddress)) {
        return send(res, {
          status: 404,
          headers: json,
          body: JSON.stringify({ error: { code: "not_found", message: "Not found." } }),
        });
      }
      const result = openNow();
      return send(res, {
        status: result.ok ? 200 : 400,
        headers: json,
        body: JSON.stringify(result.ok ? { ok: true } : { ok: false, error: result.error }),
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
    // llms.txt is a static file: a read with a partner's `?from=` is counted, as on the Worker.
    const arrival =
      req.method === "GET" ? staticArrival(url.pathname, url.searchParams) : undefined;
    if (arrival) api.noteArrival(arrival.file, arrival.from);
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
      ifNoneMatch: header(req.headers["if-none-match"]),
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
  // The game tables' clock (RFC 0011): a live round's window holds to the second.
  const games = setInterval(() => api.gameClock(), 1_000);
  games.unref();
  // Agent link rechecks (RFC 0007), the same rhythm as the Worker's alarm.
  const recheck = setInterval(() => {
    api.recheckAgentLinks().catch((err: unknown) => {
      console.error("Agent link recheck failed", err);
      report(err, "agent_link.recheck");
    });
  }, AGENT_RECHECK_EVERY_MS);
  recheck.unref();
  // Townsfolk chatter on the cron's rhythm. It checks its own gate and guard, so a run while it's
  // off or while the town is busy does nothing.
  const chatter = options.chatter
    ? setInterval(() => {
        api.runChatter().catch((err: unknown) => {
          console.error("Chatter run failed", err);
          report(err, "chatter.run");
        });
      }, CHATTER_EVERY_MS)
    : undefined;
  chatter?.unref();
  // The coin tips, on the hour; they give once a UTC day, like the Worker's daily cron.
  const tips =
    options.tips && options.tips.mode !== "off"
      ? setInterval(() => {
          try {
            api.runTips();
          } catch (err) {
            console.error("Townsfolk tips failed", err);
            report(err, "tips.run");
          }
        }, TIPS_CHECK_MS)
      : undefined;
  tips?.unref();
  server.on("close", () => {
    clearInterval(sweep);
    clearInterval(games);
    clearInterval(recheck);
    if (chatter) clearInterval(chatter);
    if (tips) clearInterval(tips);
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
