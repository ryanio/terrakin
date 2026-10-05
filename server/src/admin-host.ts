/**
 * The admin host's front door (RFC 0006, decision 0040), shared by the Worker and the Node server
 * where they can share it: who a request is, and which of the staff app's files it gets. The app's
 * files are built into the client's dist under `ADMIN_ASSET_PREFIX` (see admin/vite.config.ts).
 */
import { type AccessVerifier, accessToken } from "./access";
import { isApiPath } from "./api";
import { ADMIN_ASSET_PREFIX, ADMIN_PAGE_HEADERS } from "./pages";

export const ACCESS_SIGN_IN = "Sign in to admin.terrakin.org through Cloudflare Access.";
export const ACCESS_NOT_SET_UP =
  "The staff site isn't set up yet. It needs Cloudflare Access (TERRAKIN_ACCESS_TEAM and TERRAKIN_ACCESS_AUD).";

/** A refusal on the admin host: JSON for the API, plain text for pages, strict headers on both. */
export function adminRefusal(url: URL, status: 401 | 503, code: string, message: string) {
  const api = isApiPath(url.pathname);
  return new Response(api ? JSON.stringify({ error: { code, message } }) : message, {
    status,
    headers: {
      ...ADMIN_PAGE_HEADERS,
      "content-type": api ? "application/json" : "text/plain; charset=utf-8",
      ...(api ? { "api-version": "1" } : {}),
    },
  });
}

export type AdminGate = { email: string | undefined } | { refuse: Response };

/**
 * Who is calling the admin host. With Access set up, only a request carrying a valid Access JWT
 * (the header Access adds, or its cookie) gets through, checked here as well as at Cloudflare's
 * edge, and its email is the staff identity, and the `Api` then ignores resident tokens on staff
 * routes on every host, terrakin.org included. Without Access, requests get through with no email
 * and staff routes fall back to a maintainer's or moderator's token. `requireAccess` (the real
 * admin.terrakin.org) refuses to serve the admin host that way, but until Access is configured the
 * staff routes on terrakin.org's own API still take those tokens.
 */
export async function adminGate(
  request: Request,
  url: URL,
  options: { verifier: AccessVerifier | undefined; requireAccess: boolean },
): Promise<AdminGate> {
  const { verifier } = options;
  if (!verifier) {
    if (options.requireAccess) {
      return { refuse: adminRefusal(url, 503, "unavailable", ACCESS_NOT_SET_UP) };
    }
    return { email: undefined };
  }
  const identity = await verifier.verify(
    accessToken(request.headers.get("cf-access-jwt-assertion"), request.headers.get("cookie")),
  );
  if (!identity) return { refuse: adminRefusal(url, 401, "unauthorized", ACCESS_SIGN_IN) };
  return { email: identity.email };
}

/**
 * The file to serve for a path on the admin host: the app's own files under the prefix, and its
 * page for every other path (a single-page app). A folder means its index.html.
 */
export function adminAssetPath(pathname: string): string {
  if (!pathname.startsWith(ADMIN_ASSET_PREFIX)) return `${ADMIN_ASSET_PREFIX}index.html`;
  return pathname.endsWith("/") ? `${pathname}index.html` : pathname;
}

/**
 * The Worker's assets answer a missing file with the main site's index.html (single-page
 * fallback). A request for a script, style, or font under the prefix that comes back as HTML is a
 * missing file, and gets a 404 instead.
 */
export function isMissingAdminFile(pathname: string, contentType: string | null): boolean {
  if (!pathname.startsWith(ADMIN_ASSET_PREFIX)) return false;
  const ext = /\.([a-z0-9]+)$/i.exec(pathname)?.[1]?.toLowerCase();
  if (!ext || ext === "html") return false;
  return (contentType ?? "").toLowerCase().startsWith("text/html");
}
