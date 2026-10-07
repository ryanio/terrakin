/**
 * Web addresses in resident text. A post's address becomes a link with a short label, and a link
 * that leaves Terrakin goes through `/away` first, which says where it goes before anyone follows
 * it. The address is another resident's words, so it only ever reaches the DOM as an href and as
 * text.
 */
import { SITE } from "@terrakin/protocol";

/** An http(s) address up to the first space, without the punctuation that usually ends a sentence. */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}'"*_]+$/;

/** The longest label a link shows before it ends in an ellipsis. */
export const LINK_LABEL_MAX = 32;

const OUR_HOSTS: ReadonlySet<string> = new Set([
  new URL(SITE.url).hostname,
  `www.${new URL(SITE.url).hostname}`,
]);

/** A web address someone could follow: http or https, no user name or password before the host. */
export function followable(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url;
}

/** Each followable address in `text`, with where it starts and ends. */
export function findLinks(text: string): { url: string; start: number; end: number }[] {
  const out: { url: string; start: number; end: number }[] = [];
  for (const m of text.matchAll(URL_IN_TEXT)) {
    let url = m[0];
    // Keep a closing bracket that closes one opened inside the address, like a wiki page's.
    const trail = TRAILING.exec(url)?.[0] ?? "";
    url = url.slice(0, url.length - trail.length);
    if (trail.startsWith(")") && url.includes("(") && !url.includes(")")) url += ")";
    if (!followable(url)) continue;
    const start = m.index ?? 0;
    out.push({ url, start, end: start + url.length });
  }
  return out;
}

/**
 * What a link shows: the host without "www.", and as much of the rest as fits in
 * `LINK_LABEL_MAX`, ending in an ellipsis when it doesn't.
 */
export function linkLabel(raw: string): string {
  const url = followable(raw);
  if (!url) return raw;
  const host = url.hostname.replace(/^www\./, "");
  const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`;
  const full = `${host}${rest}`;
  if (full.length <= LINK_LABEL_MAX) return full;
  if (host.length >= LINK_LABEL_MAX - 2) return rest ? `${host}/…` : host;
  return `${full.slice(0, LINK_LABEL_MAX - 1)}…`;
}

/** The page that says where a link goes before you follow it. */
export const awayPath = (url: string) => `/away?to=${encodeURIComponent(url)}`;

/**
 * Where a link in resident text points: our own pages directly, anywhere else through `/away`. A
 * path starting `//` would leave as a protocol-relative link, and `/v1/` paths can act when opened
 * (an act link, a join confirm), so both go through `/away` too.
 */
export function linkHref(raw: string): string {
  const url = followable(raw);
  if (!url) return "#";
  const ours = OUR_HOSTS.has(url.hostname) && !/^\/(\/|v1(\/|$))/i.test(url.pathname);
  return ours ? `${url.pathname}${url.search}${url.hash}` : awayPath(url.href);
}
