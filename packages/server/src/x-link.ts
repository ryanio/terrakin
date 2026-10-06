/**
 * Connecting an X account (decision 0022), the parts that don't touch storage: reading a pasted
 * post link, asking X's public oEmbed endpoint for that post, and checking what comes back. No
 * OAuth and no API key: the resident posts a line with a one-time code, and we read the post.
 *
 * Everything X sends is untrusted. We read two things from it (the author's handle and the post's
 * own text), check them, and drop the rest. Its HTML is never stored, logged, or shown.
 *
 * Runs on Node and in the Worker: plain `fetch`, no Node APIs.
 */

/** A post on X, as named by a pasted link. */
export interface XStatus {
  /** The post's numeric id. */
  id: string;
  /** The account named in the link, or undefined for `/i/status/` links. X ignores it. */
  handle: string | undefined;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const X_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

const STATUS_PATH =
  /^\/(?:i\/web|i|([A-Za-z0-9_]{1,15}))\/status(?:es)?\/(\d{1,25})(?:\/(?:photo|video)\/\d)?\/?$/;

const NOT_A_POST = "That isn't a link to a post on X. It looks like https://x.com/you/status/123.";

/**
 * A pasted x.com or twitter.com post link, or why it isn't one. Strict on purpose: https or http,
 * one of X's own hosts, no user or port, and a numeric post id. Query and fragment are ignored.
 */
export function parseXStatusUrl(raw: string): Parsed<XStatus> {
  const text = raw.trim();
  if (text.length === 0 || text.length > 300) return { ok: false, message: NOT_A_POST };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: NOT_A_POST };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { ok: false, message: NOT_A_POST };
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return { ok: false, message: NOT_A_POST };
  }
  if (!X_HOSTS.has(url.hostname)) return { ok: false, message: NOT_A_POST };
  const match = STATUS_PATH.exec(url.pathname);
  if (!match?.[2]) return { ok: false, message: NOT_A_POST };
  const handle = match[1];
  return { ok: true, value: { id: match[2], handle: handle === "i" ? undefined : handle } };
}

/** The post's link as we store it, under the account that wrote it. */
export const canonicalStatusUrl = (handle: string, id: string) =>
  `https://x.com/${handle}/status/${id}`;

/** X's oEmbed answer, reduced to what we check. */
export interface XPost {
  /** The author, as X spells it. */
  handle: string;
  /** The post's own words, as plain text. Not the byline, which a stranger's display name is part of. */
  text: string;
}

export type XPostRead =
  | { ok: true; post: XPost }
  /** `missing`: X says there is no public post there. Otherwise X failed or was too slow. */
  | { ok: false; missing: boolean };

/** Reads a post from X. Injected into the social service so tests never touch the network. */
export type XPostReader = (status: XStatus) => Promise<XPostRead>;

export const X_OEMBED_ENDPOINT = "https://publish.twitter.com/oembed";
/** X moves the oEmbed endpoint between its own hosts with redirects. We follow those and no others. */
const X_OEMBED_HOSTS = new Set(["publish.twitter.com", "publish.x.com"]);
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_ANSWER_CHARS = 64 * 1024;

export interface XReaderOptions {
  /** The oEmbed endpoint. Only the Node test server changes it, to a local fake. */
  endpoint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The real reader: X's free, keyless oEmbed endpoint, which only answers for public posts. */
export function oembedReader(options: XReaderOptions = {}): XPostReader {
  const endpoint = options.endpoint ?? X_OEMBED_ENDPOINT;
  const allowed = new Set([...X_OEMBED_HOSTS, new URL(endpoint).host]);
  const get = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  return async (status) => {
    // X ignores the account in a status link, so `i` works for links that have none.
    const target = `https://twitter.com/${status.handle ?? "i"}/status/${status.id}`;
    let url = `${endpoint}?url=${encodeURIComponent(target)}&omit_script=1&dnt=true`;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      for (let hop = 0; ; hop++) {
        const res = await get(url, {
          headers: { accept: "application/json" },
          redirect: "manual",
          signal,
        });
        if (res.status >= 300 && res.status < 400) {
          const next = res.headers.get("location");
          const nextUrl = next ? new URL(next, url) : undefined;
          if (!nextUrl || hop >= MAX_REDIRECTS || !allowed.has(nextUrl.host)) {
            return { ok: false, missing: false };
          }
          if (nextUrl.protocol !== "https:" && nextUrl.host !== new URL(endpoint).host) {
            return { ok: false, missing: false };
          }
          url = nextUrl.href;
          continue;
        }
        if (res.status === 404 || res.status === 403) return { ok: false, missing: true };
        if (!res.ok) return { ok: false, missing: false };
        const body = await res.text();
        if (body.length > MAX_ANSWER_CHARS) return { ok: false, missing: false };
        const post = parseOEmbed(safeJson(body));
        return post ? { ok: true, post } : { ok: false, missing: false };
      }
    } catch {
      return { ok: false, missing: false };
    }
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const AUTHOR_URL = /^https:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})\/?$/i;

/**
 * The author and the post's own text from an oEmbed answer, or undefined when it isn't one. The
 * post is the first paragraph of the embed; the byline after it (display name, date) doesn't count.
 */
export function parseOEmbed(body: unknown): XPost | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { author_url: authorUrl, html } = body as Record<string, unknown>;
  if (typeof authorUrl !== "string" || typeof html !== "string") return undefined;
  const handle = AUTHOR_URL.exec(authorUrl)?.[1];
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1];
  if (!handle || paragraph === undefined) return undefined;
  const text = decodeEntities(paragraph.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""));
  return { handle, text };
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, name: string) => {
    if (name.startsWith("#")) {
      const hex = name[1] === "x" || name[1] === "X";
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

/** Why the post doesn't prove the account, or undefined when it does. */
export function checkXPost(post: XPost, status: XStatus, code: string): string | undefined {
  if (status.handle && status.handle.toLowerCase() !== post.handle.toLowerCase()) {
    return `That link says @${status.handle}, but the post is by @${post.handle}. Paste the link to your own post.`;
  }
  if (!post.text.toLowerCase().includes(code.toLowerCase())) {
    return `That post doesn't have your code ${code} in it. Post the line exactly as shown, then paste the new post's link.`;
  }
  return undefined;
}

export const X_POST_MISSING =
  "X has no public post at that link. Check that the post is up and your account isn't protected, then try again.";
export const X_UNAVAILABLE = "Couldn't read the post from X just now. Try again in a minute.";

/** The alphabet for codes: lowercase letters and digits that can't be mistaken for each other. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A fresh one-time code, like `tk-7kq2m9xa`, from the platform's crypto random source. */
export function newXCode(): string {
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let code = "";
  while (code.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && code.length < 8) code += CODE_ALPHABET[byte % n];
    }
  }
  return `tk-${code}`;
}
