import {
  type AcceptInviteRequest,
  Action,
  acceptsIdempotencyKey,
  compileRoutes,
  type ErrorCode,
  type EventResponse,
  INVITE_PLOT_SUGGESTIONS,
  type Issue,
  isBinaryBody,
  isWriteRoute,
  JOIN_CONFIRM_CODE,
  MAX_BODY_BYTES,
  MODERATOR_SUSPEND_MAX_DAYS,
  markdownErrorCode,
  type ProfileView,
  plainProblem,
  RATE_LIMITS,
  type RateLimitName,
  REPEAT_WINDOW_MS,
  ROUTES,
  type RouteId,
  type RouteMatch,
  type RouteSpec,
  type StaffRole,
  suggestFor,
  type TownsfolkActivityResponse,
} from "@terrakin/protocol";
import {
  eventOpen,
  findBounty,
  findEvent,
  type HostedEvent,
  homePlotOf,
  isTownEvent,
} from "@terrakin/sim";
import { AiSpend } from "./ai-spend";
import {
  API_HEADERS,
  type ApiResponse,
  error,
  errorCode,
  keepable,
  rateLimitHeaders,
  render,
  stored,
  withHeaders,
} from "./api-response";
import { wireSocial } from "./api-wiring";
import { bountyView } from "./bounties";
import type { ChatterRun, ChatterService } from "./chatter";
import { fromParam, type StartFile } from "./discovery-log";
import { eventView } from "./events";
import { docsHandlers } from "./handlers/docs";
import { eventHandlers } from "./handlers/events";
import { ownerHandlers } from "./handlers/owners";
import { safetyHandlers } from "./handlers/safety";
import {
  type AnyHandler,
  DAILY_CAP_RETRY_SECONDS,
  type Failure,
  fail,
  fromResult,
  type Handlers,
  INVITE_GONE,
  ipKey,
  RATE_LIMITED,
  type Reply,
  STAFF_ONLY,
  type Upload,
  unauthorized,
} from "./handlers/shared";
import { siteHandlers } from "./handlers/site";
import { socialHandlers } from "./handlers/social";
import { togetherHandlers } from "./handlers/together";
import { townHallHandlers } from "./handlers/town-hall";
import { worldHandlers } from "./handlers/world";
import { IdempotencyStore, sha256Hex } from "./idempotency";
import { BAD_LINK_KEY, DEFAULT_ORIGIN, linkHandlers, linkHelp, REPEAT_NOTE } from "./links";
import {
  familyMiss,
  LiveSession,
  type LiveSocket,
  MAX_WATCHERS,
  MAX_WATCHERS_PER_NETWORK,
  PostListeners,
} from "./live";
import type { ListerFacts } from "./market";
import { COOL_DOWN_MESSAGE, type Moderation } from "./moderation";
import { OwnerService } from "./owner-service";
import type { PartnerResidents } from "./partner-residents";
import { findPartner } from "./partners";
import { type PlotPhotoRenderer, plotPhotoSpec } from "./plot-photo";
import { type PlotViewer, shownPlotName } from "./plots";
import { RateLimiters } from "./rate-limit";
import { type Routines, type RoutinesRun, runRoutines } from "./routines";
import type { SocialService } from "./social-service";
import { count, crumb, nameRequest, report, span, task } from "./telemetry";
import { anchorPlot, suggestPlots } from "./together";
import { chatterStatus, tipsStatus, townsfolkActivity } from "./townsfolk-status";
import type { TipsResult, TownsfolkTips } from "./townsfolk-tips";
import type { TownsfolkWelcome, WelcomeRun } from "./townsfolk-welcome";
import { DAY_MS, utcDay, type WorldService } from "./world-service";

/**
 * The runtime-neutral front door: routes, auth, rate limits, and the `/v1/live` message protocol
 * (its sessions are in `live.ts`). The Node server (`app.ts`) and the Cloudflare Durable Object
 * (`cloudflare/worker.ts`) are thin adapters around this, so both speak exactly the same API.
 * Replies become HTTP in `api-response.ts`, and the world and the social layer are wired together
 * in `api-wiring.ts`.
 *
 * REST routes come from the table in `@terrakin/protocol` (routes.ts). For each request the
 * dispatcher matches the table, authenticates, rate limits, and parses params, query, and body
 * with the route's schemas, in that order, before the route's handler runs. Handlers live in
 * `handlers/`, one file per area of the table, and link routes' in `links/`, joined by
 * `routeHandlers()` and keyed by route id. Their types make a missing or unknown route a compile
 * error.
 */

export type { ApiResponse } from "./api-response";
export { MAX_BODY_BYTES };

/** Most `once` answers kept in memory: a short Markdown page each, keyed by a URL up to a few KB. */
const MAX_REPEATS = 2_000;

/** Plot photos being drawn at once. Each waits on the renderer and then holds a PNG in memory. */
const MAX_PHOTOS_IN_FLIGHT = 2;
/**
 * Bytes a plot photo is assumed to take before it's drawn, for the cost guards that run first. A
 * drawn photo is about 100 to 300 KB; the exact size is checked again when it's stored.
 */
const PHOTO_RESERVE_BYTES = 1_000_000;

const TABLE = ROUTES as readonly RouteSpec[];

/**
 * Routes outside `/v1/` that the API answers (aliases like `/skill.md`, Markdown twins like
 * `/r/{id}.md`, the sitemaps). Adapters forward these too, whatever the method.
 */
const matchRoot = compileRoutes(
  TABLE.flatMap((route) =>
    [route.path, ...(route.aliases ?? [])]
      .filter((path) => !path.startsWith("/v1/"))
      .map((path) => ({ ...route, path, aliases: [] })),
  ),
);

/** Whether a request for this path belongs to the API rather than to static files or media. */
export function isApiPath(pathname: string): boolean {
  return (
    pathname.startsWith("/v1/") ||
    (["GET", "POST", "PUT", "DELETE"] as const).some((m) => matchRoot(m, pathname))
  );
}

export interface ApiRequest {
  method: string;
  pathname: string;
  /** The client's IP, already resolved by the adapter (see `clientIp` in app.ts). */
  ip: string;
  authorization: string | undefined;
  /** Query string parameters. */
  query: URLSearchParams;
  /** Parsed JSON body, or undefined if missing, too large, or not JSON. */
  readJson: () => Promise<unknown>;
  /** Raw body, or undefined if it's longer than `maxBytes`. Used for uploads. */
  readBytes: (maxBytes: number) => Promise<Uint8Array | undefined>;
  /** The Content-Length header as a number, if the client sent one. */
  contentLength: number | undefined;
  /**
   * Scheme and host the client used, like `https://terrakin.org`, for absolute links in Markdown
   * answers. Defaults to https://terrakin.org.
   */
  origin?: string;
  /** The Idempotency-Key header, if the client sent one. */
  idempotencyKey?: string | undefined;
  /**
   * The email of a Cloudflare Access sign-in the adapter has already verified (`access.ts`). Only
   * the Worker sets it, after checking the JWT; never copy it from a request header.
   */
  staffEmail?: string | undefined;
  /** The `Origin` header, which browsers send on cross-site and most same-site requests. */
  browserOrigin?: string | undefined;
  /** The `Sec-Fetch-Site` header browsers send: `same-origin`, `same-site`, `cross-site`, or `none`. */
  fetchSite?: string | undefined;
  /** The `Content-Type` header. */
  contentType?: string | undefined;
  /** The `If-None-Match` header, for a route whose answer has an `ETag`. */
  ifNoneMatch?: string | undefined;
}

/** Who may use staff routes, and how they sign in (RFC 0006, decision 0040). */
export interface StaffOptions {
  /**
   * Cloudflare Access is set up (`TERRAKIN_ACCESS_TEAM` and `TERRAKIN_ACCESS_AUD`): staff routes
   * need a verified Access sign-in, and resident tokens don't count. Without it, a maintainer's or
   * moderator's token works.
   */
  access: boolean;
  maintainerEmails?: ReadonlySet<string>;
  moderatorEmails?: ReadonlySet<string>;
  /**
   * Which resident an Access sign-in email also is (`TERRAKIN_STAFF_RESIDENTS`), so the sim can
   * keep a maintainer out of bounties their own household is in on (decision 0062).
   */
  staffResidents?: ReadonlyMap<string, string>;
}

/**
 * Staff routes answer a browser only from the admin site itself: the `Origin` it sent must be
 * exactly the origin the request came in on, and that must be an admin host (admin.terrakin.org,
 * or admin.localhost on any port). A page on admin.anything-else, or on the main site, is refused.
 */
function isAdminOrigin(browserOrigin: string, requestOrigin: string | undefined): boolean {
  try {
    const from = new URL(browserOrigin);
    const to = new URL(requestOrigin ?? "");
    return from.origin === to.origin && to.hostname.toLowerCase().startsWith("admin.");
  } catch {
    return false;
  }
}

export interface ApiOptions {
  service: WorldService;
  /** Served at `GET /v1/skill`. */
  skill: string;
  /** Served at `GET /v1/openapi.json`. */
  openapi: string;
  /** Actions per second allowed per resident (burst = 2x). Default from RATE_LIMITS.actions. */
  actionsPerSecond?: number;
  /** New sessions per minute allowed per IP (burst = that many, at least 5). Default from RATE_LIMITS.sessions. */
  sessionsPerMinute?: number;
  /** The social layer (RFC 0003). Without it, the social routes answer not_found. */
  social?: SocialService;
  /** Upload bytes one IP (or IPv6 /64) may send per day. Kept in memory only. Default 500 MB. */
  ipUploadBytesPerDay?: number;
  /** Sockets that may watch for posts at once. Default MAX_WATCHERS. */
  maxWatchers?: number;
  /** Watching sockets from one network (an IPv4 address or IPv6 /48). Default MAX_WATCHERS_PER_NETWORK. */
  maxWatchersPerNetwork?: number;
  /**
   * Sees every REST response with the route that produced it (undefined when nothing matched).
   * Tests use it to check each response against the route table.
   */
  onResponse?: (route: RouteSpec | undefined, response: ApiResponse) => void;
  /**
   * Clock for the rate limits, the repeat window of `once` links, the life of watch sockets, and
   * the day of the per-IP upload bytes. Default Date.now.
   */
  now?: () => number;
  /** Staff sign-in. Default: no Access, so maintainers' and moderators' tokens work. */
  staff?: StaffOptions;
  /**
   * Draws plot photos (issue #34). Node draws in-process; the World object calls the Worker, so a
   * drawing never runs in the world. Without it, `POST /v1/plots/photo` answers `unavailable`.
   */
  photos?: PlotPhotoRenderer;
  /**
   * Townsfolk chatter (docs/plans/townsfolk-chatter.md), run by `runChatter()` from the Worker's
   * cron or the Node timer. Built on `social`. Without it, chatter is off.
   */
  chatter?: ChatterService;
  /**
   * The townsfolk's daily coin tips, run by `runTips()` from the Worker's daily cron or the Node
   * timer. Without it, tips are off here (the script can still give them).
   */
  tips?: TownsfolkTips;
  /**
   * Welcome visits (decision 0142): queued as a person claims their first plot, carried out by the
   * minute sweep. Built on `service` and `social`. Without it, nobody is visited.
   */
  welcome?: TownsfolkWelcome;
}

/** Seconds until the next UTC day, when per-IP daily upload bytes reset. */
const secondsToTomorrow = (now: number) => Math.ceil((DAY_MS - (now % DAY_MS)) / 1000);

/** A valid Idempotency-Key: 1 to 255 visible ASCII characters (a UUID is typical). */
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;

/** The first value of each query key, as the route's query schema expects. */
function firstValues(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of query) if (!(key in values)) values[key] = value;
  return values;
}

const mb = (bytes: number) => `${bytes / 1_000_000} MB`;

export class Api {
  readonly service: WorldService;
  readonly skill: string;
  readonly openapi: string;
  readonly social: SocialService | undefined;
  readonly owners: OwnerService | undefined;
  readonly limiters: Record<RateLimitName, RateLimiters>;
  private readonly ipUploads = new Map<string, { day: number; bytes: number }>();
  uploadsInFlight = 0;
  private photosInFlight = 0;
  private readonly photos: PlotPhotoRenderer | undefined;
  letterReadsInFlight = 0;
  /** Sockets that hear about new posts. @internal Used by LiveSession and the wiring. */
  readonly postListeners: PostListeners;
  private readonly ipUploadBytesPerDay: number;
  private readonly match: (method: string, pathname: string) => RouteMatch<RouteSpec> | undefined;
  readonly handlers: Handlers;
  private readonly onResponse: ApiOptions["onResponse"];
  readonly now: () => number;
  /** Answers to `once` links, by route, resident, and query, for REPEAT_WINDOW_MS. */
  private readonly repeats = new Map<string, { at: number; response: Promise<ApiResponse> }>();
  private readonly idempotency = new IdempotencyStore();
  readonly staffOptions: StaffOptions;
  private readonly chatter: ChatterService | undefined;
  private readonly tips: TownsfolkTips | undefined;
  /** Welcome visits (decision 0142). The wiring queues them from each committed claim. */
  readonly welcome: TownsfolkWelcome | undefined;
  /** Offline routines' runner (RFC 0009). Needs the social layer, where the away log lives. */
  readonly routines: Routines | undefined;
  /** Each partner's residents (`GET /v1/partners/{id}/residents`), read from both layers. */
  readonly partnerResidents: PartnerResidents | undefined;
  /** The AI spend ledger, read for the staff overview. Triage and chatter write to it. */
  readonly spendLedger: AiSpend | undefined;

  constructor(options: ApiOptions) {
    this.service = options.service;
    this.skill = options.skill;
    this.openapi = options.openapi;
    this.social = options.social;
    this.now = options.now ?? Date.now;
    this.postListeners = new PostListeners({
      social: options.social,
      maxWatchers: options.maxWatchers ?? MAX_WATCHERS,
      maxWatchersPerNetwork: options.maxWatchersPerNetwork ?? MAX_WATCHERS_PER_NETWORK,
      now: this.now,
    });
    this.owners = options.social
      ? new OwnerService({ social: options.social, credentials: options.service })
      : undefined;
    this.welcome = options.welcome;
    // The world and the social layer hear each other through hooks (api-wiring.ts).
    const layer = options.social;
    if (layer) {
      const wired = wireSocial(this, layer);
      this.routines = wired.routines;
      this.partnerResidents = wired.partnerResidents;
    }
    this.ipUploadBytesPerDay = options.ipUploadBytesPerDay ?? 500_000_000;
    this.photos = options.photos;
    this.chatter = options.chatter;
    this.tips = options.tips;
    this.spendLedger = options.social
      ? new AiSpend(options.social.sql, options.social.now)
      : undefined;
    this.onResponse = options.onResponse;
    const bucket = (name: RateLimitName) =>
      new RateLimiters(RATE_LIMITS[name].burst, RATE_LIMITS[name].perSecond, this.now);
    const actions = options.actionsPerSecond;
    this.limiters = {
      actions:
        actions === undefined
          ? bucket("actions")
          : new RateLimiters(actions * 2, actions, this.now),
      sessions:
        options.sessionsPerMinute === undefined
          ? bucket("sessions")
          : new RateLimiters(
              Math.max(RATE_LIMITS.sessions.burst, Math.floor(options.sessionsPerMinute)),
              options.sessionsPerMinute / 60,
              this.now,
            ),
      posts: bucket("posts"),
      reactions: bucket("reactions"),
      uploads: bucket("uploads"),
      xVerify: bucket("xVerify"),
      xVerifyIp: bucket("xVerifyIp"),
      letters: bucket("letters"),
      letterMedia: bucket("letterMedia"),
      owner: bucket("owner"),
      ownerCodes: bucket("ownerCodes"),
      reports: bucket("reports"),
      photos: bucket("photos"),
      photosIp: bucket("photosIp"),
      agentLink: bucket("agentLink"),
      agentLinkIp: bucket("agentLinkIp"),
    };
    // Without a social service its routes don't exist, so they answer not_found like any unknown
    // path. The Town Hall needs it too: its notice board and author faces live there.
    this.match = compileRoutes(
      options.social
        ? TABLE
        : TABLE.filter(
            (r) =>
              !r.tags.some(
                (tag) =>
                  tag === "Social" ||
                  tag === "Site" ||
                  tag === "Together" ||
                  tag === "Town" ||
                  tag === "Owners" ||
                  tag === "Partners" ||
                  tag === "Moderation",
              ),
          ),
    );
    this.handlers = this.routeHandlers();
    this.staffOptions = options.staff ?? { access: false };
    // A quarantined resident's note stays out of the world snapshot too (RFC 0006).
    const safety = options.social?.safety;
    if (safety) this.service.noteHidden = (id) => safety.isQuarantined(id);
    // Look media (RFC 0005) are the resident's own uploads, checked and kept by the social layer.
    const social = options.social;
    if (social) {
      this.service.useMedia(
        (owner, id) => social.mediaType(owner, id),
        (resident, ids) => social.pinLookMedia(resident, ids),
        (item, id) => social.pinPieceMedia(item, id),
      );
      // The world log is the truth: after a restart, pin whatever the replayed looks and pieces name.
      for (const [resident, ids] of this.service.allLookMedia()) social.pinLookMedia(resident, ids);
      for (const [item, id] of this.service.allPieceMedia()) social.pinPieceMedia(item, id);
    }
  }

  /** Handle a REST request. Returns undefined for paths outside the API so the adapter can serve files. */
  async handle(req: ApiRequest): Promise<ApiResponse | undefined> {
    const match = this.match(req.method, req.pathname);
    if (!match && req.method === "GET" && !isApiPath(req.pathname)) return undefined;
    if (match) nameRequest(match.route);
    // A Durable Object can sleep through midnight. Catch the day up before answering anything.
    this.service.tick();
    const answer = match
      ? await this.dispatch(match, req)
      : // Never echo a link key back, even to its holder.
        error(
          "not_found",
          `No route for ${req.method} ${req.pathname.replace(/^\/v1\/act\/[^/]+/, "/v1/act/<key>")}.`,
        );
    const response = { ...answer, headers: { ...API_HEADERS, ...answer.headers } };
    const route = match ? match.route.id : "unmatched";
    const code = errorCode(response);
    crumb("api", match ? `${match.route.method} ${match.route.path}` : req.method, {
      status: response.status,
      ...(code ? { code } : {}),
    });
    count("api.response", { route, status: response.status, ...(code ? { code } : {}) });
    this.onResponse?.(match?.route, response);
    return response;
  }

  /**
   * Authenticate, then refuse writes from suspended or paused residents, rate limit, and parse, in
   * that order, and run the route's handler. A `once` link opened again within the repeat window
   * gets its first answer back right after authentication.
   */
  private async dispatch(match: RouteMatch<RouteSpec>, req: ApiRequest): Promise<ApiResponse> {
    const { route, params: rawParams } = match;
    const origin = req.origin ?? DEFAULT_ORIGIN;
    const viewer =
      route.auth === "none"
        ? undefined
        : route.auth === "linkKey"
          ? this.service.authenticateLinkKey(rawParams.key ?? "")
          : this.authenticate(req.authorization);
    if (route.auth === "linkKey" && !viewer) {
      return render(route, fail("unauthorized", BAD_LINK_KEY), linkHelp(origin, undefined));
    }
    if (route.auth === "bearer" && !viewer) return render(route, unauthorized());
    if (route.auth === "staff") {
      const staff = this.staffFor(req);
      if ("error" in staff) return render(route, staff);
      return this.run(match, req, staff.actor, origin);
    }
    // A join link has no resident yet: the code in its `confirm`, which only the reader who
    // opened the page before it saw, stands in for one (decision 0148).
    const confirm = req.query.get("confirm") ?? "";
    const opener =
      viewer ?? (route.auth === "none" && JOIN_CONFIRM_CODE.test(confirm) ? confirm : "");
    if (route.once && opener) {
      const query = new URLSearchParams(req.query);
      query.sort();
      return this.once(`${route.id} ${opener} ${query}`, () =>
        this.run(match, req, viewer, origin),
      );
    }
    return this.run(match, req, viewer, origin);
  }

  private async run(
    { route, params: rawParams }: RouteMatch<RouteSpec>,
    req: ApiRequest,
    viewer: string | undefined,
    origin: string,
  ): Promise<ApiResponse> {
    const help =
      route.format === "markdown"
        ? linkHelp(origin, route.auth === "linkKey" ? rawParams.key : undefined)
        : undefined;
    const reject = (code: ErrorCode, message: string, retryAfter?: number) =>
      render(route, fail(code, message, retryAfter), help);
    // What failed to parse, in plain words with the choices a field takes and the one a near miss
    // meant: a sentence each, on its own line for Markdown readers.
    const unparsed = (schema: Schema, input: unknown, issues: readonly Issue[]) => {
      const plain = plainProblem(schema, input, issues);
      if (route.format === "markdown") return reject("bad_request", plain.lines.join("\n"));
      return error("bad_request", plain.lines.join(" "), undefined, plain.didYouMean);
    };

    // Suspended residents can read but not write; a resident whose writes the filters paused waits.
    if (viewer && isWriteRoute(route)) {
      const blocked = this.writeBlock(viewer);
      if (blocked) return reject(blocked.error, blocked.message, blocked.retryAfter);
    }

    let limitHeaders: Record<string, string> = {};
    if (route.rateLimit) {
      const key =
        RATE_LIMITS[route.rateLimit].scope === "resident" && viewer ? viewer : ipKey(req.ip);
      const limiter = this.limiters[route.rateLimit];
      const take = limiter.takeInfo(key);
      limitHeaders = rateLimitHeaders(route.rateLimit, limiter, take);
      if (!take.allowed) {
        return withHeaders(
          reject("rate_limited", RATE_LIMITED[route.rateLimit], take.retryAfter),
          limitHeaders,
        );
      }
    }

    let params: unknown;
    if (route.params) {
      const parsed = route.params.safeParse(rawParams);
      if (!parsed.success) return unparsed(route.params, rawParams, parsed.error.issues);
      params = parsed.data;
    }
    let query: unknown;
    if (route.query) {
      const rawQuery = firstValues(req.query);
      const parsed = route.query.safeParse(rawQuery);
      if (!parsed.success) return unparsed(route.query, rawQuery, parsed.error.issues);
      query = parsed.data;
    }

    let body: unknown;
    if (isBinaryBody(route.body)) {
      const size = req.contentLength;
      if (size === undefined || !Number.isInteger(size) || size < 0) {
        return reject("bad_request", "Send the file with a Content-Length header.");
      }
      if (size > route.body.maxBytes) {
        return reject(
          "bad_request",
          `That file is too big. The largest allowed is ${mb(route.body.maxBytes)}.`,
        );
      }
      body = { length: size, read: () => req.readBytes(size) } satisfies Upload;
    } else if (route.body) {
      const raw = await req.readJson();
      const parsed = route.body.safeParse(raw);
      // A typo in an action type or field name gets the real name back (`did_you_mean`). Actions
      // refuse a near-miss field even when the rest parses: a dropped `dyr` would act for real.
      if (!parsed.success || route.body === Action) {
        const hint = suggestFor(route.body, raw);
        if (hint) return error("bad_request", hint.message, undefined, hint.didYouMean);
      }
      const missed = !parsed.success && route.body === Action ? familyMiss(raw) : undefined;
      if (missed) return render(route, { status: 200, body: missed }, help);
      if (!parsed.success) return unparsed(route.body, raw, parsed.error.issues);
      body = parsed.data;
    }

    const handler = this.handlers[route.id as RouteId] as unknown as AnyHandler;
    const run = () =>
      span(route.id, "api.handler", async () =>
        render(
          route,
          await handler({ params, query, body, viewer, ip: req.ip, origin }),
          help,
          req.ifNoneMatch,
        ),
      );
    return withHeaders(
      await this.idempotent(route, req.idempotencyKey, viewer, [params, query, body], run),
      limitHeaders,
    );
  }

  /**
   * Run a write once per `Idempotency-Key` (writes that need a token): the same resident, key, and
   * request within 24 hours gets the first response back with `Idempotency-Replayed: true`. A
   * different request with the same key gets `idempotency_conflict`.
   */
  private async idempotent(
    route: RouteSpec,
    key: string | undefined,
    viewer: string | undefined,
    [params, query, body]: unknown[],
    run: () => Promise<ApiResponse>,
  ): Promise<ApiResponse> {
    if (key === undefined || !viewer || !acceptsIdempotencyKey(route)) return run();
    if (!IDEMPOTENCY_KEY.test(key)) {
      return error("bad_request", "Idempotency-Key must be 1 to 255 visible ASCII characters.");
    }
    // A raw upload is matched on its size: its bytes aren't read until the handler runs.
    const shape = isBinaryBody(route.body) ? { length: (body as Upload).length } : body;
    const fingerprint = await sha256Hex(JSON.stringify([route.id, params, query, shape]));
    const lookup = this.idempotency.begin(viewer, key, fingerprint);
    if (lookup.kind === "conflict") {
      return error(
        "idempotency_conflict",
        "That Idempotency-Key was already used for a different request. Use a new key for a new request.",
      );
    }
    if (lookup.kind === "replay") {
      const first = await lookup.response;
      // The first try wasn't kept (it failed in a way worth retrying), so this one runs for real.
      if (!first) return run();
      return {
        status: first.status,
        headers: {
          ...(first.contentType ? { "content-type": first.contentType } : {}),
          "cache-control": "no-store",
          "idempotency-replayed": "true",
        },
        body: first.body,
      };
    }
    let response: ApiResponse | undefined;
    try {
      response = await run();
      return response;
    } finally {
      lookup.finish(response && keepable(response) ? stored(response) : undefined);
    }
  }

  /**
   * Run `act` once per `key` per REPEAT_WINDOW_MS. The pending answer is remembered before it
   * settles, so a prefetch and a real open arriving together still act once. Only successes are
   * kept: a refusal (rate limited, bad input, or a world rule's 200 page with an `Error code:` line)
   * can be retried right away.
   */
  private async once(key: string, act: () => Promise<ApiResponse>): Promise<ApiResponse> {
    const kept = (r: ApiResponse) =>
      r.status < 300 && !(typeof r.body === "string" && markdownErrorCode(r.body));
    const now = this.now();
    const earlier = this.repeats.get(key);
    if (earlier && now - earlier.at < REPEAT_WINDOW_MS) {
      const first = await earlier.response;
      return kept(first) ? { ...first, body: REPEAT_NOTE + first.body } : first;
    }
    const entry = { at: now, response: act() };
    this.repeats.delete(key);
    this.repeats.set(key, entry);
    // Bounded: the oldest answers go first. Losing one only means a repeat acts again.
    while (this.repeats.size > MAX_REPEATS) {
      const oldest = this.repeats.keys().next().value;
      if (oldest === undefined) break;
      this.repeats.delete(oldest);
    }
    const forget = () => {
      if (this.repeats.get(key) === entry) this.repeats.delete(key);
    };
    try {
      const response = await entry.response;
      if (!kept(response)) forget();
      return response;
    } catch (err) {
      forget();
      throw err;
    }
  }

  requireSocial(): SocialService {
    // Unreachable: social routes aren't matched without a social service.
    if (!this.social) throw new Error("Social routes need a SocialService.");
    return this.social;
  }

  /**
   * Count a read of a start file that came with `?from=`, when `from` is an active partner's id
   * (the discovery log). Anything else, and a server without the social layer, counts nothing.
   * A failed write is reported and never turns the read away.
   */
  noteArrival(file: StartFile, from: string | undefined): void {
    const social = this.social;
    const id = fromParam(from);
    if (!social || id === undefined) return;
    const partner = findPartner(id, social.agentLinks.partnerList);
    if (partner?.status !== "active") return;
    try {
      social.discovery.note(file, partner.id);
    } catch (err) {
      report(err, "discovery.note");
    }
  }

  requireOwners(): OwnerService {
    // Unreachable: owner routes aren't matched without a social service.
    if (!this.owners) throw new Error("Owner routes need a SocialService.");
    return this.owners;
  }

  /** The per-IP daily upload bytes, refused when `bytes` more would go over. */
  ipUploadRefusal(key: string, bytes: number): Failure | undefined {
    const now = this.now();
    const day = utcDay(now);
    const used = this.ipUploads.get(key);
    const spent = used?.day === day ? used.bytes : 0;
    if (spent + bytes <= this.ipUploadBytesPerDay) return undefined;
    return fail(
      "rate_limited",
      "That's all the uploads from here for today. Try again tomorrow.",
      secondsToTomorrow(now),
    );
  }

  /** Count a stored upload against its IP's day. Read again: another may have finished meanwhile. */
  countIpUpload(key: string, day: number, bytes: number) {
    const latest = this.ipUploads.get(key);
    const before = latest?.day === day ? latest.bytes : 0;
    this.ipUploads.set(key, { day, bytes: before + bytes });
  }

  /**
   * `POST /v1/plots/photo` (issue #34). Every cost guard runs before the drawing: the route's own
   * limit (in the dispatcher), the per-IP limit, the upload caps with room for a photo, and the
   * photos in flight. The drawn PNG then goes through `upload()`, which checks the caps again
   * against its real size, so a photo is a normal upload owned by the resident.
   */
  async takePlotPhoto(viewer: string, ip: string): Promise<Reply<"takePlotPhoto">> {
    const social = this.requireSocial();
    if (!this.photos) return fail("unavailable", "Photos aren't available on this server.");
    const key = ipKey(ip);
    if (!this.limiters.photosIp.take(key)) return fail("rate_limited", RATE_LIMITED.photosIp);
    const spec = plotPhotoSpec(this.service.state, viewer, this.service.noteHidden);
    if (!spec) {
      return fail(
        "bad_request",
        'You have no plot to photograph yet. Settle one first: {"type": "settle", "px": ..., "py": ...} with POST /v1/actions.',
      );
    }
    const overIp = this.ipUploadRefusal(key, PHOTO_RESERVE_BYTES);
    if (overIp) return overIp;
    const room = social.uploadRoom(viewer, PHOTO_RESERVE_BYTES);
    if (!room.ok) {
      return fail(
        room.code,
        room.message,
        room.code === "rate_limited" ? (room.retryAfter ?? DAILY_CAP_RETRY_SECONDS) : undefined,
      );
    }
    if (this.photosInFlight >= MAX_PHOTOS_IN_FLIGHT) {
      return fail(
        "rate_limited",
        "Lots of photos being taken right now. Try again in a moment.",
        5,
      );
    }
    this.photosInFlight++;
    try {
      let png: Uint8Array;
      try {
        png = await span("photo", "photo.render", () => (this.photos as PlotPhotoRenderer)(spec));
      } catch (err) {
        report(err, "photo.render");
        return fail("unavailable", "Couldn't take the photo right now. Try again in a minute.");
      }
      const day = utcDay(this.now());
      const overIpNow = this.ipUploadRefusal(key, png.length);
      if (overIpNow) return overIpNow;
      const outcome = await social.upload(viewer, png);
      if (outcome.ok) this.countIpUpload(key, day, png.length);
      return fromResult(outcome, (media) => ({ status: 201 as const, body: { media } }));
    } finally {
      this.photosInFlight--;
    }
  }

  /**
   * Every REST route's behavior, keyed by the route id from the table. Each area's handlers are in
   * the file of the same name in `handlers/`, except the links area's Markdown twins and sitemaps,
   * which are in `handlers/site.ts`. Link routes, every id in `LinkRouteId`, are in `links/`.
   */
  private routeHandlers(): Handlers {
    return {
      ...worldHandlers(this),
      ...socialHandlers(this),
      ...siteHandlers(this),
      ...togetherHandlers(this),
      ...townHallHandlers(this),
      ...eventHandlers(this),
      ...ownerHandlers(this),
      ...safetyHandlers(this),
      ...docsHandlers(this),
      ...linkHandlers(this),
    };
  }

  /**
   * Join through an invite (decision 0024): a new resident like `POST /v1/session`, then settle
   * next to the inviter (or share their plot, when they offered it), build the starter home, and
   * follow each other. Every world change still goes through `service.act`. No awaits between
   * reading the invite and using it up, so two people can't both accept one code.
   */
  acceptInvite(code: string, body: AcceptInviteRequest): Reply<"acceptInvite"> {
    const { service } = this;
    const social = this.requireSocial();
    const invite = social.together.openInvite(code);
    if (!invite) return fail("not_found", INVITE_GONE);
    const { plot: chosen, build, share, ...profile } = body;
    const created = service.createSession(profile);
    if (!created.ok) return fail(created.error.code, created.error.message);
    if (!created.residentId || !created.token) return fail("internal", "No session.");
    const me = created.residentId;
    const inviter = invite.inviter;
    social.together.consumeInvite(code, me);

    const anchor = anchorPlot(service.state, inviter);
    const wantsBuild = build !== false;
    let plot: { px: number; py: number } | null = null;
    let shared = false;
    let built = false;
    if (invite.share && share !== false && anchor?.owned) {
      // The inviter asked for this when they made the invite. Sharing is their action, so they
      // come online for it and go back to how they were.
      const wasOnline = service.state.residents[inviter]?.online === true;
      service.arrive(inviter, "share_plot");
      const result = service.act(inviter, { type: "share_plot", with: me });
      if (!wasOnline) service.leave(inviter);
      // The plot the sim actually shared, from its event.
      const event = result.ok ? result.events.find((e) => e.type === "plot_shared") : undefined;
      shared = event?.type === "plot_shared";
      if (event?.type === "plot_shared") {
        plot = { px: event.px, py: event.py };
        if (wantsBuild) {
          const home = service.act(me, { type: "build_starter_home" });
          built = home.ok || home.error.code === "already_home";
          service.act(me, { type: "home" });
        }
      }
    }
    if (!shared) {
      const candidates = [
        ...(chosen ? [chosen] : []),
        ...(anchor ? suggestPlots(service.state, anchor, INVITE_PLOT_SUGGESTIONS) : []),
      ];
      for (const c of candidates) {
        if (service.act(me, { type: "settle", px: c.px, py: c.py }).ok) {
          plot = { px: c.px, py: c.py };
          break;
        }
      }
      if (plot && wantsBuild) built = service.act(me, { type: "build_starter_home" }).ok;
    }
    social.setFollow(me, inviter, true);
    social.setFollow(inviter, me, true);
    return {
      status: 201,
      body: {
        residentId: me,
        token: created.token,
        world: service.snapshot(),
        inviterId: inviter,
        plot,
        shared,
        built,
      },
    };
  }

  /** Start the `/v1/live` protocol for one socket. The adapter feeds it text and tells it when the socket closes. */
  live(ip: string, socket: LiveSocket): LiveSession {
    return new LiveSession(this, ip, socket);
  }

  /** A bounty as staff see it after acting on it. */
  staffBounty(id: string): Reply<"confirmTownBounty"> {
    const b = findBounty(this.service.state, id);
    if (!b) return fail("internal", "Bounty vanished.");
    return {
      status: 200,
      body: { bounty: bountyView(this.service.state, b, (r) => this.social?.authorView(r)) },
    };
  }

  /**
   * Who reads the plots to visit (RFC 0020): plots whose owner is suspended are left out (like
   * their gallery and stall), and plots of anyone the viewer blocked. Only the viewer's own
   * blocks: anyone can read the list without a token, so leaving out the plots of residents who
   * blocked the viewer would tell them who did. A visit or an admire there is still refused.
   */
  plotViewer(viewer: string | undefined): PlotViewer {
    const layer = this.requireSocial();
    const blocked = viewer === undefined ? new Set<string>() : layer.blockedBy(viewer);
    return {
      viewer,
      hidden: (plot) =>
        layer.safety.suspendedUntil(plot.owner.id) !== undefined ||
        [plot.owner, ...plot.coOwners].some((a) => blocked.has(a.id)),
    };
  }

  /**
   * The plot a resident calls home, as their profile shows it, with its name unless staff hold
   * back the words of whoever named it (decision 0121). Nothing when they live on no plot.
   */
  homeField(id: string): Pick<ProfileView, "home"> {
    const plot = homePlotOf(this.service.state, id);
    if (!plot) return {};
    const name = shownPlotName(plot, this.service.noteHidden);
    return {
      home: {
        px: plot.px,
        py: plot.py,
        ...(name === undefined ? {} : { name }),
        ...(plot.ownerId === id ? {} : { shared: true as const }),
      },
    };
  }

  /** Plot (px, py) as `viewer` sees it, read fresh, or undefined when it isn't theirs to see. */
  plotFor(viewer: string | undefined, at: { px: number; py: number }) {
    const layer = this.requireSocial();
    const author = (id: string) => layer.authorView(id);
    return layer.plots.one(this.service.state, author, at.px, at.py, this.plotViewer(viewer));
  }

  /** What the market's gate on listing reads from outside the sim: time in Terrakin and karma. */
  listerFacts(id: string): ListerFacts {
    return {
      ageDays: this.service.residentAgeDays(id),
      tier: this.social?.karma.of(id).tier ?? "newcomer",
    };
  }

  /** @internal Used by LiveSession. */
  clock(): number {
    return this.now();
  }

  /** Housekeeping: mark idle residents offline and forget full rate-limit buckets. Call about once a minute. */
  sweep() {
    task("world.sweep", () => this.sweepNow());
  }

  /**
   * The game tables' clock (RFC 0011): closes rounds whose window has ended, so a live table's
   * 45 seconds hold with nobody making a request. The adapters call it every second; it does
   * nothing while no table is open or playing.
   */
  gameClock() {
    if (!this.service.state.games) return;
    try {
      this.service.runGames();
    } catch (err) {
      console.error("Game clock failed", err);
      report(err, "world.games");
    }
  }

  /**
   * Recheck agent links that are due (RFC 0007), then try kept link asks again (decision 0128):
   * bounded per run and by the day's read cap. The Worker's alarm and the Node server's timer call
   * this every few minutes.
   */
  async recheckAgentLinks(): Promise<number> {
    if (!this.social) return 0;
    const links = this.social.agentLinks;
    return task("agent_link.recheck", () => links.recheckDue());
  }

  /**
   * One round of townsfolk chatter (docs/plans/townsfolk-chatter.md). The Worker's cron and the
   * Node timer call this; it checks its own gate and spend guard, so an early call does nothing.
   */
  async runChatter(): Promise<ChatterRun> {
    const chatter = this.chatter;
    if (!chatter) return { skipped: "off", outcomes: [] };
    return task("chatter.run", () => chatter.run());
  }

  /**
   * The townsfolk's daily coin tips. The Worker's cron calls this just after midnight UTC and the
   * Node timer every hour; it catches the world's day up first, so the day's budgets are paid, and
   * runs at most once a day.
   */
  runTips(): TipsResult | { skipped: "off" } {
    const tips = this.tips;
    if (!tips) return { skipped: "off" };
    return task("tips.run", () => {
      this.service.tick();
      return tips.run();
    });
  }

  /**
   * Welcome visits that are due (decision 0142). The minute sweep runs them after routines; this
   * runs them alone, for tests.
   */
  runWelcomes(): WelcomeRun | { skipped: "off" } {
    const welcome = this.welcome;
    if (!welcome) return { skipped: "off" };
    return task("welcome.run", () => welcome.run());
  }

  /** When the next welcome visit is due (ms), or undefined, so the Worker's alarm wakes for it. */
  nextWelcomeAt(): number | undefined {
    return this.welcome?.nextAt();
  }

  /** The staff overview's tips line: the mode and the last run's counts. */
  tipsStatus() {
    return tipsStatus(this.tips);
  }

  /** One event as `GET /v1/events/{id}` answers it. */
  eventResponse(e: HostedEvent, viewer: string | undefined): EventResponse {
    const ctx = this.requireSocial().eventContext(viewer);
    return {
      now: new Date(ctx.now).toISOString(),
      event: eventView(this.service.state, e, ctx, viewer),
    };
  }

  /**
   * Say you're going to an event, or take it back. A social row, public as a count: it never
   * changes attendance. Not for an event whose host you've blocked or who blocked you.
   */
  setGoing(viewer: string, id: string, going: boolean) {
    const social = this.requireSocial();
    const e = findEvent(this.service.state, id);
    const ctx = social.eventContext(viewer);
    if (!e || (!isTownEvent(e) && ctx.hidden(e.host))) return fail("not_found", "No such event.");
    if (going) {
      if (!eventOpen(e)) return fail("event_closed", `${e.id} has ${e.status}.`);
      if (!isTownEvent(e) && social.blockedEither(viewer, e.host)) {
        return fail("forbidden", "You can't go to this resident's events.");
      }
    }
    social.events.setGoing(e.id, viewer, going);
    return { status: 200 as const, body: this.eventResponse(e, viewer) };
  }

  /** The staff overview's chatter line: settings, today's use, the last run, and dry-run drafts. */
  chatterStatus() {
    return chatterStatus(this.chatter);
  }

  /**
   * What the townsfolk are doing, for `GET /v1/admin/townsfolk`: chatter's settings and today's use,
   * each townsfolk resident's day, the latest things they did with the posts and residents they
   * touched, and the last coin tips.
   */
  townsfolkActivity(): TownsfolkActivityResponse {
    return townsfolkActivity(this.requireSocial(), this.chatter, this.tips);
  }

  /**
   * When the next agent link recheck, or retry of a kept ask, is due (ms), or undefined when there
   * are neither, so the Worker keeps its alarm only while they exist.
   */
  nextAgentRecheckAt(): number | undefined {
    return this.social?.agentLinks.nextDueAt();
  }

  /**
   * Take the routine steps that are due (RFC 0009), after catching the world's day up. The minute
   * sweep runs routines right after its idle sweep; this runs them alone, for tests. On Node with
   * the test clock, `POST /v1/test/sweep` runs the whole sweep now.
   */
  runRoutines(): RoutinesRun | undefined {
    return task("routines.run", () => {
      this.service.tick();
      return runRoutines(this.routines);
    });
  }

  /**
   * When the world should next be awake for its events (RFC 0010), or undefined: a minute from now
   * while one is live, else when the next one starts. The Worker's alarm wakes it then and sweeps.
   */
  nextEventWakeAt(): number | undefined {
    return this.service.nextEventWake();
  }

  private sweepNow() {
    this.service.tick();
    // Before the idle sweep, so a guest whose last call was ten minutes ago is counted once more.
    this.service.sweepEvents();
    this.service.sweepIdle();
    // After the idle sweep, so whoever just went idle is away for their routines.
    runRoutines(this.routines);
    // Welcome visits (decision 0142): a failure is reported and the rest of the sweep goes on.
    try {
      this.welcome?.run();
    } catch (err) {
      report(err, "welcome.run");
    }
    this.service.keepSnapshots();
    this.postListeners.sweep();
    this.social?.sweep().catch((err: unknown) => {
      console.error("Social sweep failed", err);
      report(err, "social.sweep");
    });
    this.owners?.sweep();
    this.service.moderation.sweep();
    this.social?.moderation.sweep();
    const today = utcDay(this.now());
    for (const [ip, used] of this.ipUploads) if (used.day !== today) this.ipUploads.delete(ip);
    for (const limits of Object.values(this.limiters)) limits.prune();
    const cutoff = this.now() - REPEAT_WINDOW_MS;
    for (const [key, { at }] of this.repeats) if (at < cutoff) this.repeats.delete(key);
    this.idempotency.sweep();
  }

  /**
   * Why a resident can't write right now, or undefined: a maintainer's suspension, or the filters'
   * cool-down after repeated refusals (RFC 0006). Maintainers are never paused. `countPause` false
   * asks without counting a pause on the transparency page, for checks that aren't a request.
   */
  writeBlock(residentId: string, countPause = true): Failure | undefined {
    const until = this.social?.safety.suspendedUntil(residentId);
    if (until !== undefined) {
      return fail(
        "suspended",
        `A maintainer suspended this account until ${new Date(until).toUTCString()}. You can still read, and delete your own things.`,
      );
    }
    if (this.social?.isMaintainer(residentId)) return undefined;
    const filters = new Set([
      this.service.moderation,
      ...(this.social ? [this.social.moderation] : []),
    ]);
    let wait = 0;
    let paused: Moderation | undefined;
    for (const m of filters) {
      const left = m.coolDown(residentId);
      if (left > wait) [wait, paused] = [left, m];
    }
    if (paused) {
      if (countPause) paused.pause(residentId, wait);
      return fail("rate_limited", COOL_DOWN_MESSAGE, wait);
    }
    return undefined;
  }

  /** The key a client's address is counted under (see `ipKey`). */
  networkOf(ip: string): string {
    return ipKey(ip);
  }

  /** @internal The key watch sockets are counted under: an IPv4 address or an IPv6 /48. */
  watchNetworkOf(ip: string): string {
    return ipKey(ip, 3);
  }

  /**
   * Who is calling a staff route, or why not. Browsers must come from the admin site. With
   * Cloudflare Access set up, only a verified Access sign-in counts; without it, a maintainer's or
   * moderator's token.
   */
  private staffFor(req: ApiRequest): { actor: string } | Failure {
    // Cross-site request forgery: Access signs staff in with a cookie, which a browser would send
    // along from any page. Refuse anything a browser marks cross-site, any Origin but the admin
    // site's own, and writes that aren't JSON (a form can't send JSON without a preflight).
    if (req.fetchSite === "cross-site") {
      return fail("forbidden", "Staff tools only answer the admin site.");
    }
    if (req.browserOrigin && !isAdminOrigin(req.browserOrigin, req.origin)) {
      return fail("forbidden", "Staff tools only answer the admin site.");
    }
    const writing = req.method !== "GET" && req.method !== "HEAD";
    if (writing && !/^application\/json\b/i.test(req.contentType ?? "")) {
      return fail(
        "bad_request",
        "Send staff actions as JSON, with Content-Type: application/json.",
      );
    }
    const actor = this.staffOptions.access
      ? req.staffEmail
        ? `access:${req.staffEmail.toLowerCase()}`
        : undefined
      : this.authenticate(req.authorization);
    if (!actor) {
      return fail(
        "unauthorized",
        this.staffOptions.access
          ? "Sign in to admin.terrakin.org through Cloudflare Access."
          : "Missing or unknown bearer token.",
      );
    }
    if (!this.staffRole(actor)) return fail("forbidden", STAFF_ONLY);
    return { actor };
  }

  /** Whether only a maintainer may change this resident's suspension: one set it, or it's long. */
  suspensionLocked(residentId: string): boolean {
    const current = this.social?.safety.currentSuspension(residentId);
    if (!current) return false;
    const long = current.remainingMs > MODERATOR_SUSPEND_MAX_DAYS * DAY_MS;
    return long || this.staffRole(current.by) === "maintainer";
  }

  /** Whether only a maintainer may release this resident's held-back bio and note. */
  holdBackLocked(residentId: string): boolean {
    const by = this.social?.safety.quarantinedBy(residentId);
    return by !== undefined && this.staffRole(by) === "maintainer";
  }

  maintainersSuspension(viewer: string, residentId: string): Failure | undefined {
    if (this.staffRole(viewer) === "maintainer") return undefined;
    if (!this.suspensionLocked(residentId)) return undefined;
    return fail(
      "forbidden",
      "A maintainer set this suspension, or it has more than a week to run. Ask a maintainer to change it.",
    );
  }

  /** A staff member's role: by Access email, or by resident id from the server's grants. */
  staffRole(actor: string): StaffRole | undefined {
    if (actor.startsWith("access:")) {
      const email = actor.slice("access:".length);
      if (this.staffOptions.maintainerEmails?.has(email)) return "maintainer";
      if (this.staffOptions.moderatorEmails?.has(email)) return "moderator";
      return undefined;
    }
    if (this.social?.isMaintainer(actor)) return "maintainer";
    if (this.social?.isModerator(actor)) return "moderator";
    return undefined;
  }

  /**
   * The resident a staff member also is, for the sim's household checks (decision 0062): their own
   * id when they signed in with a resident token, else the one `TERRAKIN_STAFF_RESIDENTS` maps
   * their Access email to, else none.
   */
  staffResident(actor: string): string | undefined {
    if (!actor.startsWith("access:")) return actor;
    return this.staffOptions.staffResidents?.get(actor.slice("access:".length));
  }

  authenticate(authorization: string | undefined): string | undefined {
    const match = /^Bearer (.+)$/.exec(authorization ?? "");
    return match?.[1] ? this.service.authenticate(match[1]) : undefined;
  }

  /** @internal Used by LiveSession. */
  takeSession(ip: string) {
    return this.limiters.sessions.take(ipKey(ip));
  }

  /** @internal Used by LiveSession. */
  takeAction(residentId: string) {
    return this.limiters.actions.take(residentId);
  }
}

/** A schema the dispatcher parses with. */
type Schema = Parameters<typeof plainProblem>[0];
