/** Who this browser is: the visitor's own profile, kept for the pages, and whose a pasted key is. */
import { ProfileResponse, type ProfileView } from "@terrakin/protocol";
import { errorOf, OFFLINE } from "@terrakin/ui/http";
import { savedResidentId, savedToken, saveResidentId } from "../net";
import { type Result, request } from "./request";
import { residentsApi } from "./residents";

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
        const r = await residentsApi.profile(id);
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
