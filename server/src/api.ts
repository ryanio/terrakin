import {
  type AcceptInviteRequest,
  Action,
  absolute,
  acceptsIdempotencyKey,
  type BinaryBody,
  CHANGELOG_ENTRIES,
  ClientMessage,
  changelogResponse,
  compileRoutes,
  type ErrorCode,
  errorStatus,
  INVITE_PLOT_SUGGESTIONS,
  isBinaryBody,
  isWriteRoute,
  LINKS,
  linkHeader,
  MAX_BODY_BYTES,
  MODERATOR_SUSPEND_MAX_DAYS,
  type ModerationLogEntry,
  markdownError,
  type PostView,
  PROTOCOL_VERSION,
  type ProfileView,
  RATE_LIMITS,
  type RateLimitName,
  REPEAT_WINDOW_MS,
  ROUTES,
  type RouteBody,
  type RouteId,
  type RouteMatch,
  type RouteParams,
  type RouteQuery,
  type RouteSpec,
  type RouteSuccess,
  type RouteViewer,
  type ServerMessage,
  SITEMAP_MAX_URLS,
  type StaffRole,
  sitemapIndexXml,
  suggestFor,
  urlsetXml,
  w3cDatetime,
} from "@terrakin/protocol";
import { findProposal } from "@terrakin/sim";
import { checkinView } from "./checkin";
import { purseView } from "./coins";
import { IdempotencyStore, type StoredResponse, sha256Hex } from "./idempotency";
import { BAD_LINK_KEY, DEFAULT_ORIGIN, linkHandlers, linkHelp, REPEAT_NOTE } from "./links";
import { postMarkdown, profileMarkdown } from "./markdown";
import { COOL_DOWN_MESSAGE, type Moderation } from "./moderation";
import { OwnerService } from "./owner-service";
import { RateLimiters, type Take } from "./rate-limit";
import type { SocialResult, SocialService } from "./social-service";
import { count, crumb, nameRequest, report, span, task } from "./telemetry";
import { anchorPlot, suggestPlots } from "./together";
import { archiveView, proposalDetail, townView } from "./town";
import type { WorldService } from "./world-service";

/**
 * The runtime-neutral front door: routes, auth, rate limits, and the `/v1/live` message protocol.
 * The Node server (`app.ts`) and the Cloudflare Durable Object (`cloudflare/worker.ts`) are thin adapters
 * around this, so both speak exactly the same API.
 *
 * REST routes come from the table in `@terrakin/protocol` (routes.ts). For each request the
 * dispatcher matches the table, authenticates, rate limits, and parses params, query, and body
 * with the route's schemas, in that order, before the route's handler runs. Handlers live in
 * `handlers()`, keyed by route id; its type makes a missing or unknown route a compile error.
 */

export { MAX_BODY_BYTES };

const HELLO_TIMEOUT_MS = 5_000;

/**
 * The key for per-IP limits. IPv6 clients usually control a whole /64, so they share one key;
 * otherwise one person could rotate addresses forever.
 */
export function ipKey(ip: string): string {
  if (!ip.includes(":") || ip.startsWith("::ffff:")) return ip.replace(/^::ffff:/, "");
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/** Most `once` answers kept in memory: a short Markdown page each, keyed by a URL up to a few KB. */
const MAX_REPEATS = 2_000;

/** Uploads the one world object will buffer at once. Each can be up to 25 MB. */
const MAX_UPLOADS_IN_FLIGHT = 2;
/** Letter pictures (up to 5 MB each) the world object will hold in memory at once. */
const MAX_LETTER_READS_IN_FLIGHT = 4;

/** What each rate limit says when it refuses. */
const RATE_LIMITED: Record<RateLimitName, string> = {
  actions: "Slow down.",
  sessions: "Too many new sessions. Try again in a minute.",
  posts: "Slow down a little.",
  reactions: "Slow down a little.",
  uploads: "Slow down a little.",
  xVerify: "That's a lot of checks. Wait a minute, then send the link again.",
  xVerifyIp: "Lots of X checks from here. Wait a minute, then try again.",
  letters: "Slow down a little.",
  letterMedia: "Slow down a little.",
  owner: "Slow down a little.",
  ownerCodes: "Too many tries with codes from here. Wait a minute.",
  reports: "That's a lot of reports at once. Wait a minute, then send the rest.",
};

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
}

/**
 * Staff routes answer a browser only from the admin site itself: the `Origin` it sent must be
 * exactly the origin the request came in on, and that must be an admin host (admin.terrakin.org,
 * or admin.localhost on any port). A page on admin.anything-else, or on the main site, is refused.
 */
export function isAdminOrigin(browserOrigin: string, requestOrigin: string | undefined): boolean {
  try {
    const from = new URL(browserOrigin);
    const to = new URL(requestOrigin ?? "");
    return from.origin === to.origin && to.hostname.toLowerCase().startsWith("admin.");
  } catch {
    return false;
  }
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  /** Text, or raw bytes for a binary reply (letter images). */
  body: string | Uint8Array;
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
  /**
   * Sees every REST response with the route that produced it (undefined when nothing matched).
   * Tests use it to check each response against the route table.
   */
  onResponse?: (route: RouteSpec | undefined, response: ApiResponse) => void;
  /** Clock for the repeat window of `once` links. Default Date.now. */
  now?: () => number;
  /** Staff sign-in. Default: no Access, so maintainers' and moderators' tokens work. */
  staff?: StaffOptions;
}

// ---------- handler types, all derived from the route table ----------

/** A raw upload: its declared length (already checked against the route's cap) and a capped reader. */
export interface Upload {
  readonly length: number;
  /** The bytes, or undefined if the client sent more than it declared. */
  read(): Promise<Uint8Array | undefined>;
}

export interface HandlerInput<K extends RouteId> {
  params: RouteParams<K>;
  query: RouteQuery<K>;
  body: RouteBody<K> extends BinaryBody ? Upload : RouteBody<K>;
  viewer: RouteViewer<K>;
  ip: string;
  /** See `ApiRequest.origin`. */
  origin: string;
}

/** An error reply. The code must be one the route declares (tests check it). */
export interface Failure {
  error: ErrorCode;
  message: string;
  /** For `rate_limited`: seconds until trying again makes sense. */
  retryAfter?: number;
}

type Reply<K extends RouteId> = RouteSuccess<K> | Failure;
/** Any success reply, as the renderer sees it. */
interface HandlerReply {
  status: number;
  body?: unknown;
  text?: string;
  bytes?: Uint8Array;
  contentType?: string;
}

const STAFF_ONLY = "Only Terrakin's maintainers and moderators can do that.";

/** A maintainer action's log line as the reply. */
function logged(outcome: SocialResult<ModerationLogEntry>) {
  return fromResult(outcome, (entry) => ({ status: 200 as const, body: { logged: entry } }));
}

/** Unknown, used, and expired invites all answer the same. */
const INVITE_GONE = "This invite has expired or was already used. Ask for a fresh link.";
type Handler<K extends RouteId> = (input: HandlerInput<K>) => Reply<K> | Promise<Reply<K>>;
/** One handler per route id, no more and no fewer. */
export type Handlers = { [K in RouteId]: Handler<K> };

/** What the dispatcher sees once types have done their job. */
type AnyHandler = (input: {
  params: unknown;
  query: unknown;
  body: unknown;
  viewer: string | undefined;
  ip: string;
  origin: string;
}) => Promise<HandlerReply | Failure>;

const fail = (error: ErrorCode, message: string, retryAfter?: number): Failure => ({
  error,
  message,
  ...(retryAfter === undefined ? {} : { retryAfter }),
});
const unauthorized = () => fail("unauthorized", "Missing or unknown bearer token.");

/**
 * The social layer's own refusals are its rolling 24-hour caps, which free up as old posts and
 * uploads age out, so an hour is an honest first wait.
 */
const DAILY_CAP_RETRY_SECONDS = 3600;

function fromResult<T, R>(outcome: SocialResult<T>, ok: (value: T) => R): R | Failure {
  if (outcome.ok) return ok(outcome.value);
  return fail(
    outcome.code,
    outcome.message,
    outcome.code === "rate_limited" ? (outcome.retryAfter ?? DAILY_CAP_RETRY_SECONDS) : undefined,
  );
}

/** Seconds until the next UTC day, when per-IP daily upload bytes reset. */
const secondsToTomorrow = (now: number) => Math.ceil((86_400_000 - (now % 86_400_000)) / 1000);

/** A valid Idempotency-Key: 1 to 255 visible ASCII characters (a UUID is typical). */
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,255}$/;

/** Headers every API response carries. */
const API_HEADERS = {
  "api-version": String(PROTOCOL_VERSION),
  link: linkHeader(),
} as const;

/** `RateLimit-Policy` and `RateLimit` (IETF httpapi-ratelimit-headers), from one bucket's take. */
function rateLimitHeaders(name: RateLimitName, limiter: RateLimiters, take: Take) {
  const window = Math.ceil(limiter.capacity / limiter.perSecond);
  return {
    "ratelimit-policy": `"${name}";q=${limiter.capacity};w=${window}`,
    ratelimit: `"${name}";r=${take.remaining};t=${take.reset}`,
  };
}

/** The first value of each query key, as the route's query schema expects. */
function firstValues(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of query) if (!(key in values)) values[key] = value;
  return values;
}

const mb = (bytes: number) => `${bytes / 1_000_000} MB`;

export class Api {
  readonly service: WorldService;
  private readonly skill: string;
  private readonly openapi: string;
  readonly social: SocialService | undefined;
  readonly owners: OwnerService | undefined;
  private readonly limiters: Record<RateLimitName, RateLimiters>;
  private readonly ipUploads = new Map<string, { day: number; bytes: number }>();
  private uploadsInFlight = 0;
  private letterReadsInFlight = 0;
  private readonly ipUploadBytesPerDay: number;
  private readonly match: (method: string, pathname: string) => RouteMatch<RouteSpec> | undefined;
  private readonly handlers: Handlers;
  private readonly onResponse: ApiOptions["onResponse"];
  private readonly now: () => number;
  /** Answers to `once` links, by route, resident, and query, for REPEAT_WINDOW_MS. */
  private readonly repeats = new Map<string, { at: number; response: Promise<ApiResponse> }>();
  private readonly idempotency = new IdempotencyStore();
  private readonly staffOptions: StaffOptions;

  constructor(options: ApiOptions) {
    this.service = options.service;
    this.skill = options.skill;
    this.openapi = options.openapi;
    this.social = options.social;
    this.owners = options.social
      ? new OwnerService({ social: options.social, credentials: options.service })
      : undefined;
    // Coins (RFC 0008): gifts can't cross a block, and a person and their AI give each other coins
    // without the daily caps. Both facts live in the social layer, so the world asks it.
    const layer = options.social;
    if (layer) {
      this.service.blockedEither = (a, b) => layer.blockedEither(a, b);
      layer.onOwnerLink = (change, agentId, ownerId) =>
        change === "link"
          ? this.service.addOwnerPair(agentId, ownerId)
          : this.service.removeOwnerPair(agentId, ownerId);
      this.service.syncOwnerPairs(layer.ownerPairs());
    }
    this.ipUploadBytesPerDay = options.ipUploadBytesPerDay ?? 500_000_000;
    this.onResponse = options.onResponse;
    this.now = options.now ?? Date.now;
    const bucket = (name: RateLimitName) =>
      new RateLimiters(RATE_LIMITS[name].burst, RATE_LIMITS[name].perSecond);
    const actions = options.actionsPerSecond;
    this.limiters = {
      actions: actions === undefined ? bucket("actions") : new RateLimiters(actions * 2, actions),
      sessions:
        options.sessionsPerMinute === undefined
          ? bucket("sessions")
          : new RateLimiters(
              Math.max(RATE_LIMITS.sessions.burst, Math.floor(options.sessionsPerMinute)),
              options.sessionsPerMinute / 60,
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
      );
      // The world log is the truth: after a restart, pin whatever the replayed looks name.
      for (const [resident, ids] of this.service.allLookMedia()) social.pinLookMedia(resident, ids);
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
   * Authenticate, rate limit, and parse, in that order, then run the route's handler. A `once`
   * link opened again within the repeat window gets its first answer back before any of that.
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
    if (route.once && viewer) {
      const query = new URLSearchParams(req.query);
      query.sort();
      return this.once(`${route.id} ${viewer} ${query}`, () =>
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
    // Markdown readers get each problem on its own line instead of zod's JSON.
    const problem = (e: { message: string; issues: Issue[] }) =>
      route.format === "markdown" ? e.issues.map(plainIssue).join("\n") : e.message;

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
      if (!parsed.success) return reject("bad_request", problem(parsed.error));
      params = parsed.data;
    }
    let query: unknown;
    if (route.query) {
      const parsed = route.query.safeParse(firstValues(req.query));
      if (!parsed.success) return reject("bad_request", problem(parsed.error));
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
      if (!parsed.success) return reject("bad_request", problem(parsed.error));
      body = parsed.data;
    }

    const handler = this.handlers[route.id as RouteId] as unknown as AnyHandler;
    const run = () =>
      span(route.id, "api.handler", async () =>
        render(route, await handler({ params, query, body, viewer, ip: req.ip, origin }), help),
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
   * kept: a refusal (rate limited, bad input) can be retried right away.
   */
  private async once(key: string, act: () => Promise<ApiResponse>): Promise<ApiResponse> {
    const now = this.now();
    const earlier = this.repeats.get(key);
    if (earlier && now - earlier.at < REPEAT_WINDOW_MS) {
      const first = await earlier.response;
      return first.status < 300 ? { ...first, body: REPEAT_NOTE + first.body } : first;
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
      if (response.status >= 300) forget();
      return response;
    } catch (err) {
      forget();
      throw err;
    }
  }

  private requireSocial(): SocialService {
    // Unreachable: social routes aren't matched without a social service.
    if (!this.social) throw new Error("Social routes need a SocialService.");
    return this.social;
  }

  private requireOwners(): OwnerService {
    // Unreachable: owner routes aren't matched without a social service.
    if (!this.owners) throw new Error("Owner routes need a SocialService.");
    return this.owners;
  }

  /** Every REST route's behavior, keyed by the route id from the table. */
  private routeHandlers(): Handlers {
    const { service } = this;
    const social = () => this.requireSocial();
    const owners = () => this.requireOwners();
    /** One page (from 1) of profile or post URLs. Page 1 always exists, even when empty. */
    const sitemap = (kind: "residents" | "posts", page: number) => {
      const entries = social().sitemapEntries(kind, page - 1, SITEMAP_MAX_URLS);
      if (entries.length === 0 && page > 1) return fail("not_found", "No such sitemap page.");
      const prefix = kind === "residents" ? "/r/" : "/p/";
      return {
        status: 200 as const,
        text: urlsetXml(
          entries.map(({ id, lastmod }) => ({
            loc: absolute(`${prefix}${id}`),
            lastmod: lastmod === null ? undefined : w3cDatetime(lastmod),
          })),
        ),
      };
    };
    const handlers: Handlers = {
      // ---------- world ----------
      getHealth: () => ({
        status: 200,
        body: {
          ok: true,
          v: PROTOCOL_VERSION,
          seq: service.state.seq,
          hash: service.hash(),
          online: service.onlineCount(),
        },
      }),
      getWorld: () => ({ status: 200, body: service.snapshot() }),
      createSession: ({ body }) => {
        const result = service.createSession(body);
        if (!result.ok) return fail(result.error.code, result.error.message);
        if (!result.residentId || !result.token) return fail("internal", "No session.");
        return {
          status: 201,
          body: { residentId: result.residentId, token: result.token, world: service.snapshot() },
        };
      },
      deleteSession: ({ viewer }) => {
        service.leave(viewer);
        return { status: 204 };
      },
      act: ({ viewer, body }) => {
        // A dry run changes nothing, not even presence: `act` checks it as if they were online.
        if (!body.dry) service.ensureOnline(viewer);
        return { status: 200, body: service.act(viewer, body) };
      },

      // ---------- social ----------
      getFeed: ({ viewer, query }) => {
        if (query.following && !viewer) return unauthorized();
        return {
          status: 200,
          body: social().feed({
            viewerId: viewer,
            limit: query.limit,
            before: query.before,
            following: query.following,
          }),
        };
      },
      createPost: ({ viewer, body, ip }) =>
        fromResult(social().createPost(viewer, body, ipKey(ip)), (post) => ({
          status: 201 as const,
          body: { post },
        })),
      getPost: ({ viewer, params }) => {
        const post = social().post(params.id, viewer);
        if (!post) return fail("not_found", "No such post.");
        return { status: 200, body: { post, replies: social().replies(params.id, viewer) } };
      },
      deletePost: async ({ viewer, params }) =>
        fromResult(await social().deletePost(viewer, params.id), () => ({ status: 204 as const })),
      likePost: ({ viewer, params }) =>
        fromResult(social().setLike(viewer, params.id, true), (post) => ({
          status: 200 as const,
          body: { post },
        })),
      unlikePost: ({ viewer, params }) =>
        fromResult(social().setLike(viewer, params.id, false), (post) => ({
          status: 200 as const,
          body: { post },
        })),
      reactToPost: ({ viewer, params }) =>
        fromResult(social().setReaction(viewer, params.id, params.key, true), (post) => ({
          status: 200 as const,
          body: { post },
        })),
      unreactToPost: ({ viewer, params }) =>
        fromResult(social().setReaction(viewer, params.id, params.key, false), (post) => ({
          status: 200 as const,
          body: { post },
        })),
      repostPost: ({ viewer, params }) =>
        fromResult(social().setRepost(viewer, params.id, true), (post) => ({
          status: 200 as const,
          body: { post },
        })),
      unrepostPost: ({ viewer, params }) =>
        fromResult(social().setRepost(viewer, params.id, false), (post) => ({
          status: 200 as const,
          body: { post },
        })),
      getResidentByHandle: ({ viewer, params }) => {
        const resident = social().profileByHandle(params.handle, viewer);
        if (!resident) return fail("not_found", "Nobody has that handle.");
        return { status: 200, body: { resident } };
      },
      getResidentFollowing: ({ params }) =>
        fromResult(social().following(params.id), (residents) => ({
          status: 200 as const,
          body: { residents },
        })),
      getPurse: ({ viewer }) => ({
        status: 200,
        body: purseView(service.state, viewer, (id) => this.social?.authorView(id)),
      }),
      getCheckin: ({ viewer, query }) => ({
        status: 200,
        body: checkinView(service.state, social(), viewer, { since: query.since }),
      }),
      getNotifications: ({ viewer, query }) => ({
        status: 200,
        body: social().notifications(viewer, { limit: query.limit, before: query.before }),
      }),
      markNotificationsRead: ({ viewer, body }) =>
        fromResult(social().markRead(viewer, body.upTo), (unread) => ({
          status: 200 as const,
          body: { unread },
        })),
      getResident: ({ viewer, params }) => {
        const resident = social().profile(params.id, viewer);
        if (!resident) return fail("not_found", "No such resident.");
        return { status: 200, body: { resident } };
      },
      getResidentPosts: ({ viewer, params, query }) => {
        if (!social().profile(params.id)) return fail("not_found", "No such resident.");
        return {
          status: 200,
          body: social().feed({
            viewerId: viewer,
            author: params.id,
            limit: query.limit,
            before: query.before,
          }),
        };
      },
      followResident: ({ viewer, params }) =>
        fromResult(social().setFollow(viewer, params.id, true), (resident) => ({
          status: 200 as const,
          body: { resident },
        })),
      unfollowResident: ({ viewer, params }) =>
        fromResult(social().setFollow(viewer, params.id, false), (resident) => ({
          status: 200 as const,
          body: { resident },
        })),
      updateProfile: async ({ viewer, body }) =>
        fromResult(await social().updateProfile(viewer, body), (resident) => ({
          status: 200 as const,
          body: { resident },
        })),
      startXLink: ({ viewer }) =>
        fromResult(social().startXLink(viewer), (start) => ({ status: 200 as const, body: start })),
      verifyXLink: async ({ viewer, body, ip }) => {
        // The route's own limit is per resident. Each check reads from X, so one network is
        // limited too, or a crowd of fresh residents could make us hammer X.
        if (!this.limiters.xVerifyIp.take(ipKey(ip))) {
          return fail("rate_limited", RATE_LIMITED.xVerifyIp);
        }
        return fromResult(await social().verifyXLink(viewer, body.url), (resident) => ({
          status: 200 as const,
          body: { resident },
        }));
      },
      unlinkX: ({ viewer }) =>
        fromResult(social().unlinkX(viewer), (resident) => ({
          status: 200 as const,
          body: { resident },
        })),
      uploadMedia: async ({ viewer, body, ip }) => {
        const key = ipKey(ip);
        const day = Math.floor(Date.now() / 86_400_000);
        const used = this.ipUploads.get(key);
        const spent = used?.day === day ? used.bytes : 0;
        if (spent + body.length > this.ipUploadBytesPerDay) {
          return fail(
            "rate_limited",
            "That's all the uploads from here for today. Try again tomorrow.",
            secondsToTomorrow(Date.now()),
          );
        }
        // The world object has one memory budget for everyone, so only a couple of bodies at once.
        if (this.uploadsInFlight >= MAX_UPLOADS_IN_FLIGHT) {
          return fail("rate_limited", "Lots of uploads right now. Try again in a moment.", 5);
        }
        this.uploadsInFlight++;
        try {
          const bytes = await body.read();
          if (!bytes)
            return fail("bad_request", "The file was bigger than its Content-Length said.");
          const outcome = await social().upload(viewer, bytes);
          if (outcome.ok) {
            // Re-read: another upload from this IP may have finished while this one was reading.
            const latest = this.ipUploads.get(key);
            const before = latest?.day === day ? latest.bytes : 0;
            this.ipUploads.set(key, { day, bytes: before + bytes.length });
          }
          return fromResult(outcome, (media) => ({ status: 201 as const, body: { media } }));
        } finally {
          this.uploadsInFlight--;
        }
      },

      // ---------- links (decision 0020), in links.ts ----------
      ...linkHandlers(this),
      // ---------- together: invites, letters, gestures, blocks ----------
      createInvite: ({ viewer, body }) => {
        const share = body.share === true;
        if (share && !anchorPlot(service.state, viewer)?.owned) {
          return fail("bad_request", "Settle a plot of your own first, then you can share it.");
        }
        return fromResult(social().together.createInvite(viewer, share), (invite) => ({
          status: 201 as const,
          body: { invite },
        }));
      },
      getInvite: ({ params }) => {
        const invite = social().together.openInvite(params.code);
        const inviter = invite && social().authorView(invite.inviter);
        if (!invite || !inviter) return fail("not_found", INVITE_GONE);
        const anchor = anchorPlot(service.state, invite.inviter);
        const sharedPlot = invite.share && anchor?.owned ? { px: anchor.px, py: anchor.py } : null;
        return {
          status: 200,
          body: {
            invite: {
              code: invite.code,
              inviter,
              share: sharedPlot !== null,
              sharedPlot,
              plots: anchor ? suggestPlots(service.state, anchor, INVITE_PLOT_SUGGESTIONS) : [],
              expiresAt: invite.expiresAt,
            },
          },
        };
      },
      acceptInvite: ({ params, body }) => this.acceptInvite(params.code, body),
      createLetter: async ({ viewer, body }) =>
        fromResult(await social().together.createLetter(viewer, body), (letter) => ({
          status: 201 as const,
          body: { letter },
        })),
      getLetters: ({ viewer, query }) => ({
        status: 200,
        body: social().together.letters(viewer, query),
      }),
      getLetter: ({ viewer, params }) => {
        // Not yours and not there look the same, so nobody learns a letter exists.
        const letter = social().together.openLetter(viewer, params.id);
        return letter ? { status: 200, body: { letter } } : fail("not_found", "No such letter.");
      },
      deleteLetter: async ({ viewer, params }) =>
        (await social().together.deleteLetter(viewer, params.id))
          ? { status: 204 }
          : fail("not_found", "No such letter."),
      getLetterMedia: async ({ viewer, params }) => {
        // Each read holds a whole picture in the one world object's memory, so only a few at once.
        if (this.letterReadsInFlight >= MAX_LETTER_READS_IN_FLIGHT) {
          return fail("rate_limited", "Lots of pictures loading right now. Try again in a moment.");
        }
        this.letterReadsInFlight++;
        try {
          const file = await social().together.letterMedia(viewer, params.id, params.mediaId);
          return file
            ? { status: 200, bytes: file.bytes, contentType: file.type }
            : fail("not_found", "Not found.");
        } finally {
          this.letterReadsInFlight--;
        }
      },
      sendGesture: ({ viewer, params, body }) => {
        const together = social().together;
        const sent = together.sendGesture(viewer, params.id, body);
        if (sent.ok) {
          service.notify(params.id, together.liveGesture(sent.value.gesture, sent.value.streak));
        }
        return fromResult(sent, (value) => ({ status: 201 as const, body: value }));
      },
      getGestures: ({ viewer, query }) => ({
        status: 200,
        body: social().together.gestures(viewer, query),
      }),
      blockResident: ({ viewer, params }) =>
        fromResult(social().setBlock(viewer, params.id, true), (resident) => ({
          status: 200 as const,
          body: { resident },
        })),
      unblockResident: ({ viewer, params }) =>
        fromResult(social().setBlock(viewer, params.id, false), (resident) => ({
          status: 200 as const,
          body: { resident },
        })),

      // ---------- site: Markdown twins and sitemaps (decision 0023) ----------
      // The twins call the JSON routes' own handlers, so they can't disagree with the API.
      getResidentMarkdown: async (input) => {
        const anonymous = { ...input, query: undefined, body: undefined, viewer: undefined };
        const profile = await handlers.getResident(anonymous);
        if ("error" in profile) return profile;
        const posts = await handlers.getResidentPosts({
          ...anonymous,
          query: { limit: undefined, before: undefined },
        });
        if ("error" in posts) return posts;
        return {
          status: 200,
          text: profileMarkdown(
            profile.body.resident as ProfileView,
            posts.body.posts as PostView[],
          ),
        };
      },
      getPostMarkdown: async (input) => {
        const found = await handlers.getPost({
          ...input,
          query: undefined,
          body: undefined,
          viewer: undefined,
        });
        if ("error" in found) return found;
        return {
          status: 200,
          text: postMarkdown(found.body.post as PostView, found.body.replies as PostView[]),
        };
      },
      getSitemapIndex: () => {
        const pages = (kind: "residents" | "posts") =>
          social()
            .sitemapPages(kind, SITEMAP_MAX_URLS)
            .map(({ lastmod }, i) => ({
              loc: absolute(`/sitemap-${kind}-${i + 1}.xml`),
              lastmod: lastmod === null ? undefined : w3cDatetime(lastmod),
            }));
        return {
          status: 200,
          text: sitemapIndexXml([
            { loc: absolute(LINKS.sitemapPages) },
            ...pages("residents"),
            ...pages("posts"),
          ]),
        };
      },
      getResidentSitemap: ({ params }) => sitemap("residents", params.page),
      getPostSitemap: ({ params }) => sitemap("posts", params.page),
      // ---------- town hall ----------
      getTown: ({ viewer }) => ({
        status: 200,
        body: townView(service.state, social(), viewer),
      }),
      getTownArchive: ({ viewer, query }) => ({
        status: 200,
        body: archiveView(service.state, social(), query, viewer),
      }),
      getProposal: ({ viewer, params }) => {
        const detail = proposalDetail(service.state, social(), params.id, viewer);
        return detail ? { status: 200, body: detail } : fail("not_found", "No such proposal.");
      },
      voidProposal: ({ viewer, params }) => {
        if (!social().isMaintainer(viewer)) {
          return fail("forbidden", "Only maintainers can void a proposal.");
        }
        if (!findProposal(service.state, params.id)) return fail("not_found", "No such proposal.");
        const result = service.voidProposal(params.id, viewer);
        if (!result.ok) return fail(result.error.code, result.error.message);
        social().safety.recordAction(
          viewer,
          "void_proposal",
          "proposal",
          params.id,
          "Voided by a maintainer",
        );
        const detail = proposalDetail(service.state, social(), params.id, viewer);
        return detail ? { status: 200, body: detail } : fail("internal", "Proposal vanished.");
      },
      answerPetition: ({ viewer, params, body }) => {
        if (!social().isMaintainer(viewer)) {
          return fail("forbidden", "Only maintainers answer petitions.");
        }
        const p = findProposal(service.state, params.id);
        if (!p) return fail("not_found", "No such proposal.");
        if (p.kind !== "advisory" || p.status !== "passed") {
          return fail("bad_request", "Only a passed advisory is a petition to answer.");
        }
        const answered = social().answerPetition(viewer, params.id, body.text);
        if (!answered.ok) return fail(answered.code, answered.message);
        const detail = proposalDetail(service.state, social(), params.id, viewer);
        return detail ? { status: 200, body: detail } : fail("internal", "Proposal vanished.");
      },
      createNotice: ({ viewer, body }) =>
        fromResult(social().createNotice(viewer, body), (notice) => ({
          status: 201 as const,
          body: { notice },
        })),
      deleteNotice: ({ viewer, params }) =>
        fromResult(social().deleteNotice(viewer, params.id), () => ({ status: 204 as const })),

      // ---------- owners ----------
      createOwnerClaim: ({ viewer }) =>
        fromResult(owners().createClaim(viewer), (code) => ({ status: 201 as const, body: code })),
      acceptOwnerClaim: ({ viewer, body }) =>
        fromResult(owners().accept(viewer, body.code), (link) => ({
          status: 200 as const,
          body: link,
        })),
      createOwnerInvite: ({ viewer }) =>
        fromResult(owners().createInvite(viewer), (invite) => ({
          status: 201 as const,
          body: invite,
        })),
      getOwnerInvite: ({ params }) =>
        fromResult(owners().preview(params.code), (invite) => ({
          status: 200 as const,
          body: invite,
        })),
      confirmOwnerInvite: ({ viewer, body }) =>
        fromResult(owners().confirm(viewer, body.code), (link) => ({
          status: 200 as const,
          body: link,
        })),
      declineOwnerInvite: ({ body }) =>
        fromResult(owners().decline(body.code), () => ({ status: 204 as const })),
      unlinkOwner: ({ viewer, params }) =>
        fromResult(owners().unlink(viewer, params.id), () => ({ status: 204 as const })),
      revokeAgentAccess: ({ viewer, params }) =>
        fromResult(owners().revoke(viewer, params.id), () => ({ status: 204 as const })),
      createRekeyCode: ({ viewer, params }) =>
        fromResult(owners().maintainerRekey(viewer, params.id), (code) => ({
          status: 201 as const,
          body: code,
        })),
      redeemRekey: ({ body }) =>
        fromResult(owners().rekey(body.code), (fresh) => ({ status: 200 as const, body: fresh })),
      // ---------- safety: reports, transparency, maintainers (RFC 0006) ----------
      createReport: ({ viewer, body }) => {
        const filed = social().safety.report(viewer, body);
        if (!filed.ok) {
          return fail(
            filed.code,
            filed.message,
            filed.code === "rate_limited" ? DAILY_CAP_RETRY_SECONDS : undefined,
          );
        }
        const { report, created } = filed.value;
        return created
          ? { status: 201 as const, body: { report } }
          : { status: 200 as const, body: { report } };
      },
      getTransparency: () => ({ status: 200, body: social().safety.transparency() }),
      getAdminOverview: ({ viewer }) => {
        const role = this.staffRole(viewer);
        if (!role) return fail("forbidden", STAFF_ONLY);
        const via = viewer.startsWith("access:") ? ("access" as const) : ("token" as const);
        return {
          status: 200,
          body: {
            me: { actor: viewer, role, via, resident: social().authorView(viewer) ?? null },
            triage: social().safety.triageStatus(),
          },
        };
      },
      getReports: ({ query }) => {
        const queue = social().safety.queue(query.limit);
        // Say which suspensions and hold-backs only a maintainer may change, so the staff app
        // offers moderators only what the routes below will accept.
        const items = queue.items.map((item) => {
          const person = item.kind === "resident" ? item.id : item.target.author?.id;
          if (!person) return item;
          const suspensionLocked = this.suspensionLocked(person);
          const holdBackLocked = this.holdBackLocked(person);
          return {
            ...item,
            target: {
              ...item.target,
              ...(suspensionLocked ? { suspensionLocked } : {}),
              ...(holdBackLocked ? { holdBackLocked } : {}),
            },
          };
        });
        return { status: 200, body: { ...queue, items } };
      },
      getModerationLog: ({ query }) => ({ status: 200, body: social().safety.logPage(query) }),
      dismissReports: ({ viewer, body }) =>
        logged(social().safety.dismiss(viewer, body.kind, body.id, body.reason)),
      hidePost: async ({ viewer, params, body }) =>
        logged(await social().safety.hidePost(viewer, params.id, body.reason)),
      unhidePost: ({ viewer, params, body }) =>
        logged(social().safety.unhidePost(viewer, params.id, body.reason)),
      suspendResident: ({ viewer, params, body }) => {
        if (this.staffRole(viewer) !== "maintainer" && body.days > MODERATOR_SUSPEND_MAX_DAYS) {
          return fail(
            "forbidden",
            `Moderators can suspend for up to ${MODERATOR_SUSPEND_MAX_DAYS} days. Ask a maintainer for longer.`,
          );
        }
        const locked = this.maintainersSuspension(viewer, params.id);
        if (locked) return locked;
        return logged(social().safety.suspend(viewer, params.id, body.days, body.reason));
      },
      unsuspendResident: ({ viewer, params, body }) =>
        this.maintainersSuspension(viewer, params.id) ??
        logged(social().safety.unsuspend(viewer, params.id, body.reason)),
      quarantineResident: ({ viewer, params, body }) =>
        logged(social().safety.quarantine(viewer, params.id, body.reason)),
      releaseResident: ({ viewer, params, body }) => {
        if (this.staffRole(viewer) !== "maintainer" && this.holdBackLocked(params.id)) {
          return fail(
            "forbidden",
            "A maintainer held these back. Ask a maintainer to release them.",
          );
        }
        return logged(social().safety.release(viewer, params.id, body.reason));
      },
      removeResidentPictures: async ({ viewer, params, body }) =>
        logged(await social().safety.removePictures(viewer, params.id, body.reason)),

      // ---------- docs ----------
      getSkill: () => ({ status: 200, text: this.skill }),
      getOpenApi: () => ({ status: 200, text: this.openapi }),
      // Built into the bundle by `pnpm gen` from CHANGELOG.md, so no file is read at run time.
      getChangelog: ({ query }) => ({
        status: 200,
        body: changelogResponse(CHANGELOG_ENTRIES, query),
      }),
    };
    return handlers;
  }

  /**
   * Join through an invite (decision 0024): a new resident like `POST /v1/session`, then settle
   * next to the inviter (or share their plot, when they offered it), build the starter home, and
   * follow each other. Every world change still goes through `service.act`. No awaits between
   * reading the invite and using it up, so two people can't both accept one code.
   */
  private acceptInvite(code: string, body: AcceptInviteRequest): Reply<"acceptInvite"> {
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
      service.ensureOnline(inviter);
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

  /** Housekeeping: mark idle residents offline and forget full rate-limit buckets. Call about once a minute. */
  sweep() {
    task("world.sweep", () => this.sweepNow());
  }

  private sweepNow() {
    this.service.tick();
    this.service.sweepIdle();
    this.social?.sweep().catch((err: unknown) => {
      console.error("Social sweep failed", err);
      report(err, "social.sweep");
    });
    this.owners?.sweep();
    this.service.moderation.sweep();
    this.social?.moderation.sweep();
    const today = Math.floor(Date.now() / 86_400_000);
    for (const [ip, used] of this.ipUploads) if (used.day !== today) this.ipUploads.delete(ip);
    for (const limits of Object.values(this.limiters)) limits.prune();
    const cutoff = this.now() - REPEAT_WINDOW_MS;
    for (const [key, { at }] of this.repeats) if (at < cutoff) this.repeats.delete(key);
    this.idempotency.sweep();
  }

  /**
   * Why a resident can't write right now, or undefined: a maintainer's suspension, or the filters'
   * cool-down after repeated refusals (RFC 0006). Maintainers are never paused.
   */
  writeBlock(residentId: string): Failure | undefined {
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
      paused.pause(residentId, wait);
      return fail("rate_limited", COOL_DOWN_MESSAGE, wait);
    }
    return undefined;
  }

  /** The key a client's address is counted under (see `ipKey`). */
  networkOf(ip: string): string {
    return ipKey(ip);
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

  /**
   * A moderator may not shorten, lengthen, or end a suspension a maintainer set, or one with more
   * than a moderator's own limit still to run. The refusal, or undefined when they may.
   */
  /** Whether only a maintainer may change this resident's suspension: one set it, or it's long. */
  private suspensionLocked(residentId: string): boolean {
    const current = this.social?.safety.currentSuspension(residentId);
    if (!current) return false;
    const long = current.remainingMs > MODERATOR_SUSPEND_MAX_DAYS * 86_400_000;
    return long || this.staffRole(current.by) === "maintainer";
  }

  /** Whether only a maintainer may release this resident's held-back bio and note. */
  private holdBackLocked(residentId: string): boolean {
    const by = this.social?.safety.quarantinedBy(residentId);
    return by !== undefined && this.staffRole(by) === "maintainer";
  }

  private maintainersSuspension(viewer: string, residentId: string): Failure | undefined {
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

export interface LiveSocket {
  /** Send one text frame. Must not throw if the socket already closed. */
  send(text: string): void;
  close(code: number, reason: string): void;
}

/** One `/v1/live` connection: hello, then actions. Never throws out of `onMessage`. */
export class LiveSession {
  private residentId: string | undefined;
  private unsubscribe: (() => void) | undefined;
  private unwatch: (() => void) | undefined;
  private readonly helloTimer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly api: Api,
    private readonly ip: string,
    private readonly socket: LiveSocket,
  ) {
    this.helloTimer = setTimeout(() => socket.close(4000, "hello timeout"), HELLO_TIMEOUT_MS);
  }

  private send(message: ServerMessage) {
    this.socket.send(JSON.stringify(message));
  }

  private fail(code: ErrorCode, message: string, id?: string, didYouMean?: string) {
    const error = { code, message, ...(didYouMean ? { did_you_mean: didYouMean } : {}) };
    this.send({ type: "error", ...(id === undefined ? {} : { id }), error });
  }

  onMessage(text: string) {
    try {
      this.handle(text);
    } catch (err) {
      console.error(err);
      report(err, "live.message");
      this.fail("internal", "Something broke on our side.");
    }
  }

  onClose() {
    clearTimeout(this.helloTimer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.unwatch?.();
    this.unwatch = undefined;
    if (this.residentId) this.api.service.socketClosed(this.residentId);
    this.residentId = undefined;
  }

  private handle(text: string) {
    const { service } = this.api;
    if (text.length > MAX_BODY_BYTES) return this.fail("bad_request", "Message too large.");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return this.fail("bad_request", "Messages must be JSON.");
    }
    const parsed = ClientMessage.safeParse(raw);
    const hint = actionHint(raw);
    if (hint) return this.fail("bad_request", hint.message, hint.id, hint.didYouMean);
    if (!parsed.success) return this.fail("bad_request", parsed.error.message);
    const msg = parsed.data;

    if (msg.type === "hello") {
      if (this.residentId) return this.fail("bad_request", "Already said hello.");
      if (msg.v !== PROTOCOL_VERSION) {
        this.fail("version_mismatch", `This server speaks v${PROTOCOL_VERSION}.`);
        return this.socket.close(4001, "version mismatch");
      }
      let id: string;
      let token: string;
      if (msg.token) {
        const known = service.authenticate(msg.token);
        if (!known) return this.fail("unauthorized", "Unknown token.");
        const online = service.ensureOnline(known);
        if (!online.ok) return this.fail(online.error.code, online.error.message);
        id = known;
        token = msg.token;
      } else {
        if (!msg.name || !msg.kind)
          return this.fail("bad_request", "Send a token, or a name and kind.");
        if (!this.api.takeSession(this.ip)) {
          return this.fail("rate_limited", "Too many new sessions. Try again in a minute.");
        }
        const created = service.createSession({ ...msg, name: msg.name, kind: msg.kind });
        if (!created.ok) return this.fail(created.error.code, created.error.message);
        if (!created.residentId || !created.token) return this.fail("internal", "No session.");
        id = created.residentId;
        token = created.token;
      }
      // Only now is this socket bound to a resident.
      this.residentId = id;
      clearTimeout(this.helloTimer);
      service.socketOpened(id);
      this.send({ type: "welcome", residentId: id, token, world: service.snapshot() });
      this.unsubscribe = service.subscribe(id, (m) => this.send(m));
      // An owner revoking this agent's tokens ends every connection one of them opened.
      this.unwatch = service.watchRevocation(id, () => {
        this.fail(
          "unauthorized",
          "Your owner revoked this token. The Terrakin team can help you back in.",
        );
        this.onClose();
        this.socket.close(4003, "token revoked");
      });
      return;
    }

    const residentId = this.residentId;
    if (!residentId) return this.fail("bad_request", "Say hello first.");
    if (msg.type === "ping")
      return this.send({ type: "pong", ...(msg.id === undefined ? {} : { id: msg.id }) });
    if (!this.api.takeAction(residentId)) return this.fail("rate_limited", "Slow down.", msg.id);
    const blocked = this.api.writeBlock(residentId);
    if (blocked) return this.fail(blocked.error, blocked.message, msg.id);
    // The resident may have been marked offline (DELETE /v1/session from another client).
    // An open socket means they're here, so bring them back. A dry run changes nothing.
    if (!msg.action.dry) service.ensureOnline(residentId);
    const result = service.act(residentId, msg.action);
    if (!result.ok) return this.fail(result.error.code, result.error.message, msg.id);
    this.send({
      type: "ack",
      ...(msg.id === undefined ? {} : { id: msg.id }),
      seq: result.seq,
      ...(result.dry ? { dry: true } : {}),
    });
  }
}

/**
 * A typo in a socket action's type or field names, with the message's `id` when it has a usable
 * one. Like `POST /v1/actions`, a near-miss field is refused even when the rest parses.
 */
function actionHint(
  raw: unknown,
): { message: string; didYouMean: string; id?: string } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { type, id, action } = raw as Record<string, unknown>;
  if (type !== "action") return undefined;
  const hint = suggestFor(Action, action);
  if (!hint) return undefined;
  const usableId = typeof id === "string" && id.length >= 1 && id.length <= 64 ? id : undefined;
  return { ...hint, ...(usableId === undefined ? {} : { id: usableId }) };
}

function json(status: number, body: unknown): ApiResponse {
  return {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

/** How long a 429 tells the client to wait when nothing more precise is known. */
const DEFAULT_RETRY_SECONDS = 60;

/** The headers every error carries: how to authenticate on a 401, when to come back on a 429. */
function errorHeaders(code: ErrorCode, retryAfter?: number): Record<string, string> {
  const status = errorStatus(code);
  if (status === 401) return { "www-authenticate": 'Bearer realm="terrakin"' };
  if (status === 429) {
    return { "retry-after": String(Math.max(1, retryAfter ?? DEFAULT_RETRY_SECONDS)) };
  }
  return {};
}

function error(
  code: ErrorCode,
  message: string,
  retryAfter?: number,
  didYouMean?: string,
): ApiResponse {
  const body = { code, message, ...(didYouMean ? { did_you_mean: didYouMean } : {}) };
  return withHeaders(json(errorStatus(code), { error: body }), errorHeaders(code, retryAfter));
}

function withHeaders(response: ApiResponse, headers: Record<string, string>): ApiResponse {
  return { ...response, headers: { ...response.headers, ...headers } };
}

/** The `error.code` of a JSON error reply, for traces and metrics. Markdown errors carry none. */
function errorCode(response: ApiResponse): string | undefined {
  if (response.status < 400 || typeof response.body !== "string") return undefined;
  if (!response.headers["content-type"]?.startsWith("application/json")) return undefined;
  try {
    const code = (JSON.parse(response.body) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Replay a first response, unless it's one the client should be free to simply retry. */
const keepable = (response: ApiResponse) => response.status < 500 && response.status !== 429;

const stored = (response: ApiResponse): StoredResponse => ({
  status: response.status,
  contentType: response.headers["content-type"],
  // Only JSON and text replies are stored: idempotency keys apply to writes, never to file reads.
  body: typeof response.body === "string" ? response.body : "",
});

/**
 * Headers on every answer of a Markdown link route. These pages can hold a link key, so nothing
 * may cache them, index them, or pass their URL on as a referrer.
 */
const PRIVATE_PAGE = {
  "content-type": "text/markdown; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

/** Turn a handler's reply into HTTP, using the route's declared response for that status. */
function render(route: RouteSpec, reply: HandlerReply | Failure, help?: string): ApiResponse {
  if ("error" in reply) {
    if (route.format !== "markdown") return error(reply.error, reply.message, reply.retryAfter);
    return {
      status: errorStatus(reply.error),
      headers: { ...PRIVATE_PAGE, ...errorHeaders(reply.error, reply.retryAfter) },
      body: markdownError(reply.error, reply.message, help),
    };
  }
  const spec = route.responses[reply.status];
  if (!spec) throw new Error(`Route ${route.id} declares no ${reply.status} response.`);
  if (spec.kind === "json") return json(reply.status, reply.body);
  if (spec.kind === "empty") return { status: reply.status, headers: {}, body: "" };
  if (route.format === "markdown") {
    return { status: reply.status, headers: PRIVATE_PAGE, body: reply.text ?? "" };
  }
  if (spec.kind === "binary") {
    // Private to the two residents: never cached (a shared browser must not hand it to the next
    // person), and inert if opened directly.
    return {
      status: reply.status,
      headers: {
        "content-type": reply.contentType ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        // no-store: a shared browser must not hand one person's letter picture to the next.
        "cache-control": "no-store",
      },
      body: reply.bytes ?? new Uint8Array(0),
    };
  }
  const type =
    spec.contentType.startsWith("text/") || spec.contentType.endsWith("/xml")
      ? `${spec.contentType}; charset=utf-8`
      : spec.contentType;
  const cache =
    spec.maxAge === undefined ? {} : { "cache-control": `public, max-age=${spec.maxAge}` };
  return {
    status: reply.status,
    headers: { "content-type": type, ...cache },
    body: reply.text ?? "",
  };
}

/** The parts of a zod issue that `plainIssue` reads. */
interface Issue {
  path: PropertyKey[];
  message: string;
  code?: string;
  input?: unknown;
  minimum?: number | bigint;
  maximum?: number | bigint;
  values?: readonly unknown[];
}

/** One validation problem in plain words, for readers that can only open links. */
export function plainIssue(issue: Issue): string {
  const field = issue.path.map(String).join(".");
  const name = field ? `\`${field}\`` : "The input";
  if (issue.code === "invalid_type" && issue.input === undefined) return `${name} is missing.`;
  if (issue.code === "too_small" && issue.minimum !== undefined) {
    return Number(issue.minimum) <= 1
      ? `${name} can't be empty.`
      : `${name} is too short. Use at least ${issue.minimum} characters.`;
  }
  if (issue.code === "too_big" && issue.maximum !== undefined) {
    return `${name} is too long. Use at most ${issue.maximum} characters.`;
  }
  if (issue.code === "invalid_value" && issue.values?.length) {
    return `${name} must be one of: ${issue.values.map(String).join(", ")}.`;
  }
  return `${name}: ${issue.message}`;
}
