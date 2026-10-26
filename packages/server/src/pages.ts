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
function pageTwin(pathname: string): `/${string}.md` | undefined {
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

/** A year, and never revalidated: for build output named by its content hash. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

/**
 * Headers for a static file or page the adapter is about to send:
 * - `Cache-Control: immutable` on the build's hashed files under `/assets/`,
 * - the right type for files whose name doesn't say it (`/.well-known/api-catalog`, `.md`, `.xml`,
 *   and the Atom feeds `/changelog.xml` and `/devlog.xml`),
 * - the RFC 8288 Link header on HTML, with the page's Markdown twin and the changelog's Atom feed,
 * - `Vary: Accept` wherever the same URL can also answer in Markdown.
 */
export function pageHeaders(pathname: string, contentType: string | null): Record<string, string> {
  // Vite names every file under /assets/ by its content hash, so a browser can keep it for good
  // instead of asking again on each visit. Not HTML there: that is the single-page fallback
  // answering a chunk an old page asked for after a deploy.
  if (pathname.startsWith("/assets/") && !contentType?.startsWith("text/html")) {
    return { "cache-control": IMMUTABLE };
  }
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
/** The same for a service token's sign-in: the Worker sets it to `DEPLOY_SERVICE` and nothing else. */
export const STAFF_SERVICE_HEADER = "x-terrakin-staff-service";

/** The admin app is served on any host whose first label is `admin` (admin.terrakin.org, admin.localhost). */
export const isAdminHost = (hostname: string) => hostname.toLowerCase().startsWith("admin.");

/** The public site beside an admin host: the same origin without its `admin.` label. */
export function publicOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    url.hostname = url.hostname.replace(/^admin\./i, "");
    return url.origin;
  } catch {
    return origin;
  }
}

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
 * A copy of a request for the world object. The staff headers are always dropped and set only from
 * an Access JWT the Worker verified, so nobody can claim to be staff by sending them themselves.
 */
export function toWorld(
  request: Request,
  url: URL,
  staff: { email?: string | undefined; service?: string | undefined } = {},
): Request {
  const copy = new Request(url, request);
  copy.headers.delete(STAFF_EMAIL_HEADER);
  copy.headers.delete(STAFF_SERVICE_HEADER);
  if (staff.email) copy.headers.set(STAFF_EMAIL_HEADER, staff.email);
  if (staff.service) copy.headers.set(STAFF_SERVICE_HEADER, staff.service);
  return copy;
}

/**
 * A connection to the World object that broke rather than answering. A Durable Object restarts on a
 * deploy, a move, or an eviction, and a request in flight when it does fails like this; Cloudflare
 * marks such a failure `retryable` and says to send it again.
 */
const RESTARTED = /network connection lost|no longer active|connection closed/i;

/** Whether an error from the World object's stub is one of those broken connections. */
export function worldRestarted(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ((err as { retryable?: unknown }).retryable === true) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && RESTARTED.test(message);
}

/**
 * Whether a request can simply go again: a read with no body, and not a socket upgrade, which the
 * client reopens itself.
 */
export function repeatable(request: Request): boolean {
  const reading = request.method === "GET" || request.method === "HEAD";
  return reading && request.headers.get("upgrade")?.toLowerCase() !== "websocket";
}

/**
 * The World object's answer with its body in hand. A stub's `fetch` settles as soon as the headers
 * arrive and the body streams after them, so an object that restarts mid-answer breaks the stream
 * rather than the call: the retry below never saw it, the caller had already passed the response on,
 * and it reached the client as a failed read and Sentry as an error nobody handled. Reading it here
 * puts that failure where the retry can see it. An answer with no body (a socket upgrade, a 204, a
 * 304) has nothing to break and passes through as it is.
 */
async function inHand(response: Response): Promise<Response> {
  if (response.body === null) return response;
  return new Response(await response.arrayBuffer(), response);
}

/**
 * Ask the World object, and send a read again once when the connection broke because the object was
 * restarting. Anything still broken comes back undefined, for the caller to answer in the API's own
 * shape instead of letting a 500 page out; any other error is the object's own and goes on through
 * (decision 0292). `send` builds its own request, so the second one is fresh.
 */
export async function askWorld(
  send: () => Promise<Response>,
  o: { repeat: boolean; onLost: (err: unknown, outcome: "retried" | "refused") => void },
): Promise<Response | undefined> {
  try {
    return await inHand(await send());
  } catch (err) {
    if (!worldRestarted(err)) throw err;
    if (o.repeat) {
      try {
        const again = await inHand(await send());
        o.onLost(err, "retried");
        return again;
      } catch (second) {
        if (!worldRestarted(second)) throw second;
      }
    }
    o.onLost(err, "refused");
    return undefined;
  }
}
