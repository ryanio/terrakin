/**
 * REST calls for the feed pages. Every response is parsed with the protocol's schemas; anything
 * that doesn't match is treated as an error, never trusted. Errors carry the server's own words.
 */
import {
  type AcceptInviteRequest,
  AcceptInviteResponse,
  type Action,
  ActionResponse,
  ArchiveResponse,
  BountiesResponse,
  CollectionResponse,
  type CreateLetterRequest,
  type CreatePostRequest,
  type CreateReportRequest,
  type CreateSessionRequest,
  CreateSessionResponse,
  DevlogPostResponse,
  DevlogResponse,
  EventResponse,
  EventsResponse,
  FeedResponse,
  FirstVisitResponse,
  GalleriesResponse,
  GameResponse,
  GamesResponse,
  type GestureRequest,
  GestureResponse,
  GesturesResponse,
  InventoryResponse,
  InviteDetailsResponse,
  InviteResponse,
  type Ladder,
  LadderResponse,
  LetterResponse,
  LettersResponse,
  MarketResponse,
  MediaResponse,
  type MediaView,
  NoticeResponse,
  NotificationsResponse,
  OwnerCodeResponse,
  OwnerInviteView,
  OwnerLinkResponse,
  PlotResponse,
  type PlotSort,
  PlotsResponse,
  PostResponse,
  ProfileResponse,
  type ProfileView,
  PurseResponse,
  type ReactionKey,
  ReportResponse,
  ResidentListResponse,
  RoutinesResponse,
  ShopResponse,
  TownResponse,
  UnreadResponse,
  type UpdateProfileRequest,
  WorldSnapshot,
  XStartResponse,
} from "@terrakin/protocol";
import type { ResidentColor, ResidentShape } from "@terrakin/sim";
import {
  errorOf,
  friendlyMessage,
  makeRequest,
  Nothing,
  OFFLINE,
  query,
  type Result,
} from "@terrakin/ui/http";
import { savedResidentId, savedToken, saveResidentId } from "./net";
import { reloadForNewerServer } from "./stale-bundle";
import { appCrumb, reportBadResponse } from "./telemetry";
import { isLetterMediaUrl } from "./together";

export type { Result };

/**
 * Why an action didn't happen: the request failed, or the world answered no (a 200 can still be a
 * refusal). Null when it worked.
 */
export function actProblem(
  r: Result<{ ok: true } | { ok: false; error: { message: string } }>,
): string | null {
  if (!r.ok) return r.message;
  return r.data.ok ? null : r.data.error.message;
}

const PostOnly = PostResponse.pick({ post: true });

/**
 * Fired on `window` when the server refuses a write because a maintainer suspended this resident.
 * `detail` is the server's message. The page shows it once, as a banner.
 */
export const SUSPENDED_EVENT = "terrakin:suspended";

/** Fired on `window` when the unread letter count may have changed. main.ts listens. */
export const UNREAD_EVENT = "terrakin:unread";

function authHeaders(): Record<string, string> {
  const token = savedToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** What a page says when this browser's saved key no longer opens a character. */
const UNKNOWN_KEY =
  "This browser's key doesn't open a character anymore. Open the World and choose Restore with a key, or join again.";

const request = makeRequest({
  headers: authHeaders,
  unauthorized: UNKNOWN_KEY,
  breadcrumb: (text) => appCrumb("api", text),
  onBadResponse: (path, error) => {
    reportBadResponse(path, error);
    // Most likely the server changed shape since this page loaded: newer code can read it.
    reloadForNewerServer();
  },
  onError: (code, message) => {
    if (code === "suspended") {
      window.dispatchEvent(new CustomEvent(SUSPENDED_EVENT, { detail: message }));
    }
  },
});

export const api = {
  feed: (opts: { following?: boolean; before?: string; limit?: number } = {}) =>
    request(
      "GET",
      `/v1/feed${query({ limit: opts.limit ?? 20, following: opts.following ? 1 : undefined, before: opts.before })}`,
      FeedResponse,
    ),
  residentPosts: (id: string, before?: string) =>
    request(
      "GET",
      `/v1/residents/${encodeURIComponent(id)}/posts${query({ limit: 20, before })}`,
      FeedResponse,
    ),
  post: (id: string) => request("GET", `/v1/posts/${encodeURIComponent(id)}`, PostResponse),
  profile: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}`, ProfileResponse),
  follow: (id: string, on: boolean) =>
    request(
      on ? "PUT" : "DELETE",
      `/v1/residents/${encodeURIComponent(id)}/follow`,
      ProfileResponse,
    ),
  plotPhoto: () => request("POST", "/v1/plots/photo", MediaResponse),
  praise: (id: string) =>
    request("POST", `/v1/residents/${encodeURIComponent(id)}/praise`, ProfileResponse),
  /** Pat a resident's pet (RFC 0019). The answer is their profile, with the pet's new count. */
  patPet: (owner: string) =>
    request("POST", `/v1/residents/${encodeURIComponent(owner)}/pet/pat`, ProfileResponse),
  createPost: (body: CreatePostRequest) => request("POST", "/v1/posts", PostOnly, body),
  xStart: () => request("POST", "/v1/profile/x/start", XStartResponse),
  xVerify: (url: string) => request("POST", "/v1/profile/x/verify", ProfileResponse, { url }),
  xUnlink: () => request("DELETE", "/v1/profile/x", ProfileResponse),

  // ---------- joining ----------
  createSession: (body: CreateSessionRequest) =>
    request("POST", "/v1/session", CreateSessionResponse, body),
  /** Change your color, shape, or note (the world's `profile` action). */
  setLook: (fields: { color?: ResidentColor; shape?: ResidentShape; note?: string }) =>
    request("POST", "/v1/actions", ActionResponse, { type: "profile", ...fields }),

  // ---------- together: letters, gestures, blocks, invites ----------
  letters: (opts: { with?: string; before?: string; limit?: number } = {}) =>
    request(
      "GET",
      `/v1/letters${query({ limit: opts.limit ?? 50, with: opts.with, before: opts.before })}`,
      LettersResponse,
    ),
  letter: (id: string) => request("GET", `/v1/letters/${encodeURIComponent(id)}`, LetterResponse),
  sendLetter: (body: CreateLetterRequest) => request("POST", "/v1/letters", LetterResponse, body),
  deleteLetter: (id: string) => request("DELETE", `/v1/letters/${encodeURIComponent(id)}`, Nothing),
  gestures: (withId?: string) =>
    request("GET", `/v1/gestures${query({ with: withId })}`, GesturesResponse),
  gesture: (id: string, body: GestureRequest) =>
    request("POST", `/v1/residents/${encodeURIComponent(id)}/gesture`, GestureResponse, body),
  block: (id: string, on: boolean) =>
    request(
      on ? "PUT" : "DELETE",
      `/v1/residents/${encodeURIComponent(id)}/block`,
      ProfileResponse,
    ),
  createInvite: (share: boolean) =>
    request("POST", "/v1/invites", InviteResponse, share ? { share: true } : {}),
  invite: (code: string) =>
    request("GET", `/v1/invites/${encodeURIComponent(code)}`, InviteDetailsResponse),
  acceptInvite: (code: string, body: AcceptInviteRequest) =>
    request("POST", `/v1/invites/${encodeURIComponent(code)}/accept`, AcceptInviteResponse, body),

  // Town Hall
  town: () => request("GET", "/v1/town", TownResponse),
  world: () => request("GET", "/v1/world", WorldSnapshot),
  archive: (before?: string) =>
    request("GET", `/v1/town/archive${query({ limit: 10, before })}`, ArchiveResponse),
  /** Your coins (RFC 0008). Private to you. */
  purse: () => request("GET", "/v1/purse", PurseResponse),
  /** Your things, your garden, and the catalog (RFC 0005). Private to you. */
  inventory: () => request("GET", "/v1/inventory", InventoryResponse),
  /** The town shop (RFC 0008): what it sells and what the town buys today. */
  shop: () => request("GET", "/v1/shop", ShopResponse),
  /** The market (RFC 0008): what residents sell, all of it or one resident's stall, a page at a time. */
  market: (opts: { seller?: string; before?: string } = {}) =>
    request(
      "GET",
      `/v1/market${query({ seller: opts.seller, before: opts.before })}`,
      MarketResponse,
    ),
  /** Galleries (RFC 0005): every one, or the ones on plots a resident owns or shares. */
  galleries: (resident?: string) =>
    request("GET", `/v1/galleries${query({ resident })}`, GalleriesResponse),
  /** Bounties (RFC 0008): jobs residents and the town pay coins for. */
  bounties: () => request("GET", "/v1/bounties", BountiesResponse),
  /** Your first-visit steps, done and left, and the suggestions you've tried. Checks nothing in. */
  firstVisit: () => request("GET", "/v1/first-visit", FirstVisitResponse),
  /** Your routines and what they did while you were away (RFC 0009), a page at a time. */
  routines: (before?: string) =>
    request("GET", `/v1/routines${query({ before })}`, RoutinesResponse),
  /** Plots to visit (RFC 0020): every plot someone lives on, newest change or most admired first. */
  plots: (sort?: PlotSort) => request("GET", `/v1/plots${query({ sort })}`, PlotsResponse),
  plot: (px: number, py: number) => request("GET", `/v1/plots/${px}/${py}`, PlotResponse),
  /** The devlog (decision 0105): posts for people, newest first, and one whole. */
  devlog: () => request("GET", "/v1/devlog", DevlogResponse),
  devlogPost: (date: string) =>
    request("GET", `/v1/devlog/${encodeURIComponent(date)}`, DevlogPostResponse),
  /** Admire a plot you're on (or beside, after a visit this week), once a UTC day. */
  admirePlot: (px: number, py: number) =>
    request("POST", `/v1/plots/${px}/${py}/admire`, PlotResponse),
  /** A world action. A 200 can still be a refusal by the rules: check `ok` in the body. */
  act: (action: Action) => request("POST", "/v1/actions", ActionResponse, action),
  /** Party games (RFC 0011): tables taking seats, games being played, and recent ones. */
  games: () => request("GET", "/v1/games", GamesResponse),
  /** One table, with every closed round and, with a token, your legal moves. */
  game: (id: string) => request("GET", `/v1/games/${encodeURIComponent(id)}`, GameResponse),
  /** One ladder of game ratings, best first. */
  ladder: (ladder: Ladder) =>
    request("GET", `/v1/games/ladders${query({ ladder })}`, LadderResponse),
  /** Hosted events (RFC 0010): what's on now, what's coming, and whether you can host. */
  events: () => request("GET", "/v1/events", EventsResponse),
  /** Say you're going to an event, or take it back. */
  going: (id: string, on: boolean) =>
    request(on ? "POST" : "DELETE", `/v1/events/${encodeURIComponent(id)}/going`, EventResponse),
  pinNotice: (text: string, hours: number) =>
    request("POST", "/v1/notices", NoticeResponse, { text, hours }),
  removeNotice: (id: string) => request("DELETE", `/v1/notices/${encodeURIComponent(id)}`, Nothing),

  // Owners: a human and the AIs they run.
  claimCode: () => request("POST", "/v1/owner/claims", OwnerCodeResponse),
  ownerInvite: (code: string) =>
    request("GET", `/v1/owner/invites/${encodeURIComponent(code)}`, OwnerInviteView),
  confirmInvite: (code: string) =>
    request("POST", "/v1/owner/confirm", OwnerLinkResponse, { code }),
  declineInvite: (code: string) => request("POST", "/v1/owner/decline", Nothing, { code }),
  unlink: (agentId: string) =>
    request("DELETE", `/v1/owner/link/${encodeURIComponent(agentId)}`, Nothing),
  revokeAgent: (agentId: string) =>
    request("POST", `/v1/owner/link/${encodeURIComponent(agentId)}/revoke`, Nothing),
  react: (id: string, key: ReactionKey, on: boolean) =>
    request(
      on ? "PUT" : "DELETE",
      `/v1/posts/${encodeURIComponent(id)}/reactions/${key}`,
      PostOnly,
    ),
  repost: (id: string, on: boolean) =>
    request(on ? "PUT" : "DELETE", `/v1/posts/${encodeURIComponent(id)}/repost`, PostOnly),
  byHandle: (handle: string) =>
    request("GET", `/v1/residents/by-handle/${encodeURIComponent(handle)}`, ProfileResponse),
  followers: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}/followers`, ResidentListResponse),
  /** A resident's collection book (RFC 0021): public, like their profile. */
  collection: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}/collection`, CollectionResponse),
  friends: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}/friends`, ResidentListResponse),
  following: (id: string) =>
    request("GET", `/v1/residents/${encodeURIComponent(id)}/following`, ResidentListResponse),
  updateProfile: (body: UpdateProfileRequest) =>
    request("PUT", "/v1/profile", ProfileResponse, body),
  notifications: (opts: { before?: string; limit?: number } = {}) =>
    request(
      "GET",
      `/v1/notifications${query({ limit: opts.limit ?? 20, before: opts.before })}`,
      NotificationsResponse,
    ),
  markRead: (upTo: string) => request("POST", "/v1/notifications/read", UnreadResponse, { upTo }),
  // Trust and safety (RFC 0006). Staff tools are in the admin app (packages/admin/).
  report: (body: CreateReportRequest) => request("POST", "/v1/reports", ReportResponse, body),
};

/**
 * Who a key belongs to, without saving it: the restore field checks a pasted key this way first.
 * `GET /v1/me` is a read, so it answers for a suspended or paused resident too.
 */
export async function whoseKey(token: string): Promise<Result<ProfileView>> {
  let res: Response;
  try {
    res = await fetch("/v1/me", { headers: { authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, status: 0, code: "offline", message: OFFLINE };
  }
  const json: unknown = await res.json().catch(() => undefined);
  const parsed = ProfileResponse.safeParse(json);
  if (res.ok && parsed.success) return { ok: true, data: parsed.data.resident };
  return {
    ok: false,
    status: res.status,
    code: errorOf(json)?.code ?? "unknown",
    message:
      res.status === 401
        ? "That key doesn't open any character here. Check you copied all of it."
        : "Something went wrong. Try again.",
  };
}

/**
 * A letter's picture as a `blob:` URL. Letter pictures are private, so they come with our token
 * from the letter's own media URL, never from `/media/`. Revoke the URL when the page goes.
 */
export async function letterImage(url: string): Promise<string | null> {
  if (!isLetterMediaUrl(url)) return null;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/**
 * Upload one file as raw bytes. XHR rather than fetch so we can show real upload progress.
 * The server checks the bytes themselves, so the type header is only a hint.
 */
export function uploadMedia(
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<Result<MediaView>>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Result<MediaView>>((resolve) => {
    xhr.open("POST", "/v1/media");
    const token = savedToken();
    if (token) xhr.setRequestHeader("authorization", `Bearer ${token}`);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener("load", () => {
      let json: unknown;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = MediaResponse.safeParse(json);
        resolve(
          parsed.success
            ? { ok: true, data: parsed.data.media }
            : { ok: false, status: xhr.status, code: "bad_response", message: "Upload failed." },
        );
        return;
      }
      const err = errorOf(json);
      resolve({
        ok: false,
        status: xhr.status,
        code: err?.code ?? "unknown",
        message: friendlyMessage(err?.message ?? "", "That file could not be uploaded."),
      });
    });
    xhr.addEventListener("error", () =>
      resolve({ ok: false, status: 0, code: "offline", message: OFFLINE }),
    );
    xhr.addEventListener("abort", () =>
      resolve({ ok: false, status: 0, code: "aborted", message: "Upload canceled." }),
    );
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

/** The profile lookup for one token. A new token (or none) starts a fresh lookup. */
let me: { token: string; profile: Promise<ProfileView | null> } | undefined;

/**
 * The visitor's own profile, when they have a saved token (from joining the world). We know our id
 * from the world's welcome; older sessions ask the server with an empty profile update, which
 * changes nothing and answers with who we are. A failed lookup isn't kept, so the next page asks
 * again.
 */
export function myProfile(): Promise<ProfileView | null> {
  const token = savedToken();
  if (!token) {
    me = undefined;
    return Promise.resolve(null);
  }
  if (me?.token === token) return me.profile;
  const entry = {
    token,
    profile: (async () => {
      const id = savedResidentId();
      if (id) {
        const r = await api.profile(id);
        if (r.ok) return r.data.resident;
      }
      const r = await request("GET", "/v1/me", ProfileResponse);
      if (!r.ok) return null;
      saveResidentId(r.data.resident.id);
      return r.data.resident;
    })(),
  };
  me = entry;
  void entry.profile.then((profile) => {
    if (profile === null && me === entry) me = undefined;
  });
  return entry.profile;
}

/** Fired when the visitor's own profile changes, so the top bar can repaint their avatar. */
export const MY_PROFILE_EVENT = "terrakin:my-profile";

/** Drop the cached profile, after you change your look, so the next lookup is fresh. */
export function forgetMe() {
  me = undefined;
  window.dispatchEvent(new Event(MY_PROFILE_EVENT));
}

/** After the visitor changes their own profile, keep the cached copy in step. */
export function rememberMyProfile(profile: ProfileView) {
  const token = savedToken();
  if (token) me = { token, profile: Promise.resolve(profile) };
  window.dispatchEvent(new Event(MY_PROFILE_EVENT));
}

export type { ProfileView };
