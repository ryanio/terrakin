import {
  type AcceptInviteRequest,
  Action,
  absolute,
  acceptsIdempotencyKey,
  type BinaryBody,
  CATALOG_VIEW,
  CHANGELOG_ENTRIES,
  ClientMessage,
  changelogResponse,
  compileRoutes,
  DEVLOG_POSTS,
  devlogResponse,
  type ErrorCode,
  type EventResponse,
  errorStatus,
  type GestureItem,
  INVITE_PLOT_SUGGESTIONS,
  type Issue,
  isBinaryBody,
  isWriteRoute,
  LINKS,
  linkHeader,
  MAX_BODY_BYTES,
  MODERATOR_SUSPEND_MAX_DAYS,
  type ModerationLogEntry,
  markdownError,
  markdownErrorCode,
  type PostView,
  PROTOCOL_VERSION,
  type ProfileView,
  plainProblem,
  RATE_LIMITS,
  type RateLimitName,
  REPEAT_WINDOW_MS,
  ROUTES,
  ROUTINE_RULES,
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
  type SnapshotView,
  type StaffRole,
  sitemapIndexXml,
  suggestFor,
  urlsetXml,
  WORLD_LOG_PAGE_MAX,
  type WorldEvent as WorldEventView,
  type WorldLogResponse,
  w3cDatetime,
} from "@terrakin/protocol";
import {
  canBuildOn,
  eventOpen,
  familyRecipeMiss,
  findBounty,
  findEvent,
  findProposal,
  goodById,
  type HostedEvent,
  heldAsideOf,
  isTownEvent,
  LADDERS,
  listingById,
  plotPlan,
  REPLAY_VERSION,
  routinesOf,
  tableById,
} from "@terrakin/sim";
import { AiSpend, SUMMARY_DAYS } from "./ai-spend";
import { bountiesView, bountyView, staffBountiesView } from "./bounties";
import type { ChatterRun, ChatterService } from "./chatter";
import { checkinView } from "./checkin";
import { purseView } from "./coins";
import { countGuests, eventsView, eventView } from "./events";
import { galleriesView, madeThingForReport } from "./galleries";
import { gameRatings, gamesView, ladderView, tableView } from "./games";
import { IdempotencyStore, type StoredResponse, sha256Hex } from "./idempotency";
import { inventoryView } from "./items";
import { BAD_LINK_KEY, DEFAULT_ORIGIN, linkHandlers, linkHelp, REPEAT_NOTE } from "./links";
import { postMarkdown, profileMarkdown } from "./markdown";
import { type ListerFacts, listingForReport, listingRefusal, marketView } from "./market";
import { COOL_DOWN_MESSAGE, type Moderation } from "./moderation";
import { OwnerService } from "./owner-service";
import { partnerViews } from "./partners";
import { type PlotPhotoRenderer, plotPhotoSpec } from "./plot-photo";
import type { PlotViewer } from "./plots";
import { RateLimiters, type Take } from "./rate-limit";
import { Routines, type RoutinesRun, runRoutines } from "./routines";
import { SHOP_KEEPER_HANDLE, shopView } from "./shop";
import { reportable, type SnapshotHeader } from "./snapshots";
import type { SocialResult, SocialService } from "./social-service";
import { count, crumb, nameRequest, report, span, task } from "./telemetry";
import { anchorPlot, suggestPlots } from "./together";
import { archiveView, proposalDetail, townView } from "./town";
import type { TipsResult, TownsfolkTips } from "./townsfolk-tips";
import { type ActResult, DAY_MS, utcDay, type WorldService } from "./world-service";

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
interface PostListener {
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

/** Most `once` answers kept in memory: a short Markdown page each, keyed by a URL up to a few KB. */
const MAX_REPEATS = 2_000;

/** Uploads the one world object will buffer at once. Each can be up to 25 MB. */
const MAX_UPLOADS_IN_FLIGHT = 2;
/** Plot photos being drawn at once. Each waits on the renderer and then holds a PNG in memory. */
const MAX_PHOTOS_IN_FLIGHT = 2;
/**
 * Bytes a plot photo is assumed to take before it's drawn, for the cost guards that run first. A
 * drawn photo is about 100 to 300 KB; the exact size is checked again when it's stored.
 */
const PHOTO_RESERVE_BYTES = 1_000_000;
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
  photos: "That's a lot of photos. Wait a minute, then take another.",
  photosIp: "Lots of photos from here. Wait a minute, then try again.",
  agentLink: "That's a lot of agent checks. Wait a minute, then ask again.",
  agentLinkIp: "Lots of agent checks from here. Wait a minute, then try again.",
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
const MAINTAINERS_ONLY = "Only Terrakin's maintainers can move town coins.";
const WORLD_MAINTAINERS_ONLY = "Only Terrakin's maintainers can do that.";

/**
 * Who a staff member is in the world log, which is kept for good: their resident id when they
 * signed in with a resident token, else an opaque id from a hash of their Access sign-in, so no
 * staff email is ever logged in the world (decision 0062). The moderation log names them as
 * before.
 */
export async function worldStaffId(actor: string): Promise<string> {
  if (!actor.startsWith("access:")) return actor;
  return `staff_${(await sha256Hex(actor)).slice(0, 16)}`;
}

/** A maintainer action's log line as the reply. */
function logged(outcome: SocialResult<ModerationLogEntry>) {
  return fromResult(outcome, (entry) => ({ status: 200 as const, body: { logged: entry } }));
}

/** A plot nobody lives on, and one left out for you, answer the same. */
const NO_PLOT_TO_VISIT = "There's no plot to visit there.";

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

/** What a `give` moved: the gift gesture's record of it, from the giver's own events. */
function givenItem(events: readonly WorldEventView[], giver: string): GestureItem | undefined {
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
const secondsToTomorrow = (now: number) => Math.ceil((DAY_MS - (now % DAY_MS)) / 1000);

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
  private photosInFlight = 0;
  private readonly photos: PlotPhotoRenderer | undefined;
  private letterReadsInFlight = 0;
  /** `watch` sockets, capped in all and per network. */
  private readonly watchers = new Set<PostListener>();
  /** `hello` sockets that asked for `posts`. They're sessions already, so no cap here. */
  private readonly helloPosts = new Set<PostListener>();
  private readonly watchersByNetwork = new Map<string, number>();
  private readonly maxWatchers: number;
  private readonly maxWatchersPerNetwork: number;
  private readonly ipUploadBytesPerDay: number;
  private readonly match: (method: string, pathname: string) => RouteMatch<RouteSpec> | undefined;
  private readonly handlers: Handlers;
  private readonly onResponse: ApiOptions["onResponse"];
  private readonly now: () => number;
  /** Answers to `once` links, by route, resident, and query, for REPEAT_WINDOW_MS. */
  private readonly repeats = new Map<string, { at: number; response: Promise<ApiResponse> }>();
  private readonly idempotency = new IdempotencyStore();
  private readonly staffOptions: StaffOptions;
  private readonly chatter: ChatterService | undefined;
  private readonly tips: TownsfolkTips | undefined;
  /** Offline routines' runner (RFC 0009). Needs the social layer, where the away log lives. */
  readonly routines: Routines | undefined;
  /** The AI spend ledger, read for the staff overview. Triage and chatter write to it. */
  private readonly spendLedger: AiSpend | undefined;

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
      layer.onPost = (post) => this.announcePost(post);
      // Putter's wave (decision 0049) is an ordinary gesture, with a putter mark and its own limits.
      this.service.greet = (from, to) => {
        const sent = layer.together.sendGesture(from, to, { kind: "wave" }, { putter: true });
        if (!sent.ok) return false;
        this.service.notify(to, layer.together.liveGesture(sent.value.gesture, sent.value.streak));
        return true;
      };
      // Offline routines (RFC 0009): the sweep takes their steps, a resident here walking past an
      // away neighbor's hearth may get a wave, and every call keeps a resident's routines going.
      const routines = new Routines({ world: this.service, social: layer });
      this.routines = routines;
      this.service.onWalked = (id) => {
        routines.greetFor(id);
      };
      this.service.onCall = (id) => layer.away.called(id);
      // Who may list in the market (decision 0056): time in Terrakin and karma live out here.
      this.service.listingRefusal = (id) =>
        listingRefusal(this.service.state, id, this.listerFacts(id));
      this.service.suspended = (id) => layer.safety.suspendedUntil(id) !== undefined;
      this.service.onAdmired = (admirer, maker, day) =>
        layer.karma.recordAdmire(admirer, maker, day);
      // Pets (RFC 0019): a treat logged in the world tells its owner, and a pat (a social row)
      // makes the pet look happy on every screen that shows it.
      this.service.onPetTreated = (owner, by, kind) => layer.petTreated(owner, by, kind);
      layer.onPetPatted = (owner) => this.service.announce({ type: "pet_patted", owner });
      // Plots to visit (RFC 0020): when each plot last changed, and who visited it. The collection
      // book (RFC 0021): what each input brought anyone, filled in once from the world as it is.
      this.service.onCommitted = (input, events) => {
        try {
          layer.plots.noteCommitted(this.service.state, input, events);
        } finally {
          layer.collection.noteCommitted(this.service.state, input, events);
        }
      };
      try {
        layer.collection.backfill(this.service.state);
      } catch (err) {
        report(err, "world.collection_backfill");
      }
      // Reports on a listing (decision 0056) read it from the world.
      layer.safety.listing = (id) => listingForReport(this.service.state, id);
      // Reports on a thing on display, or a piece (decision 0059), read it from the world too.
      layer.safety.madeThing = (kind, id) => madeThingForReport(this.service.state, kind, id);
      // Purged uploads clear every piece made from them (decision 0065): the world logs it.
      layer.safety.removePiecePictures = (mediaId) => this.service.removePiecePictures(mediaId);
      // Appreciation coins (decision 0055): counted from reactions, logged once a day by `tick`.
      this.service.dailyAwards = (day) => layer.karma.awards(day);
      // Hosted events (RFC 0010): the town's events name townsfolk by handle, and each event that
      // ends leaves its host's record, with who counted decided out here (ages on the day it
      // ended, blocks).
      this.service.residentByHandle = (handle) => layer.residentIdByHandle(handle);
      const recordEnded = (event: HostedEvent, day: number) =>
        layer.events.recordEnded(
          event,
          day,
          countGuests(this.service.state, event, {
            ageDays: (id) => this.service.residentAgeDays(id, day),
            blockedEither: (a, b) => layer.blockedEither(a, b),
            hostsToday: (guest) => layer.events.hostsCounted(guest, day),
          }),
        );
      this.service.onEventEnded = recordEnded;
      // The boot's own catch-up can end events before this hook is set, and a crash can come
      // between the world's commit and the record: record each ended event that has none.
      for (const e of layer.events.unrecorded(this.service.state)) {
        try {
          recordEnded(e, e.closedDay ?? 0);
        } catch (err) {
          report(err, "world.event_ended");
        }
      }
      // Party-game ladders (RFC 0011) live in the world; profiles show them.
      layer.gameRatings = (id) => gameRatings(this.service.state, id);
      this.service.syncOwnerPairs(layer.ownerPairs());
      // Partner wear (RFC 0007 phase 3): logged as each link changes, and caught up on a timer so
      // promos start and end on the server's clock. At boot, everything at once.
      layer.onPartnerPerks = (id) =>
        this.service.syncEntitlements(id, layer.agentLinks.entitled(id));
      this.service.entitlements = () => layer.agentLinks.allEntitled();
      this.service.reconcileEntitlements(true);
    }
    this.ipUploadBytesPerDay = options.ipUploadBytesPerDay ?? 500_000_000;
    this.photos = options.photos;
    this.chatter = options.chatter;
    this.tips = options.tips;
    this.spendLedger = options.social
      ? new AiSpend(options.social.sql, options.social.now)
      : undefined;
    this.maxWatchers = options.maxWatchers ?? MAX_WATCHERS;
    this.maxWatchersPerNetwork = options.maxWatchersPerNetwork ?? MAX_WATCHERS_PER_NETWORK;
    this.onResponse = options.onResponse;
    this.now = options.now ?? Date.now;
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

  /** The per-IP daily upload bytes, refused when `bytes` more would go over. */
  private ipUploadRefusal(key: string, bytes: number): Failure | undefined {
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
  private countIpUpload(key: string, day: number, bytes: number) {
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
  private async takePlotPhoto(viewer: string, ip: string): Promise<Reply<"takePlotPhoto">> {
    const social = this.requireSocial();
    if (!this.photos) return fail("unavailable", "Photos aren't available on this server.");
    const key = ipKey(ip);
    if (!this.limiters.photosIp.take(key)) return fail("rate_limited", RATE_LIMITED.photosIp);
    const spec = plotPhotoSpec(this.service.state, viewer);
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
      getHealth: () => {
        const snapshot = service.snapshotInfo();
        return {
          status: 200,
          body: {
            ok: true,
            v: PROTOCOL_VERSION,
            seq: service.state.seq,
            hash: service.hash(),
            online: service.onlineCount(),
            ...(snapshot ? { snapshot } : {}),
          },
        };
      },
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
        // A dry run never brings anyone online: `act` checks it as if they were.
        if (!body.dry) service.arrive(viewer, body.type);
        return { status: 200, body: service.act(viewer, body) };
      },
      getPlotPlan: ({ params }) => {
        const plan = plotPlan(service.state, params.px, params.py);
        if (!plan) return fail("not_found", "There's no plot there: it's outside the world.");
        return { status: 200, body: { plan } };
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
        const post = social().post(params.id, viewer, true);
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
        void social().agentLinks.refreshIfStale(resident.id);
        return { status: 200, body: { resident } };
      },
      getResidentFollowing: ({ params }) =>
        fromResult(social().following(params.id), (residents) => ({
          status: 200 as const,
          body: { residents },
        })),
      getResidentFollowers: ({ params }) =>
        fromResult(social().followers(params.id), (residents) => ({
          status: 200 as const,
          body: { residents },
        })),
      getResidentFriends: ({ params }) =>
        fromResult(social().friends(params.id), (residents) => ({
          status: 200 as const,
          body: { residents },
        })),
      getPurse: ({ viewer }) => ({
        status: 200,
        body: purseView(service.state, viewer, (id) => this.social?.authorView(id)),
      }),
      getInventory: ({ viewer }) => ({
        status: 200,
        body: inventoryView(service.state, viewer, (id) => this.social?.authorView(id)),
      }),
      getCatalog: () => ({ status: 200, body: CATALOG_VIEW }),
      getCollection: ({ viewer }) => ({
        status: 200,
        body: { collection: social().collection.view(viewer) },
      }),
      getResidentCollection: ({ params }) => {
        if (!social().authorView(params.id)) return fail("not_found", "No such resident.");
        return { status: 200, body: { collection: social().collection.view(params.id) } };
      },
      getShop: ({ viewer }) => ({
        status: 200,
        body: shopView(
          service.state,
          viewer,
          social().residentIdByHandle(SHOP_KEEPER_HANDLE),
          (id) => social().authorView(id),
        ),
      }),
      getMarket: ({ viewer, query }) => {
        const layer = social();
        // Read once per request: who the viewer blocks either way, and each seller's suspension.
        const blocked = viewer === undefined ? new Set<string>() : layer.blockedWith(viewer);
        const closed = new Map<string, boolean>();
        const hidden = (seller: string) => {
          if (blocked.has(seller)) return true;
          let shut = closed.get(seller);
          if (shut === undefined) {
            shut = layer.safety.suspendedUntil(seller) !== undefined;
            closed.set(seller, shut);
          }
          return shut;
        };
        const view = marketView(
          service.state,
          viewer,
          query,
          (id) => layer.authorView(id),
          hidden,
          (id) => this.listerFacts(id),
        );
        if ("error" in view) return fail("bad_request", view.error);
        return { status: 200, body: view };
      },
      getBounties: ({ viewer }) => {
        const layer = social();
        // Read once per request: who the viewer blocks either way, and each poster's suspension.
        const blocked = viewer === undefined ? new Set<string>() : layer.blockedWith(viewer);
        const closed = new Map<string, boolean>();
        const hidden = (poster: string) => {
          if (blocked.has(poster)) return true;
          let shut = closed.get(poster);
          if (shut === undefined) {
            shut = layer.safety.suspendedUntil(poster) !== undefined;
            closed.set(poster, shut);
          }
          return shut;
        };
        return {
          status: 200,
          body: bountiesView(service.state, viewer, (id) => layer.authorView(id), hidden),
        };
      },
      getGames: ({ viewer }) => ({
        status: 200,
        body: gamesView(service.state, viewer, (id) => this.social?.authorView(id), service.now()),
      }),
      getGameLadder: ({ viewer, query }) => ({
        status: 200,
        body: ladderView(service.state, query.ladder ?? LADDERS[0], viewer, (id) =>
          this.social?.authorView(id),
        ),
      }),
      getGame: ({ viewer, params }) => {
        const t = tableById(service.state, params.table);
        if (!t) return fail("not_found", "No table has that id. GET /v1/games lists them.");
        return {
          status: 200,
          body: {
            table: tableView(service.state, t, (id) => this.social?.authorView(id), viewer, {
              now: service.now(),
              history: true,
            }),
            now: new Date(service.now()).toISOString(),
          },
        };
      },
      getGalleries: ({ query }) => {
        const layer = this.social;
        return {
          status: 200,
          body: galleriesView(service.state, (id) => layer?.authorView(id), {
            resident: query.resident,
            // A suspended resident's gallery is closed for now, like their market stall.
            hidden: (id) => layer?.safety.suspendedUntil(id) !== undefined,
          }),
        };
      },
      getPlots: ({ viewer, query }) => {
        const layer = social();
        const author = (id: string) => layer.authorView(id);
        const sort = query.sort ?? "recent";
        const plots = layer.plots.list(service.state, author, sort, this.plotViewer(viewer));
        return { status: 200, body: { plots: plots.slice(0, query.limit) } };
      },
      getPlot: ({ viewer, params }) => {
        const plot = this.plotFor(viewer, params);
        return plot ? { status: 200, body: { plot } } : fail("not_found", NO_PLOT_TO_VISIT);
      },
      admirePlot: ({ viewer, params }) =>
        fromResult(social().plots.admire(service.state, viewer, params.px, params.py), () => {
          const plot = this.plotFor(viewer, params);
          return plot
            ? { status: 201 as const, body: { plot } }
            : fail("not_found", NO_PLOT_TO_VISIT);
        }),
      getCheckin: ({ viewer, query }) => {
        social().checkins.record(viewer);
        return {
          status: 200,
          body: checkinView(service.state, social(), viewer, {
            since: query.since,
            seen: query.seen,
            done: service.doneCommands(viewer),
            suggestions: social().checkins,
            devlogAt: (date) => social().checkins.published(date),
          }),
        };
      },
      getRoutines: ({ viewer, query }) => {
        const before = query.before === undefined ? undefined : Number(query.before.slice(2));
        // Without the social layer there's no away log, and nothing runs them.
        const body = this.routines?.view(viewer, before) ?? {
          routines: routinesOf(service.state, viewer).map((r) => ({ ...r })),
          paused: false,
          rules: { ...ROUTINE_RULES },
          away: { items: [], next: null },
        };
        return { status: 200, body };
      },
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
        const profile = social().profile(params.id, viewer);
        if (!profile) return fail("not_found", "No such resident.");
        // Whether you share a plot with them: the site offers a kiss to the people you live with.
        const shared =
          viewer !== undefined &&
          viewer !== params.id &&
          Object.values(service.state.plots).some(
            (p) => canBuildOn(p, viewer) && canBuildOn(p, params.id),
          );
        const resident = shared ? { ...profile, sharesPlot: true as const } : profile;
        // An hour-old agent link is checked again in the background; this answer doesn't wait.
        void social().agentLinks.refreshIfStale(params.id);
        return { status: 200, body: { resident } };
      },
      getMe: ({ viewer }) => {
        const resident = social().profile(viewer, viewer);
        if (!resident) return fail("unauthorized", "That token doesn't belong to anyone here.");
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
      praiseResident: ({ viewer, params }) =>
        fromResult(social().givePraise(viewer, params.id), (resident) => ({
          status: 201 as const,
          body: { resident },
        })),
      patResidentPet: ({ viewer, params }) =>
        fromResult(social().patPet(viewer, params.id), (resident) => ({
          status: 201 as const,
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
      linkAgent: async ({ viewer, body, ip }) => {
        // The route's own limit is per resident. Each attempt reads a network and fetches a card,
        // so one network address is limited too, like X checks.
        if (!this.limiters.agentLinkIp.take(ipKey(ip))) {
          return fail("rate_limited", RATE_LIMITED.agentLinkIp);
        }
        return fromResult(await social().agentLinks.link(viewer, body), (reply) => reply);
      },
      unlinkAgent: async ({ viewer }) => {
        await social().agentLinks.unlink(viewer);
        return { status: 204 };
      },
      getPartners: () => ({
        status: 200,
        body: { partners: partnerViews(social().agentLinks.partnerList, this.now()) },
      }),
      unlinkX: ({ viewer }) =>
        fromResult(social().unlinkX(viewer), (resident) => ({
          status: 200 as const,
          body: { resident },
        })),
      takePlotPhoto: ({ viewer, ip }) => this.takePlotPhoto(viewer, ip),
      uploadMedia: async ({ viewer, body, ip }) => {
        const key = ipKey(ip);
        const day = utcDay(this.now());
        const overIp = this.ipUploadRefusal(key, body.length);
        if (overIp) return overIp;
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
          if (outcome.ok) this.countIpUpload(key, day, bytes.length);
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
        let item: GestureItem | undefined;
        if (body.item !== undefined) {
          // A gift that carries a thing: the gesture's own checks first, then the thing moves in
          // the world like any `give` (its limits, blocks, and note filter), then the gesture.
          const checked = together.checkGesture(viewer, params.id, body);
          if (!checked.ok) return fail(checked.code, checked.message);
          const { note } = checked.value;
          service.arrive(viewer, "give");
          const given = service.act(viewer, {
            type: "give",
            item: body.item,
            to: params.id,
            ...(body.count === undefined ? {} : { count: body.count }),
            ...(note ? { note } : {}),
          });
          if (!given.ok) return fail(given.error.code, given.error.message);
          item = givenItem(given.events, viewer);
        }
        const sent = together.sendGesture(viewer, params.id, body, item ? { item } : {});
        if (sent.ok && !sent.value.secret) {
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
      // ---------- hosted events (RFC 0010) ----------
      getEvents: ({ viewer, query }) => ({
        status: 200,
        body: eventsView(service.state, social().eventContext(viewer), viewer, query),
      }),
      getEvent: ({ viewer, params }) => {
        const e = findEvent(service.state, params.id);
        const ctx = social().eventContext(viewer);
        if (!e || (!isTownEvent(e) && ctx.hidden(e.host)))
          return fail("not_found", "No such event.");
        return { status: 200, body: this.eventResponse(e, viewer) };
      },
      markGoing: ({ viewer, params }) => this.setGoing(viewer, params.id, true),
      unmarkGoing: ({ viewer, params }) => this.setGoing(viewer, params.id, false),
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
        // An Access sign-in shows the resident it's mapped to, so staff can see the mapping took.
        const resident = this.staffResident(viewer);
        return {
          status: 200,
          body: {
            me: {
              actor: viewer,
              role,
              via,
              resident: resident === undefined ? null : (social().authorView(resident) ?? null),
            },
            triage: social().safety.triageStatus(),
            checkins: social().checkins.stats(),
            spend: {
              ...(this.spendLedger?.summary() ?? {
                todayMicroUsd: 0,
                windowMicroUsd: 0,
                lines: [],
                chatter: { calls: 0, notes: 0, drafts: 0, refused: 0, microUsd: 0 },
              }),
              days: SUMMARY_DAYS,
            },
            chatter: this.chatterStatus(),
            tips: this.tipsStatus(),
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
        logged(await social().safety.hidePost(viewer, params.id, body.reason, body.rule)),
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
        logged(await social().safety.removePictures(viewer, params.id, body.reason, body.rule)),
      // Decision 0056: the lot goes back to its seller, or waits out of view when they're full.
      removeListing: ({ viewer, params, body }) => {
        const listing = listingById(service.state, params.id);
        if (!listing || listing.takenDown) {
          return fail("not_found", "That listing isn't in the market any more.");
        }
        const safety = social().safety;
        const rule = safety.ruleFor(["listing"], params.id, body.rule);
        const done = service.removeListing(params.id);
        if (!done.ok) return fail(done.error.code, done.error.message);
        const entry = safety.recordAction(
          viewer,
          "remove_listing",
          "listing",
          params.id,
          body.reason,
          rule,
        );
        // Decision 0064: the seller hears what came down, why, and where the lot is now.
        safety.tellOwner(listing.seller, {
          what: "listing",
          rule,
          outcome: listingById(service.state, params.id) ? "held" : "returned",
          id: params.id,
          kind: listing.kind,
          count: listing.count,
        });
        return { status: 200, body: { logged: entry } };
      },
      // Decision 0059: the thing goes back to whoever put it up, or waits for room. It settles the
      // reports on it either way: as a thing on display, and as a piece (a title, say).
      removeDisplay: ({ viewer, params, body }) => {
        const shown = madeThingForReport(service.state, "display", params.id);
        const kind = goodById(service.state, params.id)?.good.kind;
        if (!shown || !kind) return fail("not_found", "That isn't on display any more.");
        const safety = social().safety;
        const rule = safety.ruleFor(["display", "piece"], params.id, body.rule);
        const done = service.removeDisplay(params.id, false);
        if (!done.ok) return fail(done.error.code, done.error.message);
        safety.closeReports(viewer, "piece", params.id);
        const entry = safety.recordAction(
          viewer,
          "remove_display",
          "display",
          params.id,
          body.reason,
          rule,
        );
        // Decision 0064: whoever put it up hears it, and whether it's back or held for them.
        const held = heldAsideOf(service.state, shown.owner).some((d) => d.good.id === params.id);
        safety.tellOwner(shown.owner, {
          what: "display",
          rule,
          outcome: held ? "held" : "returned",
          id: params.id,
          kind,
        });
        return { status: 200, body: { logged: entry } };
      },
      // Decision 0059: the file goes first, everywhere, so the world never says it's gone while
      // storage still serves it. Then every piece made from it loses its picture, and this one
      // comes off display if it's up.
      removePiece: async ({ viewer, params, body }) => {
        const safety = social().safety;
        const media = madeThingForReport(service.state, "piece", params.id)?.media;
        if (!media) return fail("not_found", "No piece with that id shows a picture.");
        // Like a resident's pictures: the upload may be staff's avatar too.
        const maker = goodById(service.state, params.id)?.good.maker;
        if (maker && safety.protects(maker)) {
          return fail(
            "bad_request",
            "Staff's pictures can't be removed. Take them off the staff list first.",
          );
        }
        const check = service.removeDisplay(params.id, true, true);
        if (!check.ok) return fail(check.error.code, check.error.message);
        const rule = safety.ruleFor(["piece", "display"], params.id, body.rule);
        if (!(await safety.purgeUpload(media))) {
          return fail("internal", "The picture couldn't be deleted from storage yet. Try again.");
        }
        const done = service.removeDisplay(params.id, true);
        if (!done.ok) {
          // The file is gone: say so in the log, and leave the reports open to try again.
          safety.recordNote(viewer, "remove_piece", "piece", params.id, body.reason);
          return fail(done.error.code, done.error.message);
        }
        // Every piece that showed the picture is settled, wherever its reports are.
        const removed = done.events.flatMap((e) => (e.type === "picture_removed" ? e.items : []));
        for (const id of new Set([params.id, ...removed])) {
          safety.closeReports(viewer, "display", id);
          if (id !== params.id) safety.closeReports(viewer, "piece", id);
        }
        const entry = safety.recordAction(
          viewer,
          "remove_piece",
          "piece",
          params.id,
          body.reason,
          rule,
        );
        // Decision 0064: its maker hears it once, however many pieces showed the picture.
        if (maker) {
          safety.tellOwner(maker, {
            what: "piece",
            rule,
            outcome: "removed",
            id: params.id,
            kind: "piece",
          });
        }
        // Decision 0065: whoever holds or displays a piece made from the picture hears it too,
        // once per piece, not only its maker.
        for (const pieceId of new Set([params.id, ...removed])) {
          const holder = goodById(service.state, pieceId)?.holder;
          if (!holder || holder === maker) continue;
          safety.tellOwner(holder, {
            what: "piece",
            rule,
            outcome: "removed",
            id: pieceId,
            kind: "piece",
          });
        }
        return { status: 200, body: { logged: entry } };
      },
      // Bounties (decision 0062): town coins move only on a maintainer's word.
      getStaffBounties: ({ viewer }) => {
        if (this.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
        return {
          status: 200,
          body: staffBountiesView(service.state, (id) => social().authorView(id)),
        };
      },
      confirmTownBounty: async ({ viewer, params, body }) => {
        if (this.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
        if (!findBounty(service.state, params.id)) return fail("not_found", "No such bounty.");
        const done = service.confirmTownBounty(
          params.id,
          body.to,
          await worldStaffId(viewer),
          this.staffResident(viewer),
        );
        if (!done.ok) return fail(done.error.code, done.error.message);
        social().safety.recordNote(
          viewer,
          "confirm_bounty",
          "bounty",
          params.id,
          `Confirmed done, paid ${body.to}`,
        );
        return this.staffBounty(params.id);
      },
      reopenTownBounty: async ({ viewer, params, body }) => {
        if (this.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
        if (!findBounty(service.state, params.id)) return fail("not_found", "No such bounty.");
        const done = service.reopenBounty(
          params.id,
          await worldStaffId(viewer),
          this.staffResident(viewer),
        );
        if (!done.ok) return fail(done.error.code, done.error.message);
        social().safety.recordAction(viewer, "reopen_bounty", "bounty", params.id, body.reason);
        return this.staffBounty(params.id);
      },
      voidBounty: async ({ viewer, params, body }) => {
        if (this.staffRole(viewer) !== "maintainer") return fail("forbidden", MAINTAINERS_ONLY);
        if (!findBounty(service.state, params.id)) return fail("not_found", "No such bounty.");
        const done = service.voidBounty(
          params.id,
          await worldStaffId(viewer),
          this.staffResident(viewer),
        );
        if (!done.ok) return fail(done.error.code, done.error.message);
        social().safety.recordAction(viewer, "void_bounty", "bounty", params.id, body.reason);
        return this.staffBounty(params.id);
      },
      voidEvent: async ({ viewer, params, body }) => {
        if (this.staffRole(viewer) !== "maintainer") {
          return fail("forbidden", WORLD_MAINTAINERS_ONLY);
        }
        if (!findEvent(service.state, params.id)) return fail("not_found", "No such event.");
        const done = service.voidEvent(
          params.id,
          await worldStaffId(viewer),
          this.staffResident(viewer),
        );
        if (!done.ok) return fail(done.error.code, done.error.message);
        social().safety.recordAction(viewer, "void_event", "event", params.id, body.reason);
        const e = findEvent(service.state, params.id);
        if (!e) return fail("internal", "Event vanished.");
        const ctx = social().eventContext(undefined);
        return { status: 200, body: { event: eventView(service.state, e, ctx) } };
      },
      // World snapshots and the log (RFC 0014): maintainers only.
      getStaffSnapshots: ({ viewer }) => {
        if (this.staffRole(viewer) !== "maintainer") {
          return fail("forbidden", WORLD_MAINTAINERS_ONLY);
        }
        return {
          status: 200,
          body: {
            snapshots: service.snapshotHeaders().map(snapshotView),
            replayVersion: REPLAY_VERSION,
            kept: service.snapshotsKept(),
            seq: service.state.seq,
            hash: service.hash(),
          },
        };
      },
      takeSnapshot: ({ viewer }) => {
        if (this.staffRole(viewer) !== "maintainer") {
          return fail("forbidden", WORLD_MAINTAINERS_ONLY);
        }
        // One at a time: each is a copy of the whole world, and the sweep verifies them slowly.
        if (service.snapshotHeaders().some((h) => h.verified === 0)) {
          return fail("bad_request", SNAPSHOT_REFUSED.pending);
        }
        const taken = service.takeSnapshot();
        if (!("refused" in taken)) return { status: 200, body: { snapshot: snapshotView(taken) } };
        return taken.refused === "failed"
          ? fail("internal", "Couldn't save the snapshot. Nothing changed; try again.")
          : fail("bad_request", SNAPSHOT_REFUSED[taken.refused]);
      },
      getWorldLog: ({ viewer, query, origin }) => {
        if (this.staffRole(viewer) !== "maintainer") {
          return fail("forbidden", WORLD_MAINTAINERS_ONLY);
        }
        // The whole log is everyone's words and gift amounts. On terrakin.org it needs an Access
        // sign-in, even if the Worker lost its Access settings and staff fell back to tokens.
        if (!this.staffOptions.access && origin === DEFAULT_ORIGIN) {
          return fail("forbidden", "The log export needs a Cloudflare Access sign-in here.");
        }
        let page: ReturnType<typeof service.logPage>;
        try {
          page = service.logPage(query.after ?? 0, query.until, query.limit ?? WORLD_LOG_PAGE_MAX);
        } catch (err) {
          // A row that won't parse would quote itself in the error: report its kind alone.
          report(reportable(err), "world.log_export");
          return fail("internal", "Couldn't read the log. Try again.");
        }
        // The sim's command types are interfaces, which the wire's open object type can't name.
        return { status: 200, body: { ...page, rows: page.rows as WorldLogResponse["rows"] } };
      },

      // ---------- docs ----------
      getSkill: () => ({ status: 200, text: this.skill }),
      getOpenApi: () => ({ status: 200, text: this.openapi }),
      // Built into the bundle by `pnpm gen` from CHANGELOG.md, so no file is read at run time.
      getChangelog: ({ query }) => ({
        status: 200,
        body: changelogResponse(CHANGELOG_ENTRIES, query),
      }),
      // The devlog's posts, built into the bundle by `pnpm gen` from docs/devlog (decision 0105).
      getDevlog: ({ query }) => ({ status: 200, body: devlogResponse(DEVLOG_POSTS, query) }),
      getDevlogPost: ({ params }) => {
        const post = DEVLOG_POSTS.find((p) => p.date === params.date);
        if (!post) {
          return fail(
            "not_found",
            "There's no devlog post on that day. GET /v1/devlog lists them.",
          );
        }
        return { status: 200, body: { post } };
      },
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

  /**
   * A new top-level post: tell every open socket, world or watching, except residents blocked
   * either way with its author, and watchers of the following feed who don't follow them. Ids
   * only, so a signed-out watcher learns nothing a visitor to the feed couldn't see (decision
   * 0046). One read for the blocks and one for the followers, whatever the number of sockets.
   */
  /** A bounty as staff see it after acting on it. */
  private staffBounty(id: string): Reply<"confirmTownBounty"> {
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
  /** Who's asking for plots, and which plots to leave out for them (blocks and suspensions). */
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

  /** Plot (px, py) as `viewer` sees it, read fresh, or undefined when it isn't theirs to see. */
  private plotFor(viewer: string | undefined, at: { px: number; py: number }) {
    const layer = this.requireSocial();
    const author = (id: string) => layer.authorView(id);
    return layer.plots.one(this.service.state, author, at.px, at.py, this.plotViewer(viewer));
  }

  /** What the market's gate on listing reads from outside the sim: time in Terrakin and karma. */
  private listerFacts(id: string): ListerFacts {
    return {
      ageDays: this.service.residentAgeDays(id),
      tier: this.social?.karma.of(id).tier ?? "newcomer",
    };
  }

  private announcePost(post: PostView) {
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
  private sweepWatchers() {
    const now = this.now();
    for (const w of [...this.watchers]) {
      if (now - w.openedAt >= WATCH_MAX_MS) w.end(4008, "watch ended");
      else if (now - w.heardAt >= WATCH_SILENT_MS) w.end(4009, "silent");
    }
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
   * Recheck agent links that are due (RFC 0007): bounded per run and by the day's read cap. The
   * Worker's alarm and the Node server's timer call this every few minutes.
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

  /** The staff overview's tips line: the mode and the last run's counts. */
  private tipsStatus() {
    const last = this.tips?.lastRun() ?? null;
    return {
      mode: this.tips?.mode ?? ("off" as const),
      lastRun: last
        ? { at: new Date(last.at).toISOString(), day: last.day, mode: last.mode, ...last.result }
        : null,
    };
  }

  /** One event as `GET /v1/events/{id}` answers it. */
  private eventResponse(e: HostedEvent, viewer: string | undefined): EventResponse {
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
  private setGoing(viewer: string, id: string, going: boolean) {
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
  private chatterStatus() {
    const chatter = this.chatter;
    const usage = chatter?.usage() ?? { calls: 0, tokens: 0 };
    const paused = chatter?.pausedUntil() ?? null;
    const last = chatter?.lastRun() ?? null;
    const iso = (ms: number) => new Date(ms).toISOString();
    return {
      mode: chatter?.mode ?? ("off" as const),
      model: chatter?.config.model ?? "",
      callsToday: usage.calls,
      callsPerDay: chatter?.config.callsPerDay ?? 0,
      tokensToday: usage.tokens,
      tokensPerDay: chatter?.config.tokensPerDay ?? 0,
      pausedUntil: paused === null ? null : iso(paused),
      lastRun: last ? { at: iso(last.at), result: last.result } : null,
      participation: chatter?.participation(SUMMARY_DAYS) ?? {
        notes: 0,
        answered: 0,
        replies: 0,
        reactions: 0,
      },
      drafts: (chatter?.drafts() ?? []).map((d) => ({ ...d, at: iso(d.at) })),
    };
  }

  /**
   * When the next agent link recheck is due (ms), or undefined when there are no links, so the
   * Worker keeps its alarm only while they exist.
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
    this.service.keepSnapshots();
    this.sweepWatchers();
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
  private suspensionLocked(residentId: string): boolean {
    const current = this.social?.safety.currentSuspension(residentId);
    if (!current) return false;
    const long = current.remainingMs > MODERATOR_SUSPEND_MAX_DAYS * DAY_MS;
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
    if (this.posts) this.api.removePostListener(this.posts);
    this.posts = undefined;
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
      const viewer = msg.token ? service.authenticate(msg.token) : undefined;
      if (msg.token && !viewer) return this.fail("unauthorized", "Unknown token.");
      if (msg.following && !viewer) {
        return this.fail("bad_request", "Watching the following feed needs your token.");
      }
      const watcher = this.listener(viewer, msg.following === true);
      const refused = this.api.addWatcher(watcher);
      if (refused) {
        this.fail("rate_limited", refused);
        return this.socket.close(4029, "too many watchers");
      }
      this.posts = watcher;
      this.watching = true;
      clearTimeout(this.helloTimer);
      this.send({ type: "watching" });
      // An owner revoking this agent's tokens ends the watch too, as it ends a hello socket.
      if (viewer) {
        this.unwatch = service.watchRevocation(viewer, () => {
          this.fail(
            "unauthorized",
            "Your owner revoked this token. The Terrakin team can help you back in.",
          );
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
      if (msg.posts) {
        this.posts = this.listener(id, false);
        this.api.addHelloPosts(this.posts);
      }
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

/** A schema the dispatcher parses with. */
type Schema = Parameters<typeof plainProblem>[0];

/**
 * A `craft` of a family recipe's thing for a kind outside its family, like `tomato_jam`. It isn't a
 * recipe, so the schema turns it down before the world sees it; this gives the world's answer
 * instead, a refusal that names the kinds the recipe takes.
 */
function familyMiss(action: unknown): Extract<ActResult, { ok: false }> | undefined {
  if (typeof action !== "object" || action === null) return undefined;
  const { type, recipe, dry } = action as Record<string, unknown>;
  if (type !== "craft" || typeof recipe !== "string") return undefined;
  const message = familyRecipeMiss(recipe);
  if (message === undefined) return undefined;
  return { ok: false, error: { code: "unknown_item", message }, ...(dry === true ? { dry } : {}) };
}

/** A stored snapshot as staff see it. */
const snapshotView = (h: SnapshotHeader): SnapshotView => ({
  seq: h.seq,
  format: h.format,
  replayVersion: h.replayVersion,
  hash: h.hash,
  parts: h.parts,
  bytes: h.bytes,
  status: h.verified === 1 ? "verified" : h.verified === 0 ? "pending" : "failed",
});

/** Why `POST /v1/admin/snapshots` took none. */
const SNAPSHOT_REFUSED = {
  not_kept:
    "This world keeps no snapshots: it needs SQLite storage, a world that counts days, and a log whose rows match its seq.",
  taken: "There's already a snapshot at this seq. Take another once the world has moved on.",
  supply: "The world's coins don't add up, so a snapshot would never pass its checks.",
  pending:
    "A snapshot is still waiting to be verified. Take another once the sweep has checked it.",
} as const;

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

/**
 * Whether an `If-None-Match` header names `tag`: any one of its tags, weak or strong (a proxy that
 * compresses the answer may weaken the `ETag` it saw), or `*`.
 */
function etagMatches(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const one = t.trim();
    return one === "*" || one.replace(/^W\//, "") === tag;
  });
}

/**
 * Turn a handler's reply into HTTP, using the route's declared response for that status. A JSON
 * reply with an `etag` gets one, and a 304 when `ifNoneMatch` already names it.
 */
function render(
  route: RouteSpec,
  reply: HandlerReply | Failure,
  help?: string,
  ifNoneMatch?: string,
): ApiResponse {
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
  if (spec.kind === "json") {
    if (!spec.etag) return json(reply.status, reply.body);
    // Public data that's the same for everyone, like the catalog: a cache keeps it, and asks each
    // time whether it's still current.
    const headers = { etag: `"${spec.etag(reply.body)}"`, "cache-control": "public, no-cache" };
    if (etagMatches(ifNoneMatch, headers.etag)) return { status: 304, headers, body: "" };
    const out = json(reply.status, reply.body);
    return { ...out, headers: { ...out.headers, ...headers } };
  }
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
