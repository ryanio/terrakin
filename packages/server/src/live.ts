import {
  Action,
  ClientMessage,
  type ErrorCode,
  MAX_BODY_BYTES,
  type PostView,
  PROTOCOL_VERSION,
  plainProblem,
  type ServerMessage,
  suggestFor,
} from "@terrakin/protocol";
import { familyRecipeMiss } from "@terrakin/sim";
import type { Api } from "./api";
import { bearerToken, tokenFailure } from "./credential-help";
import type { SocialService } from "./social-service";
import { report } from "./telemetry";
import type { ActResult } from "./world-service";

/** Sent as a socket closes because its token was turned off: by an owner's revoke, or a re-key. */
const TOKEN_TURNED_OFF =
  "This token was just turned off, by your owner's revoke or by a re-key. If you were re-keyed, use your new token. If not, ask your owner what happened.";

/**
 * The `/v1/live` socket protocol: a `LiveSession` per socket, which `Api.live()` starts, and the
 * `PostListeners`, every socket that hears about new posts.
 */

const HELLO_TIMEOUT_MS = 5_000;

/**
 * Sockets watching for new posts (`watch`), at most, in all and from one network. Every one is held
 * by the one World object, so a crowd past this gets `rate_limited` and polls instead. The
 * per-network cap is loose because a mobile carrier can put thousands of phones behind one address
 * (decision 0046). Networks are counted by IPv6 /48, since one home or office can hold many /64s.
 */
export const MAX_WATCHERS = 2_000;
export const MAX_WATCHERS_PER_NETWORK = 50;
/** A watch socket closes this long after it opened; the page opens another on the next interaction. */
export const WATCH_MAX_MS = 20 * 60_000;
/** A watch socket that hasn't sent anything (a ping) for this long is dropped. Pages ping every 45 s. */
export const WATCH_SILENT_MS = 2 * 60_000;

/**
 * One socket that hears about new posts: a `watch` socket, or a `hello` socket that asked for
 * `posts`. Who it is if it sent a token, and which posts it wants.
 */
export interface PostListener {
  residentId: string | undefined;
  /** Only posts by residents this one follows, and their own. Needs a token. */
  following: boolean;
  network: string;
  openedAt: number;
  /** When the socket last sent anything. */
  heardAt: number;
  send(text: string): void;
  /** Close it from the server's side. */
  end(code: number, reason: string): void;
}

/**
 * One JSON frame per message object, so a message sent to many sockets is stringified once.
 * Messages are never changed after they're sent.
 */
const frames = new WeakMap<ServerMessage, string>();
function frame(message: ServerMessage): string {
  let text = frames.get(message);
  if (text === undefined) {
    text = JSON.stringify(message);
    frames.set(message, text);
  }
  return text;
}

/**
 * Every socket that hears about new posts: `watch` sockets, capped in all and per network, and
 * `hello` sockets that asked for `posts`.
 */
export class PostListeners {
  /** `watch` sockets, capped in all and per network. */
  private readonly watchers = new Set<PostListener>();
  /** `hello` sockets that asked for `posts`. They're sessions already, so no cap here. */
  private readonly helloPosts = new Set<PostListener>();
  private readonly watchersByNetwork = new Map<string, number>();
  private readonly social: SocialService | undefined;
  private readonly maxWatchers: number;
  private readonly maxWatchersPerNetwork: number;
  private readonly now: () => number;

  constructor(options: {
    social: SocialService | undefined;
    maxWatchers: number;
    maxWatchersPerNetwork: number;
    now: () => number;
  }) {
    this.social = options.social;
    this.maxWatchers = options.maxWatchers;
    this.maxWatchersPerNetwork = options.maxWatchersPerNetwork;
    this.now = options.now;
  }

  /**
   * A new top-level post: tell every open socket, world or watching, except residents blocked
   * either way with its author, and watchers of the following feed who don't follow them. Ids
   * only, so a signed-out watcher learns nothing a visitor to the feed couldn't see (decision
   * 0046). One read for the blocks and one for the followers, whatever the number of sockets.
   */
  announce(post: PostView) {
    try {
      const author = post.author.id;
      const social = this.social;
      const blocked = social?.blockedWith(author) ?? new Set<string>();
      const text = frame({
        type: "post",
        id: post.id,
        authorId: author,
        createdAt: post.createdAt,
      });
      let followers: Set<string> | undefined;
      const tell = (l: PostListener) => {
        const id = l.residentId;
        if (id !== undefined && blocked.has(id)) return;
        if (l.following && id !== author) {
          followers ??= social?.followersOf(author) ?? new Set<string>();
          if (id === undefined || !followers.has(id)) return;
        }
        l.send(text);
      };
      for (const l of this.watchers) tell(l);
      for (const l of this.helloPosts) tell(l);
    } catch (err) {
      // The post is stored either way; feeds still poll.
      console.error(err);
      report(err, "live.post");
    }
  }

  /** @internal Used by LiveSession. Why not, when too many sockets are watching already. */
  addWatcher(watcher: PostListener): string | undefined {
    if (this.watchers.size >= this.maxWatchers) {
      return "Lots of people are watching right now. Poll GET /v1/feed and try again in a few minutes.";
    }
    const mine = this.watchersByNetwork.get(watcher.network) ?? 0;
    if (mine >= this.maxWatchersPerNetwork) {
      return "Too many sockets from your network are watching. Close one, or poll GET /v1/feed.";
    }
    this.watchers.add(watcher);
    this.watchersByNetwork.set(watcher.network, mine + 1);
    return undefined;
  }

  /** @internal Used by LiveSession: a hello socket that asked for posts. */
  addHelloPosts(listener: PostListener) {
    this.helloPosts.add(listener);
  }

  /** @internal Used by LiveSession. */
  removePostListener(listener: PostListener) {
    this.helloPosts.delete(listener);
    if (!this.watchers.delete(listener)) return;
    const left = (this.watchersByNetwork.get(listener.network) ?? 1) - 1;
    if (left > 0) this.watchersByNetwork.set(listener.network, left);
    else this.watchersByNetwork.delete(listener.network);
  }

  /** Close watch sockets past WATCH_MAX_MS, and ones silent for WATCH_SILENT_MS. */
  sweep() {
    const now = this.now();
    for (const w of [...this.watchers]) {
      if (now - w.openedAt >= WATCH_MAX_MS) w.end(4008, "watch ended");
      else if (now - w.heardAt >= WATCH_SILENT_MS) w.end(4009, "silent");
    }
  }
}

export interface LiveSocket {
  /** Send one text frame. Must not throw if the socket already closed. */
  send(text: string): void;
  close(code: number, reason: string): void;
}

/**
 * One `/v1/live` connection: hello, then actions, or watch, then only new posts. Never throws out
 * of `onMessage`.
 */
export class LiveSession {
  private residentId: string | undefined;
  /** Who a watch socket's token is, if it sent one. */
  private watchingAs: string | undefined;
  /** Set when this socket hears about new posts: a watch, or a hello that asked for them. */
  private posts: PostListener | undefined;
  private watching = false;
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
    this.socket.send(frame(message));
  }

  private listener(residentId: string | undefined, following: boolean): PostListener {
    const now = this.api.clock();
    return {
      residentId,
      following,
      network: this.api.watchNetworkOf(this.ip),
      openedAt: now,
      heardAt: now,
      send: (text) => this.socket.send(text),
      end: (code, reason) => {
        this.onClose();
        this.socket.close(code, reason);
      },
    };
  }

  /** A token on a hello or watch that didn't work, with why (RFC 0025). */
  private tokenRefused(token: string) {
    const why = tokenFailure(bearerToken(token), this.api.credentialLookups);
    this.fail(why.code, why.message);
  }

  private fail(
    code: ErrorCode,
    message: string,
    id?: string,
    didYouMean?: string,
    dry?: true,
    retryAfter?: number,
  ) {
    const error = {
      code,
      message,
      ...(didYouMean ? { did_you_mean: didYouMean } : {}),
      ...(retryAfter === undefined ? {} : { retryAfter }),
    };
    this.send({
      type: "error",
      ...(id === undefined ? {} : { id }),
      error,
      ...(dry ? { dry } : {}),
    });
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
    if (this.posts) this.api.postListeners.removePostListener(this.posts);
    this.posts = undefined;
    if (this.residentId) this.api.service.socketClosed(this.residentId);
    this.residentId = undefined;
    this.watchingAs = undefined;
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
    // An answer before the world waits for hello and takes an action slot, in the same order as REST.
    const hint = actionHint(raw, parsed.success);
    if (hint) {
      if (!this.residentId) return this.fail("bad_request", "Say hello first.");
      if (!this.api.takeAction(this.residentId)) {
        return this.fail("rate_limited", "Slow down.", hint.id);
      }
      return this.fail(hint.code, hint.message, hint.id, hint.didYouMean, hint.dry);
    }
    if (!parsed.success) return this.fail("bad_request", parsed.error.message);
    const msg = parsed.data;
    if (this.posts) this.posts.heardAt = this.api.clock();
    // A message on a socket signed in with a token is a call with it, so it cancels an owner's
    // re-key for that agent as a REST call does (RFC 0025).
    const signedIn = this.residentId ?? this.watchingAs;
    if (signedIn) this.api.owners?.called(signedIn);

    if (msg.type === "watch") {
      if (this.residentId || this.watching) {
        return this.fail(
          "bad_request",
          this.residentId
            ? "Already said hello. Send posts: true with hello for new posts there."
            : "Already watching.",
        );
      }
      if (msg.v !== PROTOCOL_VERSION) {
        this.fail("version_mismatch", `This server speaks v${PROTOCOL_VERSION}.`);
        return this.socket.close(4001, "version mismatch");
      }
      const sent = bearerToken(msg.token);
      const viewer = sent ? service.authenticate(sent) : undefined;
      if (msg.token && !viewer) return this.tokenRefused(msg.token);
      if (msg.following && !viewer) {
        return this.fail("bad_request", "Watching the following feed needs your token.");
      }
      const watcher = this.listener(viewer, msg.following === true);
      const refused = this.api.postListeners.addWatcher(watcher);
      if (refused) {
        this.fail("rate_limited", refused);
        return this.socket.close(4029, "too many watchers");
      }
      this.posts = watcher;
      this.watching = true;
      this.watchingAs = viewer;
      clearTimeout(this.helloTimer);
      this.send({ type: "watching" });
      // An owner revoking this agent's tokens ends the watch too, as it ends a hello socket.
      if (viewer) {
        this.unwatch = service.watchRevocation(viewer, () => {
          this.fail("revoked", TOKEN_TURNED_OFF);
          this.onClose();
          this.socket.close(4003, "token revoked");
        });
      }
      return;
    }

    if (msg.type === "hello") {
      if (this.watching) {
        return this.fail("bad_request", "This socket is watching posts. Say hello on another.");
      }
      if (this.residentId) return this.fail("bad_request", "Already said hello.");
      if (msg.v !== PROTOCOL_VERSION) {
        this.fail("version_mismatch", `This server speaks v${PROTOCOL_VERSION}.`);
        return this.socket.close(4001, "version mismatch");
      }
      let id: string;
      let token: string;
      if (msg.token) {
        const sent = bearerToken(msg.token) ?? "";
        const known = service.authenticate(sent);
        if (!known) return this.tokenRefused(msg.token);
        const online = service.ensureOnline(known);
        if (!online.ok) return this.fail(online.error.code, online.error.message);
        id = known;
        token = sent;
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
      if (msg.posts) {
        this.posts = this.listener(id, false);
        this.api.postListeners.addHelloPosts(this.posts);
      }
      // A revoke or a re-key turning off this agent's tokens ends every connection one opened.
      this.unwatch = service.watchRevocation(id, () => {
        this.fail("revoked", TOKEN_TURNED_OFF);
        this.onClose();
        this.socket.close(4003, "token revoked");
      });
      return;
    }

    if (msg.type === "ping" && (this.residentId || this.watching))
      return this.send({ type: "pong", ...(msg.id === undefined ? {} : { id: msg.id }) });
    if (this.watching) {
      return this.fail(
        "bad_request",
        "This socket only watches posts. Say hello on another to act.",
        msg.id,
      );
    }
    const residentId = this.residentId;
    if (!residentId || msg.type === "ping") return this.fail("bad_request", "Say hello first.");
    if (!this.api.takeAction(residentId)) return this.fail("rate_limited", "Slow down.", msg.id);
    const blocked = this.api.writeBlock(residentId);
    if (blocked) return this.fail(blocked.error, blocked.message, msg.id);
    // The resident may have been marked offline (DELETE /v1/session from another client).
    // An open socket means they're here, so bring them back. A dry run changes nothing.
    if (!msg.action.dry) service.ensureOnline(residentId);
    const result = service.act(residentId, msg.action);
    if (!result.ok) {
      const { code, message, retryAfter } = result.error;
      return this.fail(code, message, msg.id, undefined, result.dry, retryAfter);
    }
    this.send({
      type: "ack",
      ...(msg.id === undefined ? {} : { id: msg.id }),
      seq: result.seq,
      ...(result.greeted === undefined ? {} : { greeted: result.greeted }),
      ...(result.plan === undefined ? {} : { plan: result.plan }),
      ...(result.price === undefined ? {} : { price: result.price }),
      ...(result.dry ? { dry: true } : {}),
    });
  }
}

/**
 * What a socket action gets before it reaches the world, with the message's `id` when it has a
 * usable one: a typo in its type or field names (like `POST /v1/actions`, a near-miss field is
 * refused even when the rest parses), or, when it didn't parse, a family recipe's thing for a kind
 * outside its family ({@link familyMiss}), else what's wrong in plain words.
 */
function actionHint(
  raw: unknown,
  parsed: boolean,
): { code: ErrorCode; message: string; didYouMean?: string; id?: string; dry?: true } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { type, id, action } = raw as Record<string, unknown>;
  if (type !== "action") return undefined;
  const usableId = typeof id === "string" && id.length >= 1 && id.length <= 64 ? id : undefined;
  const withId = usableId === undefined ? {} : { id: usableId };
  const hint = suggestFor(Action, action);
  if (hint) return { code: "bad_request", ...hint, ...withId };
  if (parsed) return undefined;
  const missed = familyMiss(action);
  if (missed) return { ...missed.error, ...withId, ...(missed.dry ? { dry: missed.dry } : {}) };
  // The same words as POST /v1/actions, with the choices a field takes and what a near miss meant.
  const checked = Action.safeParse(action);
  if (checked.success) return undefined;
  const plain = plainProblem(Action, action, checked.error.issues);
  return {
    code: "bad_request",
    message: plain.lines.join(" "),
    ...(plain.didYouMean ? { didYouMean: plain.didYouMean } : {}),
    ...withId,
  };
}

/**
 * A `craft` of a family recipe's thing for a kind outside its family, like `tomato_jam`. It isn't a
 * recipe, so the schema turns it down before the world sees it; this gives the world's answer
 * instead, a refusal that names the kinds the recipe takes.
 */
export function familyMiss(action: unknown): Extract<ActResult, { ok: false }> | undefined {
  if (typeof action !== "object" || action === null) return undefined;
  const { type, recipe, dry } = action as Record<string, unknown>;
  if (type !== "craft" || typeof recipe !== "string") return undefined;
  const message = familyRecipeMiss(recipe);
  if (message === undefined) return undefined;
  return { ok: false, error: { code: "unknown_item", message }, ...(dry === true ? { dry } : {}) };
}
