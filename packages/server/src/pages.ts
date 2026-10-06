import {
  API_CATALOG_TYPE,
  DEVLOG_POSTS,
  devlogPath,
  FEED_LINK,
  LINKS,
  linkHeader,
  markdownTwin,
  prefersMarkdown,
} from "@terrakin/protocol";

/**
 * Serving pages to agents, for both adapters: content negotiation onto the Markdown twins, and the
 * headers static files and pages carry. Runtime-neutral, like api.ts.
 */

/**
 * A page's Markdown twin: a site page's from the site config, or a devlog post's (decision 0105),
 * which the client build writes next to its page. Only posts that exist have one.
 */
export function pageTwin(pathname: string): `/${string}.md` | undefined {
  const twin = markdownTwin(pathname);
  if (twin) return twin;
  const path = pathname.replace(/\/+$/, "");
  const post = DEVLOG_POSTS.find((p) => devlogPath(p.date) === path);
  return post ? `${devlogPath(post.date)}.md` : undefined;
}

/**
 * The Markdown twin to serve instead of the page, if the request asks for one: `Accept` preferring
 * `text/markdown` over `text/html`, or `/?mode=agent` on the home page.
 */
export function negotiate(
  pathname: string,
  query: URLSearchParams,
  accept: string | null | undefined,
): string | undefined {
  const twin = pageTwin(pathname);
  if (!twin) return undefined;
  if (pathname === "/" && query.get("mode") === "agent") return twin;
  return prefersMarkdown(accept) ? twin : undefined;
}

/**
 * Headers for a static file or page the adapter is about to send:
 * - the right type for files whose name doesn't say it (`/.well-known/api-catalog`, `.md`, `.xml`,
 *   and the Atom feeds `/changelog.xml` and `/devlog.xml`),
 * - the RFC 8288 Link header on HTML, with the page's Markdown twin and the changelog's Atom feed,
 * - `Vary: Accept` wherever the same URL can also answer in Markdown.
 */
export function pageHeaders(pathname: string, contentType: string | null): Record<string, string> {
  if (pathname === LINKS.apiCatalog) {
    return { "content-type": API_CATALOG_TYPE, link: linkHeader() };
  }
  if (pathname.endsWith(".md")) return { "content-type": "text/markdown; charset=utf-8" };
  if (pathname === LINKS.changelogFeed || pathname === LINKS.devlogFeed) {
    return { "content-type": "application/atom+xml; charset=utf-8" };
  }
  if (pathname.endsWith(".xml")) return { "content-type": "application/xml; charset=utf-8" };
  if (!contentType?.startsWith("text/html")) return {};
  const twin = pageTwin(pathname);
  return { link: `${linkHeader(twin)}, ${FEED_LINK}`, ...(twin ? { vary: "Accept" } : {}) };
}

/** Headers for a Markdown twin served in place of a page. */
export const twinHeaders = (): Record<string, string> => ({
  "content-type": "text/markdown; charset=utf-8",
  vary: "Accept",
  link: linkHeader(),
});

// ---------- admin.terrakin.org (RFC 0006, decision 0040) ----------

/**
 * Where the admin app's built files live inside the client's assets (`packages/admin/` builds into
 * it).
 */
export const ADMIN_ASSET_PREFIX = "/_admin/";

/**
 * The header the Worker in front uses to tell the world object who signed in through Access. The
 * Worker drops it from every incoming request and sets it only from a JWT it verified.
 */
export const STAFF_EMAIL_HEADER = "x-terrakin-staff-email";

/** The admin app is served on any host whose first label is `admin` (admin.terrakin.org, admin.localhost). */
export const isAdminHost = (hostname: string) => hostname.toLowerCase().startsWith("admin.");

/**
 * `/admin` on the main site moved to the admin host. The URL to send it to, or undefined. Both
 * adapters answer 302, not 301, so no browser caches the move before admin.terrakin.org is live.
 */
export function adminRedirect(url: URL): string | undefined {
  if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return undefined;
  return `${url.protocol}//admin.${url.host}/`;
}

/**
 * Headers on every admin page and file: nothing from anywhere else, never framed, never indexed,
 * never cached by a shared cache, and no referrer.
 */
export const ADMIN_PAGE_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; "),
  "x-robots-tag": "noindex, nofollow",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

/**
 * A copy of a request for the world object. The staff header is always dropped and set only from
 * an Access JWT the Worker verified, so nobody can claim to be staff by sending it themselves.
 */
export function toWorld(request: Request, url: URL, staffEmail?: string): Request {
  const copy = new Request(url, request);
  copy.headers.delete(STAFF_EMAIL_HEADER);
  if (staffEmail) copy.headers.set(STAFF_EMAIL_HEADER, staffEmail);
  return copy;
}
