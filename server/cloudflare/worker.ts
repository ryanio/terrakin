import { DurableObject } from "cloudflare:workers";
import { cards } from "@terrakin/cards/worker";
import { buildOpenApi } from "@terrakin/protocol";
import SKILL_MD from "@terrakin/protocol/SKILL.md";
import { findProposal, votesCast } from "@terrakin/sim";
import { Api, ipKey, isApiPath, MAX_BODY_BYTES } from "../src/api";
import {
  MEDIA_ID,
  type MediaBucket,
  type MediaStore,
  readCapped,
  serveFromBucket,
} from "../src/media";
import { Moderation } from "../src/moderation";
import {
  type CardDeps,
  type CardRoute,
  matchCardPath,
  pageImage,
  RENDERS_PER_MINUTE,
  serveCard,
  windowLimiter,
} from "../src/og";
import { type ApiGet, loadPage, matchPage, pageEdits } from "../src/page-meta";
import { negotiate, pageHeaders, twinHeaders } from "../src/pages";
import { parseMaintainers, parseTownsfolk, SocialService } from "../src/social-service";
import { SqlStore } from "../src/sql-store";
import { WorldService } from "../src/world-service";
import { rewritePage } from "./meta-rewriter";

/**
 * Cloudflare adapter. The Worker serves the built client from static assets, serves uploads
 * straight from R2, and forwards `/v1/*` to one Durable Object, which holds the single
 * authoritative world (decision 0005) and keeps its log and social tables in the object's SQLite
 * storage. The routes and the live protocol are the same `Api` the Node server uses.
 */

interface Env {
  WORLD: DurableObjectNamespace<World>;
  ASSETS: Fetcher;
  /** Uploaded images, videos, and models (RFC 0003). */
  MEDIA: R2Bucket;
  /** Resident ids of the founding townsfolk (NPC badge), comma separated. Set in wrangler.jsonc vars. */
  TERRAKIN_TOWNSFOLK?: string;
  /** Resident ids of Town Hall maintainers (void proposals, answer petitions), comma separated. */
  TERRAKIN_MAINTAINERS?: string;
}

const OPENAPI = JSON.stringify(buildOpenApi());
const CANONICAL_HOST = "terrakin.org";

const jsonError = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "api-version": "1",
    },
  });

/** A copy of `response` with `headers` set on top of its own. */
function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (Object.keys(headers).length === 0) return response;
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
  return copy;
}

/** Card renders one IP (or IPv6 /64) may cause per minute, counted per isolate. */
const allowRender = windowLimiter(RENDERS_PER_MINUTE, 60_000);

/** A GET against the world's API from inside the Worker: the same data every client sees. */
function apiGet(env: Env, origin: string): ApiGet {
  return async (path) => {
    const res = await env.WORLD.get(env.WORLD.idFromName("world")).fetch(
      new Request(new URL(path, origin)),
    );
    const json = res.ok && res.headers.get("content-type")?.startsWith("application/json");
    return { status: res.status, body: json ? await res.json() : undefined };
  };
}

/** `/og/...png`: a link preview card, from the edge cache or drawn here (never in the world object). */
async function card(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  route: CardRoute,
): Promise<Response> {
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheUrl = (key: string) => `${url.origin}/og-cache/${key}.png`;
  const deps: CardDeps = {
    get: apiGet(env, url.origin),
    loadMedia: async (id) => {
      if (!MEDIA_ID.test(id)) return undefined;
      const object = await env.MEDIA.get(id);
      return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
    },
    render: (c) => cards.render(c),
    cache: {
      get: async (key) => {
        const hit = await cache.match(cacheUrl(key)).catch(() => undefined);
        return hit ? new Uint8Array(await hit.arrayBuffer()) : undefined;
      },
      put: (key, png) => {
        const stored = new Response(png.slice(), {
          headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000" },
        });
        ctx.waitUntil(cache.put(cacheUrl(key), stored).catch(() => {}));
      },
    },
    allowRender: (ip) => allowRender(ipKey(ip)),
  };
  const out = await serveCard(
    {
      route,
      version: url.searchParams.get("v"),
      ifNoneMatch: request.headers.get("if-none-match"),
      ip: request.headers.get("cf-connecting-ip") ?? "unknown",
    },
    deps,
  );
  const body = request.method === "HEAD" || !out.body ? null : out.body.slice();
  return new Response(body, { status: out.status, headers: out.headers });
}

/** A page's HTML with its title, meta tags, JSON-LD and noscript copy filled in. */
async function page(request: Request, env: Env, asset: Response): Promise<Response> {
  const url = new URL(request.url);
  const loaded = await loadPage(matchPage(url.pathname), apiGet(env, url.origin));
  const edits = pageEdits(loaded, await pageImage(loaded));
  return edits ? rewritePage(asset, edits, new HTMLRewriter()) : asset;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }
    const world = () => env.WORLD.get(env.WORLD.idFromName("world"));
    const reading = request.method === "GET" || request.method === "HEAD";
    // An agent asking for Markdown gets the page's twin: a static file, or built from live data.
    const twin = reading
      ? negotiate(url.pathname, url.searchParams, request.headers.get("accept"))
      : undefined;
    if (twin) {
      const target = new Request(new URL(twin, url), request);
      const response = await (isApiPath(twin) ? world().fetch(target) : env.ASSETS.fetch(target));
      return withHeaders(response, response.ok ? twinHeaders() : { vary: "Accept" });
    }
    if (isApiPath(url.pathname)) return world().fetch(request);
    const mediaId = /^\/media\/([^/]+)$/.exec(url.pathname)?.[1];
    if (mediaId !== undefined && reading) {
      return serveFromBucket(env.MEDIA as unknown as MediaBucket, mediaId, request);
    }
    const route = reading ? matchCardPath(url.pathname) : undefined;
    if (route) return card(request, env, ctx, route);
    // Page paths have no extension. Their HTML is rewritten per request, so ask the assets for
    // the whole file rather than a 304 against an ETag the rewritten page never carries.
    const pagePath = reading && !/\.[a-z0-9]+$/i.test(url.pathname);
    const assetRequest = pagePath ? new Request(request) : request;
    if (pagePath) {
      assetRequest.headers.delete("if-none-match");
      assetRequest.headers.delete("if-modified-since");
    }
    let response = await env.ASSETS.fetch(assetRequest);
    const type = response.headers.get("content-type");
    // A page path answered with HTML is index.html (an app page, or the single-page fallback for
    // a path that doesn't exist) or a page with its own file, like /docs.
    if (pagePath && response.status === 200 && type?.startsWith("text/html")) {
      response = await page(request, env, response);
    }
    return withHeaders(response, response.ok ? pageHeaders(url.pathname, type) : {});
  },
} satisfies ExportedHandler<Env>;

export class World extends DurableObject<Env> {
  private readonly api: Api;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const townsfolk = parseTownsfolk(env.TERRAKIN_TOWNSFOLK);
    const maintainers = parseMaintainers(env.TERRAKIN_MAINTAINERS);
    // One set of edge filters for the world and the social layer (RFC 0006).
    const moderation = new Moderation({
      privileged: (id) => townsfolk.has(id) || maintainers.has(id),
    });
    const service = new WorldService({
      store: new SqlStore(ctx.storage.sql),
      days: true,
      townsfolk,
      moderation,
    });
    const media: MediaStore = {
      put: async (id, bytes, type) => {
        await env.MEDIA.put(id, bytes, { httpMetadata: { contentType: type } });
      },
      get: async (id) => {
        const object = await env.MEDIA.get(id);
        return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
      },
      delete: (id) => env.MEDIA.delete(id),
    };
    const social = new SocialService({
      sql: ctx.storage.sql,
      media,
      resident: (id) => service.state.residents[id],
      townsfolk,
      maintainers,
      votesCast: (id) => votesCast(service.state, id),
      moderation,
      residentAgeDays: (id) => service.residentAgeDays(id),
      proposal: (id) => findProposal(service.state, id),
    });
    this.api = new Api({ service, social, skill: SKILL_MD, openapi: OPENAPI });
    // Runs while the object is in memory: idle sweeps and the Town Hall's clock. If it's evicted,
    // nobody is connected; the next boot marks everyone offline, and boot and every request catch
    // the day up and close what's due.
    setInterval(() => this.api.sweep(), 60_000);
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request);
    } catch (err) {
      // Same contract as the Node server: errors are always JSON, never Cloudflare's HTML page.
      console.error(err);
      return jsonError(500, "internal", "Something broke on our side.");
    }
  }

  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Set by Cloudflare's edge and not spoofable by the client, unlike X-Forwarded-For.
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";

    if (url.pathname === "/v1/live") {
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return jsonError(426, "bad_request", "Connect to /v1/live with a WebSocket.");
      }
      const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
      server.accept();
      const session = this.api.live(ip, {
        send: (text) => {
          try {
            server.send(text);
          } catch {
            // Already closed; the close handler cleans up.
          }
        },
        close: (code, reason) => {
          try {
            server.close(code, reason);
          } catch {
            // Already closed.
          }
        },
      });
      server.addEventListener("message", (event) => {
        session.onMessage(
          typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data),
        );
      });
      server.addEventListener("close", () => session.onClose());
      server.addEventListener("error", () => session.onClose());
      return new Response(null, { status: 101, webSocket: client });
    }

    const length = request.headers.get("content-length");
    const response = await this.api.handle({
      method: request.method,
      pathname: url.pathname,
      ip,
      authorization: request.headers.get("authorization") ?? undefined,
      query: url.searchParams,
      readJson: () => readJson(request),
      readBytes: (max) => readCapped(request.body, max),
      contentLength: length === null ? undefined : Number(length),
      // Links in Markdown answers always point at https on the real domain, even for a plain
      // http request; anywhere else (local dev), at whatever the request used.
      origin: url.hostname === CANONICAL_HOST ? `https://${CANONICAL_HOST}` : url.origin,
      idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
    });
    if (!response) return jsonError(404, "not_found", "Not found.");
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
}

async function readJson(request: Request): Promise<unknown> {
  const bytes = await readCapped(request.body, MAX_BODY_BYTES);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}
