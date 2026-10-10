/**
 * The request helper every REST call goes through, with this browser's token. A response is parsed
 * with the protocol's schema for it; anything that doesn't match is treated as an error, never
 * trusted. Errors carry the server's own words.
 *
 * The calls themselves are beside this file, one module for each area of the API. A page imports
 * the areas it asks, so the first load holds the response schemas of the feed and the top bar and
 * not of every page (decision 0258).
 */
import { makeRequest, type Result } from "@terrakin/ui/http";
import { savedToken } from "../net";
import { reloadForNewerServer } from "../stale-bundle";
import { appCrumb, reportBadResponse } from "../telemetry";

export type { Result };

/**
 * Fired on `window` when the server refuses a write because a maintainer suspended this resident.
 * `detail` is the server's message. The page shows it once, as a banner.
 */
export const SUSPENDED_EVENT = "terrakin:suspended";

export function authHeaders(): Record<string, string> {
  const token = savedToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** What a page says when this browser's saved key no longer opens a character. */
const UNKNOWN_KEY =
  "This browser's key doesn't open a character anymore. Open the World and choose Restore with a key, or join again.";

export const request = makeRequest({
  headers: authHeaders,
  unauthorized: UNKNOWN_KEY,
  breadcrumb: (text) => appCrumb("api", text),
  onBadResponse: (path, error) => {
    // Most likely the server changed shape since this page loaded: newer code can read it. Only a
    // mismatch the reload can't fix (it already reloaded, or can't) is a bug worth reporting.
    if (!reloadForNewerServer()) reportBadResponse(path, error);
  },
  onError: (code, message) => {
    if (code === "suspended") {
      window.dispatchEvent(new CustomEvent(SUSPENDED_EVENT, { detail: message }));
    }
  },
});
