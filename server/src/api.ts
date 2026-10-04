import {
  Action,
  ClientMessage,
  CreatePostRequest,
  CreateSessionRequest,
  type ErrorCode,
  PROTOCOL_VERSION,
  type ServerMessage,
  UpdateProfileRequest,
} from "@terrakin/protocol";
import { RateLimiters } from "./rate-limit";
import type { SocialResult, SocialService } from "./social-service";
import type { WorldService } from "./world-service";

/**
 * The runtime-neutral front door: routes, auth, rate limits, and the `/v1/live` message protocol.
 * The Node server (`app.ts`) and the Cloudflare Durable Object (`cloudflare.ts`) are thin adapters
 * around this, so both speak exactly the same API.
 */

export const MAX_BODY_BYTES = 16 * 1024;
const HELLO_TIMEOUT_MS = 5_000;

const STATUS: Partial<Record<ErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  rate_limited: 429,
  internal: 500,
};

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
}

/** Biggest upload the API reads at all. Per-type limits are smaller (see MEDIA_TYPES). */
export const MAX_UPLOAD_BYTES = 25_000_000;

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
  /** Actions per second allowed per resident (burst = 2x). Default 10. */
  actionsPerSecond?: number;
  /** New sessions per minute allowed per IP (burst = 5). Default 3. */
  sessionsPerMinute?: number;
  /** The social layer (RFC 0003). Without it, the social routes answer not_found. */
  social?: SocialService;
}

export class Api {
  readonly service: WorldService;
  private readonly skill: string;
  private readonly openapi: string;
  private readonly actionLimits: RateLimiters;
  // Every session adds a resident to the log forever, so creating them is much more limited.
  private readonly sessionLimits: RateLimiters;
  readonly social: SocialService | undefined;
  private readonly postLimits = new RateLimiters(6, 6 / 60);
  private readonly reactLimits = new RateLimiters(60, 1);
  private readonly uploadLimits = new RateLimiters(10, 10 / 60);

  constructor(options: ApiOptions) {
    this.service = options.service;
    this.skill = options.skill;
    this.openapi = options.openapi;
    const rate = options.actionsPerSecond ?? 10;
    this.actionLimits = new RateLimiters(rate * 2, rate);
    this.sessionLimits = new RateLimiters(5, (options.sessionsPerMinute ?? 3) / 60);
    this.social = options.social;
  }

  /** Handle a REST request. Returns undefined for paths outside `/v1/` so the adapter can serve files. */
  async handle(req: ApiRequest): Promise<ApiResponse | undefined> {
    const { service } = this;
    const route = `${req.method} ${req.pathname}`;

    switch (route) {
      case "GET /v1/health":
        return json(200, {
          ok: true,
          v: PROTOCOL_VERSION,
          seq: service.state.seq,
          hash: service.hash(),
          online: service.onlineCount(),
        });
      case "GET /v1/world":
        return json(200, service.snapshot());
      case "GET /v1/skill":
        return {
          status: 200,
          headers: { "content-type": "text/markdown; charset=utf-8" },
          body: this.skill,
        };
      case "GET /v1/openapi.json":
        return { status: 200, headers: { "content-type": "application/json" }, body: this.openapi };

      case "POST /v1/session": {
        if (!this.sessionLimits.take(req.ip)) {
          return error("rate_limited", "Too many new sessions. Try again in a minute.");
        }
        const parsed = CreateSessionRequest.safeParse(await req.readJson());
        if (!parsed.success) return error("bad_request", parsed.error.message);
        const result = service.createSession(parsed.data);
        if (!result.ok) return error("bad_request", result.error.message, result.error.code);
        return json(201, {
          residentId: result.residentId,
          token: result.token,
          world: service.snapshot(),
        });
      }

      case "DELETE /v1/session": {
        const residentId = this.authenticate(req.authorization);
        if (!residentId) return error("unauthorized", "Missing or unknown bearer token.");
        service.leave(residentId);
        return { status: 204, headers: {}, body: "" };
      }

      case "POST /v1/actions": {
        const residentId = this.authenticate(req.authorization);
        if (!residentId) return error("unauthorized", "Missing or unknown bearer token.");
        if (!this.actionLimits.take(residentId)) return error("rate_limited", "Slow down.");
        const parsed = Action.safeParse(await req.readJson());
        if (!parsed.success) return error("bad_request", parsed.error.message);
        service.ensureOnline(residentId);
        return json(200, service.act(residentId, parsed.data));
      }
    }

    if (this.social && req.pathname.startsWith("/v1/")) {
      const response = await this.handleSocial(this.social, req);
      if (response) return response;
    }

    if (req.method === "GET" && !req.pathname.startsWith("/v1/")) return undefined;
    return error("not_found", `No route for ${route}.`);
  }

  /** RFC 0003 routes. Returns undefined when nothing matches. */
  private async handleSocial(
    social: SocialService,
    req: ApiRequest,
  ): Promise<ApiResponse | undefined> {
    const viewer = this.authenticate(req.authorization);
    const [, , resource, id, sub, extra] = req.pathname.split("/");
    if (extra !== undefined) return undefined;
    const route = `${req.method} ${resource}${id === undefined ? "" : "/:id"}${sub === undefined ? "" : `/${sub}`}`;
    const needViewer = () => error("unauthorized", "Missing or unknown bearer token.");

    switch (route) {
      case "GET feed": {
        if (req.query.get("following") === "1" && !viewer) return needViewer();
        return json(
          200,
          social.feed({
            ...(viewer ? { viewerId: viewer } : {}),
            limit: Number(req.query.get("limit") ?? 20),
            ...(req.query.has("before") ? { before: req.query.get("before") ?? "" } : {}),
            following: req.query.get("following") === "1",
          }),
        );
      }

      case "POST posts": {
        if (!viewer) return needViewer();
        if (!this.postLimits.take(viewer)) return error("rate_limited", "Slow down a little.");
        const parsed = CreatePostRequest.safeParse(await req.readJson());
        if (!parsed.success) return error("bad_request", parsed.error.message);
        return result(social.createPost(viewer, parsed.data), (post) => json(201, { post }));
      }

      case "GET posts/:id": {
        const post = id ? social.post(id, viewer) : undefined;
        if (!post || !id) return error("not_found", "No such post.");
        return json(200, { post, replies: social.replies(id, viewer) });
      }

      case "DELETE posts/:id":
        if (!viewer) return needViewer();
        return result(social.deletePost(viewer, id ?? ""), () => ({
          status: 204,
          headers: {},
          body: "",
        }));

      case "PUT posts/:id/like":
      case "DELETE posts/:id/like":
        if (!viewer) return needViewer();
        if (!this.reactLimits.take(viewer)) return error("rate_limited", "Slow down a little.");
        return result(social.setLike(viewer, id ?? "", req.method === "PUT"), (post) =>
          json(200, { post }),
        );

      case "GET residents/:id": {
        const resident = id ? social.profile(id, viewer) : undefined;
        if (!resident) return error("not_found", "No such resident.");
        return json(200, { resident });
      }

      case "GET residents/:id/posts": {
        if (!id || !social.profile(id)) return error("not_found", "No such resident.");
        return json(
          200,
          social.feed({
            ...(viewer ? { viewerId: viewer } : {}),
            author: id,
            limit: Number(req.query.get("limit") ?? 20),
            ...(req.query.has("before") ? { before: req.query.get("before") ?? "" } : {}),
          }),
        );
      }

      case "PUT residents/:id/follow":
      case "DELETE residents/:id/follow":
        if (!viewer) return needViewer();
        if (!this.reactLimits.take(viewer)) return error("rate_limited", "Slow down a little.");
        return result(social.setFollow(viewer, id ?? "", req.method === "PUT"), (resident) =>
          json(200, { resident }),
        );

      case "PUT profile": {
        if (!viewer) return needViewer();
        if (!this.reactLimits.take(viewer)) return error("rate_limited", "Slow down a little.");
        const parsed = UpdateProfileRequest.safeParse(await req.readJson());
        if (!parsed.success) return error("bad_request", parsed.error.message);
        return result(social.updateProfile(viewer, parsed.data), (resident) =>
          json(200, { resident }),
        );
      }

      case "POST media": {
        if (!viewer) return needViewer();
        if (!this.uploadLimits.take(viewer)) return error("rate_limited", "Slow down a little.");
        const bytes = await req.readBytes(MAX_UPLOAD_BYTES);
        if (!bytes)
          return error("bad_request", "That file is too big. The largest allowed is 25 MB.");
        return result(await social.upload(viewer, bytes), (media) => json(201, { media }));
      }
    }
    return undefined;
  }

  /** Start the `/v1/live` protocol for one socket. The adapter feeds it text and tells it when the socket closes. */
  live(ip: string, socket: LiveSocket): LiveSession {
    return new LiveSession(this, ip, socket);
  }

  /** Housekeeping: mark idle residents offline and forget full rate-limit buckets. Call about once a minute. */
  sweep() {
    this.service.sweepIdle();
    for (const limits of [
      this.actionLimits,
      this.sessionLimits,
      this.postLimits,
      this.reactLimits,
      this.uploadLimits,
    ]) {
      limits.prune();
    }
  }

  authenticate(authorization: string | undefined): string | undefined {
    const match = /^Bearer (.+)$/.exec(authorization ?? "");
    return match?.[1] ? this.service.authenticate(match[1]) : undefined;
  }

  /** @internal Used by LiveSession. */
  takeSession(ip: string) {
    return this.sessionLimits.take(ip);
  }

  /** @internal Used by LiveSession. */
  takeAction(residentId: string) {
    return this.actionLimits.take(residentId);
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

function result<T>(outcome: SocialResult<T>, ok: (value: T) => ApiResponse): ApiResponse {
  return outcome.ok ? ok(outcome.value) : error(outcome.code, outcome.message);
}

function error(code: ErrorCode, message: string, bodyCode: ErrorCode = code): ApiResponse {
  return json(STATUS[code] ?? 400, { error: { code: bodyCode, message } });
}
