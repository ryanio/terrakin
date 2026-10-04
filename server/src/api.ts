import {
  type BinaryBody,
  ClientMessage,
  compileRoutes,
  type ErrorCode,
  errorStatus,
  isBinaryBody,
  MAX_BODY_BYTES,
  markdownError,
  PROTOCOL_VERSION,
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
} from "@terrakin/protocol";
import { BAD_LINK_KEY, DEFAULT_ORIGIN, linkHandlers, linkHelp, REPEAT_NOTE } from "./links";
import { RateLimiters } from "./rate-limit";
import type { SocialResult, SocialService } from "./social-service";
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

/** What each rate limit says when it refuses. */
const RATE_LIMITED: Record<RateLimitName, string> = {
  actions: "Slow down.",
  sessions: "Too many new sessions. Try again in a minute.",
  posts: "Slow down a little.",
  reactions: "Slow down a little.",
  uploads: "Slow down a little.",
};

const TABLE = ROUTES as readonly RouteSpec[];

/** Paths outside `/v1/` that the API answers (aliases like `/skill.md`). Adapters forward these too. */
const ROOT_PATHS = new Set<string>(
  TABLE.flatMap((r) => [r.path, ...(r.aliases ?? [])]).filter((p) => !p.startsWith("/v1/")),
);

/** Whether a request for this path belongs to the API rather than to static files or media. */
export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/v1/") || ROOT_PATHS.has(pathname);
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
}

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface ApiOptions {
  service: WorldService;
  /** Served at `GET /v1/skill`. */
  skill: string;
  /** Served at `GET /v1/openapi.json`. */
  openapi: string;
  /** Actions per second allowed per resident (burst = 2x). Default from RATE_LIMITS.actions. */
  actionsPerSecond?: number;
  /** New sessions per minute allowed per IP (burst = 5). Default from RATE_LIMITS.sessions. */
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
}

type Reply<K extends RouteId> = RouteSuccess<K> | Failure;
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
}) => Promise<{ status: number; body?: unknown; text?: string } | Failure>;

const fail = (error: ErrorCode, message: string): Failure => ({ error, message });
const unauthorized = () => fail("unauthorized", "Missing or unknown bearer token.");

function fromResult<T, R>(outcome: SocialResult<T>, ok: (value: T) => R): R | Failure {
  return outcome.ok ? ok(outcome.value) : fail(outcome.code, outcome.message);
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
  private readonly limiters: Record<RateLimitName, RateLimiters>;
  private readonly ipUploads = new Map<string, { day: number; bytes: number }>();
  private uploadsInFlight = 0;
  private readonly ipUploadBytesPerDay: number;
  private readonly match: (method: string, pathname: string) => RouteMatch<RouteSpec> | undefined;
  private readonly handlers: Handlers;
  private readonly onResponse: ApiOptions["onResponse"];
  private readonly now: () => number;
  /** Answers to `once` links, by route, resident, and query, for REPEAT_WINDOW_MS. */
  private readonly repeats = new Map<string, { at: number; response: Promise<ApiResponse> }>();

  constructor(options: ApiOptions) {
    this.service = options.service;
    this.skill = options.skill;
    this.openapi = options.openapi;
    this.social = options.social;
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
          : new RateLimiters(RATE_LIMITS.sessions.burst, options.sessionsPerMinute / 60),
      posts: bucket("posts"),
      reactions: bucket("reactions"),
      uploads: bucket("uploads"),
    };
    // Without a social service its routes don't exist, so they answer not_found like any unknown path.
    this.match = compileRoutes(
      options.social ? TABLE : TABLE.filter((r) => !r.tags.includes("Social")),
    );
    this.handlers = this.routeHandlers();
  }

  /** Handle a REST request. Returns undefined for paths outside the API so the adapter can serve files. */
  async handle(req: ApiRequest): Promise<ApiResponse | undefined> {
    const match = this.match(req.method, req.pathname);
    if (!match && req.method === "GET" && !isApiPath(req.pathname)) return undefined;
    const response = match
      ? await this.dispatch(match, req)
      : // Never echo a link key back, even to its holder.
        error(
          "not_found",
          `No route for ${req.method} ${req.pathname.replace(/^\/v1\/act\/[^/]+/, "/v1/act/<key>")}.`,
        );
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
    const reject = (code: ErrorCode, message: string) => render(route, fail(code, message), help);
    // Markdown readers get each problem on its own line instead of zod's JSON.
    const problem = (e: { message: string; issues: Issue[] }) =>
      route.format === "markdown" ? e.issues.map(plainIssue).join("\n") : e.message;

    if (route.rateLimit) {
      const key =
        RATE_LIMITS[route.rateLimit].scope === "resident" && viewer ? viewer : ipKey(req.ip);
      if (!this.limiters[route.rateLimit].take(key)) {
        return reject("rate_limited", RATE_LIMITED[route.rateLimit]);
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
      const parsed = route.body.safeParse(await req.readJson());
      if (!parsed.success) return reject("bad_request", problem(parsed.error));
      body = parsed.data;
    }

    const handler = this.handlers[route.id as RouteId] as unknown as AnyHandler;
    const reply = await handler({
      params,
      query,
      body,
      viewer,
      ip: req.ip,
      origin,
    });
    return render(route, reply, help);
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

  /** Every REST route's behavior, keyed by the route id from the table. */
  private routeHandlers(): Handlers {
    const { service } = this;
    const social = () => this.requireSocial();
    return {
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
        service.ensureOnline(viewer);
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
      createPost: ({ viewer, body }) =>
        fromResult(social().createPost(viewer, body), (post) => ({
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
      uploadMedia: async ({ viewer, body, ip }) => {
        const key = ipKey(ip);
        const day = Math.floor(Date.now() / 86_400_000);
        const used = this.ipUploads.get(key);
        const spent = used?.day === day ? used.bytes : 0;
        if (spent + body.length > this.ipUploadBytesPerDay) {
          return fail(
            "rate_limited",
            "That's all the uploads from here for today. Try again tomorrow.",
          );
        }
        // The world object has one memory budget for everyone, so only a couple of bodies at once.
        if (this.uploadsInFlight >= MAX_UPLOADS_IN_FLIGHT) {
          return fail("rate_limited", "Lots of uploads right now. Try again in a moment.");
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

      // ---------- docs ----------
      getSkill: () => ({ status: 200, text: this.skill }),
      getOpenApi: () => ({ status: 200, text: this.openapi }),
    };
  }

  /** Start the `/v1/live` protocol for one socket. The adapter feeds it text and tells it when the socket closes. */
  live(ip: string, socket: LiveSocket): LiveSession {
    return new LiveSession(this, ip, socket);
  }

  /** Housekeeping: mark idle residents offline and forget full rate-limit buckets. Call about once a minute. */
  sweep() {
    this.service.sweepIdle();
    this.social?.sweep().catch((err: unknown) => console.error("Social sweep failed", err));
    const today = Math.floor(Date.now() / 86_400_000);
    for (const [ip, used] of this.ipUploads) if (used.day !== today) this.ipUploads.delete(ip);
    for (const limits of Object.values(this.limiters)) limits.prune();
    const cutoff = this.now() - REPEAT_WINDOW_MS;
    for (const [key, { at }] of this.repeats) if (at < cutoff) this.repeats.delete(key);
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

  private fail(code: ErrorCode, message: string, id?: string) {
    this.send({ type: "error", ...(id === undefined ? {} : { id }), error: { code, message } });
  }

  onMessage(text: string) {
    try {
      this.handle(text);
    } catch (err) {
      console.error(err);
      this.fail("internal", "Something broke on our side.");
    }
  }

  onClose() {
    clearTimeout(this.helloTimer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
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
      return;
    }

    const residentId = this.residentId;
    if (!residentId) return this.fail("bad_request", "Say hello first.");
    if (msg.type === "ping")
      return this.send({ type: "pong", ...(msg.id === undefined ? {} : { id: msg.id }) });
    if (!this.api.takeAction(residentId)) return this.fail("rate_limited", "Slow down.", msg.id);
    // The resident may have been marked offline (DELETE /v1/session from another client).
    // An open socket means they're here, so bring them back.
    service.ensureOnline(residentId);
    const result = service.act(residentId, msg.action);
    if (!result.ok) return this.fail(result.error.code, result.error.message, msg.id);
    this.send({ type: "ack", ...(msg.id === undefined ? {} : { id: msg.id }), seq: result.seq });
  }
}

function json(status: number, body: unknown): ApiResponse {
  return {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

function error(code: ErrorCode, message: string): ApiResponse {
  return json(errorStatus(code), { error: { code, message } });
}

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
function render(
  route: RouteSpec,
  reply: { status: number; body?: unknown; text?: string } | Failure,
  help?: string,
): ApiResponse {
  if ("error" in reply) {
    if (route.format !== "markdown") return error(reply.error, reply.message);
    return {
      status: errorStatus(reply.error),
      headers: PRIVATE_PAGE,
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
  const type = spec.contentType.startsWith("text/")
    ? `${spec.contentType}; charset=utf-8`
    : spec.contentType;
  return { status: reply.status, headers: { "content-type": type }, body: reply.text ?? "" };
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
