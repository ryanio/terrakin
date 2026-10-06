import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { instrumentDurableObjectWithSentry, withSentry } from "@sentry/cloudflare";
import { cards } from "@terrakin/cards/worker";
import { buildOpenApi } from "@terrakin/protocol";
import SKILL_MD from "@terrakin/protocol/SKILL.md";
import { entitledTo, findProposal, residentById, votesCast } from "@terrakin/sim";
import { AccessVerifier, accessConfig, parseEmails, parseStaffResidents } from "../src/access";
import { adminAssetPath, adminGate, isMissingAdminFile } from "../src/admin-host";
import { nextRecheckAt, parseDailyReads } from "../src/agent-links";
import { Api, ipKey, isApiPath, MAX_BODY_BYTES } from "../src/api";
import { bountyWords } from "../src/bounties";
import { parseRpcUrls } from "../src/chain";
import { ChatterService, chatterConfig } from "../src/chatter";
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
import {
  ADMIN_ASSET_PREFIX,
  ADMIN_PAGE_HEADERS,
  adminRedirect,
  isAdminHost,
  negotiate,
  pageHeaders,
  STAFF_EMAIL_HEADER,
  toWorld,
  twinHeaders,
} from "../src/pages";
import { materializePlot, type PlotPhotoSpec } from "../src/plot-photo";
import { parseMaintainers, parseTownsfolk, SocialService } from "../src/social-service";
import { SqlStore } from "../src/sql-store";
import { report, sentryOptions, span } from "../src/telemetry";
import { TriageClient, triageConfig } from "../src/triage";
import { WorldService } from "../src/world-service";
import { rewritePage } from "./meta-rewriter";

/**
 * Cloudflare adapter. The Worker serves the built client from static assets, serves uploads
 * straight from R2, and forwards `/v1/*` to one Durable Object, which holds the single
 * authoritative world (decision 0005) and keeps its log and social tables in the object's SQLite
 * storage. The routes and the live protocol are the same `Api` the Node server uses.
 */

interface Env {
  WORLD: DurableObjectNamespace<WorldObject>;
  ASSETS: Fetcher;
  /** Uploaded images, videos, and models (RFC 0003). */
  MEDIA: R2Bucket;
  /**
   * This Worker's own `PlotPhotos` entrypoint (wrangler.jsonc `services`). The World object asks it
   * to draw plot photos, so the drawing runs in the Worker, never in the world.
   */
  PHOTOS: Service<PlotPhotos>;
  /** Resident ids of the founding townsfolk (NPC badge), comma separated. Set in wrangler.jsonc vars. */
  TERRAKIN_TOWNSFOLK?: string;
  /** Resident ids of Town Hall maintainers (void proposals, answer petitions), comma separated. */
  TERRAKIN_MAINTAINERS?: string;
  /** Where error reports, traces, and logs go (decision 0037). Unset means none are sent. */
  SENTRY_DSN?: string;
  /** Which deploy is running, so a report names its release. */
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  /** Resident ids of moderators: the review queue only (RFC 0006). */
  TERRAKIN_MODERATORS?: string;
  /** Cloudflare Access in front of admin.terrakin.org: the team domain and the app's audience tag. */
  TERRAKIN_ACCESS_TEAM?: string;
  TERRAKIN_ACCESS_AUD?: string;
  /** Access emails with each staff role, comma separated. */
  TERRAKIN_MAINTAINER_EMAILS?: string;
  TERRAKIN_MODERATOR_EMAILS?: string;
  /** Which resident each staff email also is, as `email=residentId` pairs. A secret. */
  TERRAKIN_STAFF_RESIDENTS?: string;
  /** AI triage (decision 0040). A Worker secret; without it, triage is off. */
  ANTHROPIC_API_KEY?: string;
  TERRAKIN_TRIAGE_MODEL?: string;
  TERRAKIN_TRIAGE_DAILY_CALLS?: string;
  TERRAKIN_TRIAGE_DAILY_TOKENS?: string;
  /** Townsfolk chatter (docs/plans/townsfolk-chatter.md). Off until the daily calls are above 0. */
  TERRAKIN_CHATTER_MODEL?: string;
  TERRAKIN_CHATTER_DAILY_CALLS?: string;
  TERRAKIN_CHATTER_DAILY_TOKENS?: string;
  /** `dry` (the default) stores drafts and posts nothing; `posts` posts and likes; `all` replies too. */
  TERRAKIN_CHATTER_MODE?: string;
  /** Agent links (RFC 0007): RPC URLs per network, like `4663=https://...`. Default: public endpoints. */
  TERRAKIN_CHAIN_RPC?: string;
  /** Reads (network calls and card fetches) per UTC day for agent links. Default 20,000. */
  TERRAKIN_CHAIN_DAILY_READS?: string;
}

/** The Access verifier, with its key cache, lives as long as the isolate. */
let verifier: { key: string; verifier: AccessVerifier } | undefined;
function accessVerifier(env: Env): AccessVerifier | undefined {
  const config = accessConfig(env.TERRAKIN_ACCESS_TEAM, env.TERRAKIN_ACCESS_AUD);
  if (!config) return undefined;
  const key = `${config.team} ${config.aud}`;
  if (verifier?.key !== key) verifier = { key, verifier: new AccessVerifier(config) };
  return verifier.verifier;
}

/**
 * admin.terrakin.org: the staff app and the API it calls (RFC 0006, decision 0040). With Access set
 * up, every request needs a valid Access sign-in, checked here as well as at Cloudflare's edge, and
 * the real admin host refuses to run without it (`adminGate`).
 */
async function admin(request: Request, env: Env, url: URL): Promise<Response> {
  const gate = await adminGate(request, url, {
    verifier: accessVerifier(env),
    requireAccess: url.hostname === `admin.${CANONICAL_HOST}`,
  });
  if ("refuse" in gate) return gate.refuse;
  if (isApiPath(url.pathname)) {
    return env.WORLD.get(env.WORLD.idFromName("world")).fetch(toWorld(request, url, gate.email));
  }
  const reading = request.method === "GET" || request.method === "HEAD";
  const mediaId = /^\/media\/([^/]+)$/.exec(url.pathname)?.[1];
  if (mediaId !== undefined && reading) {
    return serveFromBucket(env.MEDIA as unknown as MediaBucket, mediaId, request);
  }
  // The admin app's files, or its page for every other path. The assets binding serves a folder's
  // index.html at the folder's own path, so the page is fetched as /_admin/.
  const path = adminAssetPath(url.pathname).replace(/index\.html$/, "");
  const response = await env.ASSETS.fetch(new Request(new URL(path, url), request));
  if (isMissingAdminFile(path, response.headers.get("content-type"))) {
    return new Response("Not found.", {
      status: 404,
      headers: { ...ADMIN_PAGE_HEADERS, "content-type": "text/plain; charset=utf-8" },
    });
  }
  return withHeaders(response, ADMIN_PAGE_HEADERS);
}

/** The same Sentry setup for the Worker and the World object. */
const sentry = (env: Env) => sentryOptions(env.SENTRY_DSN, env.CF_VERSION_METADATA?.id);

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
  const out = await span("card", "card.serve", () =>
    serveCard(
      {
        route,
        version: url.searchParams.get("v"),
        ifNoneMatch: request.headers.get("if-none-match"),
        ip: request.headers.get("cf-connecting-ip") ?? "unknown",
      },
      deps,
    ),
  );
  const body = request.method === "HEAD" || !out.body ? null : out.body.slice();
  return new Response(body, { status: out.status, headers: out.headers });
}

/** A page's HTML with its title, meta tags, JSON-LD and noscript copy filled in. */
async function page(request: Request, env: Env, asset: Response): Promise<Response> {
  const url = new URL(request.url);
  const matched = matchPage(url.pathname);
  return span(
    "page.meta",
    "page.meta",
    async () => {
      const loaded = await loadPage(matched, apiGet(env, url.origin));
      const edits = pageEdits(loaded, await pageImage(loaded));
      return edits ? rewritePage(asset, edits, new HTMLRewriter()) : asset;
    },
    { page: matched.name },
  );
}

const handler = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }
    if (isAdminHost(url.hostname)) return admin(request, env, url);
    // The staff app lives on its own host; its files aren't served here.
    const moved = adminRedirect(url);
    if (moved) return Response.redirect(moved, 302);
    if (url.pathname.startsWith(ADMIN_ASSET_PREFIX)) {
      return jsonError(404, "not_found", "Not found.");
    }
    const world = () => env.WORLD.get(env.WORLD.idFromName("world"));
    const reading = request.method === "GET" || request.method === "HEAD";
    // An agent asking for Markdown gets the page's twin: a static file, or built from live data.
    const twin = reading
      ? negotiate(url.pathname, url.searchParams, request.headers.get("accept"))
      : undefined;
    if (twin) {
      const target = new Request(new URL(twin, url), request);
      const response = await (isApiPath(twin)
        ? world().fetch(toWorld(target, new URL(twin, url)))
        : env.ASSETS.fetch(target));
      return withHeaders(response, response.ok ? twinHeaders() : { vary: "Accept" });
    }
    if (isApiPath(url.pathname)) return world().fetch(toWorld(request, url));
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

  /**
   * The cron in wrangler.jsonc: a round of townsfolk chatter in the World object, over RPC, so
   * there's no public route for it. Chatter checks its own gate and spend guard.
   */
  async scheduled(_controller, env, ctx) {
    // While chatter is off, don't wake the world (a cold object replays its log to boot).
    const config = chatterConfig(env);
    if (config.apiKey === undefined || config.callsPerDay === 0) return;
    const world = env.WORLD.get(env.WORLD.idFromName("world"));
    ctx.waitUntil(
      world.chatter().catch((err: unknown) => {
        console.error(err);
        report(err, "chatter.run");
      }),
    );
  },
} satisfies ExportedHandler<Env>;

export default withSentry(sentry, handler);

class WorldObject extends DurableObject<Env> {
  private readonly api: Api;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const townsfolk = parseTownsfolk(env.TERRAKIN_TOWNSFOLK);
    const maintainers = parseMaintainers(env.TERRAKIN_MAINTAINERS);
    const moderators = parseMaintainers(env.TERRAKIN_MODERATORS);
    // One set of edge filters for the world and the social layer (RFC 0006).
    const moderation = new Moderation({
      privileged: (id) => townsfolk.has(id) || maintainers.has(id) || moderators.has(id),
    });
    const service = new WorldService({
      // Snapshots are written in one transaction; a Durable Object refuses BEGIN.
      store: new SqlStore(ctx.storage.sql, (fn) => ctx.storage.transactionSync(fn)),
      days: true,
      economy: true,
      items: true,
      gifts: true,
      plotPickups: true,
      shop: true,
      market: true,
      bounties: true,
      presence: true,
      townsfolk,
      maintainers,
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
      resident: (id) => residentById(service.state, id),
      entitledTo: (id) => entitledTo(service.state, id),
      townsfolk,
      maintainers,
      votesCast: (id) => votesCast(service.state, id),
      credits: (since) => service.credits(since),
      moderation,
      residentAgeDays: (id) => service.residentAgeDays(id),
      proposal: (id) => findProposal(service.state, id),
      bounty: (id) => bountyWords(service.state, id),
      moderators,
      triage: new TriageClient(triageConfig(env), ctx.storage.sql),
      agentLinks: {
        rpcUrls: parseRpcUrls(env.TERRAKIN_CHAIN_RPC),
        ...parseDailyReads(env.TERRAKIN_CHAIN_DAILY_READS),
        onLinked: () => {
          void this.armRecheck();
        },
      },
    });
    this.api = new Api({
      service,
      social,
      skill: SKILL_MD,
      openapi: OPENAPI,
      chatter: new ChatterService({
        config: chatterConfig(env),
        social,
        townsfolk,
        residentAgeDays: (id) => service.residentAgeDays(id),
      }),
      // Plot photos are drawn by the Worker (PlotPhotos), never in this object.
      photos: (spec) => env.PHOTOS.draw(spec),
      staff: {
        access: accessConfig(env.TERRAKIN_ACCESS_TEAM, env.TERRAKIN_ACCESS_AUD) !== undefined,
        maintainerEmails: parseEmails(env.TERRAKIN_MAINTAINER_EMAILS),
        moderatorEmails: parseEmails(env.TERRAKIN_MODERATOR_EMAILS),
        staffResidents: parseStaffResidents(env.TERRAKIN_STAFF_RESIDENTS, {
          isResident: (id) => residentById(service.state, id) !== undefined,
        }),
      },
    });
    // Runs while the object is in memory: idle sweeps, the Town Hall's clock, and snapshot
    // verification. If it's evicted, nobody is connected; the next boot marks everyone offline,
    // and boot and every request catch the day up and close what's due.
    setInterval(() => this.api.sweep(), 60_000);
    // A link made before a restart still needs its rechecks.
    void this.armRecheck();
  }

  /**
   * Agent links are rechecked from the object's alarm (RFC 0007), which wakes it even when nobody
   * is connected. The alarm is set only while links exist, for when the next one is due, and never
   * sooner than AGENT_RECHECK_EVERY_MS from now.
   */
  private nextRecheck(): number | undefined {
    return nextRecheckAt(Date.now(), this.api.nextAgentRecheckAt());
  }

  private async armRecheck(): Promise<void> {
    const when = this.nextRecheck();
    if (when === undefined) return;
    const set = await this.ctx.storage.getAlarm();
    if (set !== null && set <= when) return;
    await this.ctx.storage.setAlarm(when);
  }

  /** A round of townsfolk chatter, from the Worker's cron. Answers with counts and codes only. */
  async chatter(): Promise<{ skipped?: string; outcomes: string[] }> {
    return this.api.runChatter();
  }

  override async alarm(): Promise<void> {
    try {
      await this.api.recheckAgentLinks();
    } catch (err) {
      console.error(err);
      report(err, "agent_link.recheck");
    } finally {
      const when = this.nextRecheck();
      if (when !== undefined) await this.ctx.storage.setAlarm(when);
    }
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request);
    } catch (err) {
      // Same contract as the Node server: errors are always JSON, never Cloudflare's HTML page.
      console.error(err);
      report(err, "world.fetch");
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
      // Only the Worker in front sets this, from an Access JWT it verified (see toWorld).
      staffEmail: request.headers.get(STAFF_EMAIL_HEADER) ?? undefined,
      browserOrigin: request.headers.get("origin") ?? undefined,
      fetchSite: request.headers.get("sec-fetch-site") ?? undefined,
      contentType: request.headers.get("content-type") ?? undefined,
    });
    if (!response) return jsonError(404, "not_found", "Not found.");
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  }
}

/**
 * Draws plot photos (issue #34) for the World object, over RPC through the `PHOTOS` binding. Not
 * reachable from the internet: only a service binding can call a named entrypoint.
 */
export class PlotPhotos extends WorkerEntrypoint<Env> {
  async draw(spec: PlotPhotoSpec): Promise<Uint8Array> {
    const card = await materializePlot(spec, async (id) => {
      if (!MEDIA_ID.test(id)) return undefined;
      const object = await this.env.MEDIA.get(id);
      return object ? new Uint8Array(await object.arrayBuffer()) : undefined;
    });
    return (await cards.render(card)).bytes;
  }
}

/** The single authoritative world. Its name is the class name in wrangler.jsonc. */
export const World = instrumentDurableObjectWithSentry(sentry, WorldObject);

async function readJson(request: Request): Promise<unknown> {
  const bytes = await readCapped(request.body, MAX_BODY_BYTES);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}
