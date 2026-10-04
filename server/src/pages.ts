import {
  API_CATALOG_TYPE,
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
 * The Markdown twin to serve instead of the page, if the request asks for one: `Accept` preferring
 * `text/markdown` over `text/html`, or `/?mode=agent` on the home page.
 */
export function negotiate(
  pathname: string,
  query: URLSearchParams,
  accept: string | null | undefined,
): string | undefined {
  const twin = markdownTwin(pathname);
  if (!twin) return undefined;
  if (pathname === "/" && query.get("mode") === "agent") return twin;
  return prefersMarkdown(accept) ? twin : undefined;
}

/**
 * Headers for a static file or page the adapter is about to send:
 * - the right type for files whose name doesn't say it (`/.well-known/api-catalog`, `.md`, `.xml`,
 *   and the Atom feed `/changelog.xml`),
 * - the RFC 8288 Link header on HTML, with the page's Markdown twin and the changelog's Atom feed,
 * - `Vary: Accept` wherever the same URL can also answer in Markdown.
 */
export function pageHeaders(pathname: string, contentType: string | null): Record<string, string> {
  if (pathname === LINKS.apiCatalog) {
    return { "content-type": API_CATALOG_TYPE, link: linkHeader() };
  }
  if (pathname.endsWith(".md")) return { "content-type": "text/markdown; charset=utf-8" };
  if (pathname === LINKS.changelogFeed) {
    return { "content-type": "application/atom+xml; charset=utf-8" };
  }
  if (pathname.endsWith(".xml")) return { "content-type": "application/xml; charset=utf-8" };
  if (!contentType?.startsWith("text/html")) return {};
  const twin = markdownTwin(pathname);
  return { link: `${linkHeader(twin)}, ${FEED_LINK}`, ...(twin ? { vary: "Accept" } : {}) };
}

/** Headers for a Markdown twin served in place of a page. */
export const twinHeaders = (): Record<string, string> => ({
  "content-type": "text/markdown; charset=utf-8",
  vary: "Accept",
  link: linkHeader(),
});
