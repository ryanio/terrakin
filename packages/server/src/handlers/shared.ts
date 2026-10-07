/**
 * What the dispatcher in `api.ts` and the handler files share: the handler types, derived from
 * the route table, and the helpers that turn results into replies.
 */

import type {
  BinaryBody,
  ErrorCode,
  GestureItem,
  ModerationLogEntry,
  RateLimitName,
  RouteBody,
  RouteId,
  RouteParams,
  RouteQuery,
  RouteSuccess,
  RouteViewer,
  WorldEvent as WorldEventView,
} from "@terrakin/protocol";
import { sha256Hex } from "../idempotency";
import type { SocialResult } from "../social-service";
import { staffOwner } from "../staff-keys";

/**
 * The key for per-IP limits. IPv6 clients usually control a whole /64, so they share one key;
 * otherwise one person could rotate addresses forever.
 */
export function ipKey(ip: string, groups = 4): string {
  if (!ip.includes(":") || ip.startsWith("::ffff:")) return ip.replace(/^::ffff:/, "");
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const parts = ip.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return `${parts
    .slice(0, groups)
    .map((g) => g.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":")}::/${groups * 16}`;
}

/** Uploads the one world object will buffer at once. Each can be up to 25 MB. */
export const MAX_UPLOADS_IN_FLIGHT = 2;

/** Letter pictures (up to 5 MB each) the world object will hold in memory at once. */
export const MAX_LETTER_READS_IN_FLIGHT = 4;

/** What each rate limit says when it refuses. */
export const RATE_LIMITED: Record<RateLimitName, string> = {
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
  photos: "That's a lot of photos. Wait a minute, then take another.",
  photosIp: "Lots of photos from here. Wait a minute, then try again.",
  agentLink: "That's a lot of agent checks. Wait a minute, then ask again.",
  agentLinkIp: "Lots of agent checks from here. Wait a minute, then try again.",
};

// ---------- handler types, all derived from the route table ----------

/** A raw upload: its declared length (already checked against the route's cap) and a capped reader. */
export interface Upload {
  readonly length: number;
  /** The bytes, or undefined if the client sent more than it declared. */
  read(): Promise<Uint8Array | undefined>;
}

interface HandlerInput<K extends RouteId> {
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

export type Reply<K extends RouteId> = RouteSuccess<K> | Failure;
/** Any success reply, as the renderer sees it. */
export interface HandlerReply {
  status: number;
  body?: unknown;
  text?: string;
  bytes?: Uint8Array;
  contentType?: string;
}

export const STAFF_ONLY = "Only Terrakin's maintainers and moderators can do that.";
export const MAINTAINERS_ONLY = "Only Terrakin's maintainers can move town coins.";
export const WORLD_MAINTAINERS_ONLY = "Only Terrakin's maintainers can do that.";

/**
 * Who a staff member is in the world log, which is kept for good: their resident id when they
 * signed in with a resident token, else an opaque id from a hash of their Access sign-in, so no
 * staff email is ever logged in the world (decision 0062). The moderation log names them as
 * before.
 */
export async function worldStaffId(keyed: string): Promise<string> {
  // A staff key acts as its maker, so the world names them, never the key.
  const actor = staffOwner(keyed);
  if (!actor.startsWith("access:")) return actor;
  return `staff_${(await sha256Hex(actor)).slice(0, 16)}`;
}

/** A maintainer action's log line as the reply. */
export function logged(outcome: SocialResult<ModerationLogEntry>) {
  return fromResult(outcome, (entry) => ({ status: 200 as const, body: { logged: entry } }));
}

/** A plot nobody lives on, and one left out for you, answer the same. */
export const NO_PLOT_TO_VISIT = "There's no plot to visit there.";

/** Unknown, used, and expired invites all answer the same. */
export const INVITE_GONE = "This invite has expired or was already used. Ask for a fresh link.";
type Handler<K extends RouteId> = (input: HandlerInput<K>) => Reply<K> | Promise<Reply<K>>;
/** One handler per route id, no more and no fewer. */
export type Handlers = { [K in RouteId]: Handler<K> };

/** What the dispatcher sees once types have done their job. */
export type AnyHandler = (input: {
  params: unknown;
  query: unknown;
  body: unknown;
  viewer: string | undefined;
  ip: string;
  origin: string;
}) => Promise<HandlerReply | Failure>;

export const fail = (error: ErrorCode, message: string, retryAfter?: number): Failure => ({
  error,
  message,
  ...(retryAfter === undefined ? {} : { retryAfter }),
});
export const unauthorized = () => fail("unauthorized", "Missing or unknown bearer token.");

/** What a `give` moved: the gift gesture's record of it, from the giver's own events. */
export function givenItem(
  events: readonly WorldEventView[],
  giver: string,
): GestureItem | undefined {
  let kind: GestureItem["kind"] | undefined;
  let count = 0;
  let gift: string | undefined;
  for (const e of events) {
    if (e.type === "item_given" && e.from === giver) kind = e.kind;
    if (e.type === "inventory" && e.residentId === giver && e.reason === "gift_out") {
      count = e.lost?.length ?? -(e.changes?.[0]?.amount ?? 0);
      gift = e.gift;
    }
  }
  if (!kind || count < 1) return undefined;
  return { kind, count, ...(gift === undefined ? {} : { gift }) };
}

/**
 * The social layer's own refusals are its rolling 24-hour caps, which free up as old posts and
 * uploads age out, so an hour is an honest first wait.
 */
export const DAILY_CAP_RETRY_SECONDS = 3600;

export function fromResult<T, R>(outcome: SocialResult<T>, ok: (value: T) => R): R | Failure {
  if (outcome.ok) return ok(outcome.value);
  return fail(
    outcome.code,
    outcome.message,
    outcome.code === "rate_limited" ? (outcome.retryAfter ?? DAILY_CAP_RETRY_SECONDS) : undefined,
  );
}
