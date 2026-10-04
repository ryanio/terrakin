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
  type CreateLetterRequest,
  type CreatePostRequest,
  type CreateSessionRequest,
  CreateSessionResponse,
  ErrorBody,
  FeedResponse,
  type GestureRequest,
  GestureResponse,
  GesturesResponse,
  InviteDetailsResponse,
  InviteResponse,
  LetterResponse,
  LettersResponse,
  MediaResponse,
  type MediaView,
  NoticeResponse,
  PostResponse,
  type PostView,
  ProfileResponse,
  type ProfileView,
  TownResponse,
  WorldSnapshot,
  XStartResponse,
} from "@terrakin/protocol";
import type { ResidentColor, ResidentShape } from "@terrakin/sim";
import { savedResidentId, savedToken, saveResidentId } from "./net";
import { isLetterMediaUrl } from "./together";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** Anything with a zod-style `safeParse`. */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

const PostOnly = PostResponse.pick({ post: true });

/** The `{ error: { code, message } }` body every failed request carries. */
function errorOf(json: unknown) {
  const parsed = ErrorBody.safeParse((json as { error?: unknown } | undefined)?.error);
  return parsed.success ? parsed.data : undefined;
}

const OFFLINE = "Can't reach Terrakin right now. Check your connection and try again.";

function authHeaders(): Record<string, string> {
  const token = savedToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** The server's message when it is plain words; a gentle fallback when it is a schema dump. */
export function friendlyMessage(message: string, fallback: string): string {
  const m = message.trim();
  if (!m || m.startsWith("[") || m.startsWith("{")) return fallback;
  return m;
}

async function request<T>(
  method: string,
  path: string,
  schema: Schema<T>,
  body?: unknown,
): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...authHeaders(),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, code: "offline", message: OFFLINE };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const err = errorOf(json);
    return {
      ok: false,
      status: res.status,
      code: err?.code ?? "unknown",
      message: friendlyMessage(err?.message ?? "", "Something went wrong. Try again."),
    };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    console.warn("Unexpected response from", path, parsed.error);
    return {
      ok: false,
      status: res.status,
      code: "bad_response",
      message: "Something went wrong.",
    };
  }
  return { ok: true, data: parsed.data };
}

const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

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
  like: (id: string, on: boolean) =>
    request(on ? "PUT" : "DELETE", `/v1/posts/${encodeURIComponent(id)}/like`, PostOnly),
  follow: (id: string, on: boolean) =>
    request(
      on ? "PUT" : "DELETE",
      `/v1/residents/${encodeURIComponent(id)}/follow`,
      ProfileResponse,
    ),
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
  /** A world action. A 200 can still be a refusal by the rules: check `ok` in the body. */
  act: (action: Action) => request("POST", "/v1/actions", ActionResponse, action),
  pinNotice: (text: string) => request("POST", "/v1/notices", NoticeResponse, { text }),
  removeNotice: (id: string) => request("DELETE", `/v1/notices/${encodeURIComponent(id)}`, Nothing),
};

/** For replies with no body (204). */
const Nothing: Schema<null> = { safeParse: () => ({ success: true, data: null }) };

/**
 * Who a key belongs to, without saving it: the restore field checks a pasted key this way first.
 * An empty profile update changes nothing and answers with the key's resident.
 */
export async function whoseKey(token: string): Promise<Result<ProfileView>> {
  let res: Response;
  try {
    res = await fetch("/v1/profile", {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
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
      const r = await request("PUT", "/v1/profile", ProfileResponse, {});
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

/** Drop the cached profile, after you change your look, so the next lookup is fresh. */
export function forgetMe() {
  me = undefined;
}

export type { PostView, ProfileView };
