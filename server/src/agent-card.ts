/**
 * Fetching an agent's card (RFC 0007): the ERC-8004 registration file its registry points to. We
 * read two things from it, its `name` and any `services` entry named `terrakin`, and drop the rest.
 * The card is outside data: never stored whole, never rendered as HTML, never followed as
 * instructions.
 *
 * The rules for fetching: `https:` only (or an inline `data:application/json` URI), the default
 * port, a host name rather than an IP address, at most 3 redirects and each one held to the same
 * rules, a 64 KB cap, and a 5 second timeout for the whole read, DNS checks included. The body must
 * parse as JSON (whatever its Content-Type says, since IPFS gateways often send text/plain), and an
 * HTML answer is refused outright. On Node, the server also refuses host names
 * that resolve to private addresses, both before asking (`allowHost`) and on the address it really
 * connects to (`publicLookup` in node-net.ts, set in main.ts); the Worker can't reach private
 * networks at all.
 *
 * Runs on Node and in the Worker: plain `fetch`, no Node APIs.
 */

import { readCapped } from "./media";

/** What we keep from a card. */
export interface AgentCard {
  /** The card's `name`, raw. Untrusted: clean it before it's stored or shown. */
  name: string;
  /** Every endpoint of a service named `terrakin`. */
  terrakin: string[];
}

export type CardRead =
  | { ok: true; card: AgentCard }
  /**
   * `bad`: we reached it, and it isn't a card we can read (a refused URL, not JSON, too big). Its
   * message says why, in plain words. Otherwise the host failed or was too slow.
   */
  | { ok: false; bad: boolean; message: string };

/** Fetches a card. Injected, so tests never touch the network. */
export type CardReader = (uri: string) => Promise<CardRead>;

export const CARD_MAX_BYTES = 64 * 1024;
const CARD_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

export interface CardReaderOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /**
   * Whether a host name may be fetched, checked before every request. Node passes a DNS check that
   * refuses private, loopback, and link-local addresses. Default: allow (the Worker).
   */
  allowHost?: (hostname: string) => Promise<boolean>;
  /**
   * Tests only: one loopback `http:` origin the reader may also fetch from (the e2e suite's fake
   * card host). main.ts sets it only with TERRAKIN_TEST_CHAIN, never in production.
   */
  testOrigin?: string;
}

const NOT_JSON = "The agent's card isn't JSON.";
const TOO_BIG = "The agent's card is over 64 KB.";
const BAD_URL =
  "The agent's card isn't at an https address Terrakin can read. Cards must be at https:// on the usual port, or inline as data:application/json.";
const UNREACHABLE = "Couldn't read the agent's card just now. Try again in a minute.";

const bad = (message: string): CardRead => ({ ok: false, bad: true, message });
const down: CardRead = { ok: false, bad: false, message: UNREACHABLE };

/** Why `url` can't be fetched, or undefined when it can. */
export function cardUrlProblem(url: URL, testOrigin?: string): string | undefined {
  if (testOrigin && url.origin === testOrigin) return undefined;
  if (url.protocol !== "https:") return BAD_URL;
  if (url.username !== "" || url.password !== "" || url.port !== "") return BAD_URL;
  // Trailing dots name the same host (`localhost.`), so it is checked without them.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  // IP addresses (v4 or [v6]) and names that only mean something on a private network.
  if (/^[\d.]+$/.test(host) || host.startsWith("[") || !host.includes(".")) return BAD_URL;
  if (/\.(?:local|localhost|internal|home|lan|intranet|corp|test)$/.test(host)) return BAD_URL;
  return undefined;
}

/** What `fetchOutside` found: the body, or why not. */
export type OutsideRead =
  | { ok: true; bytes: Uint8Array; type: string }
  /** `refused`: the URL (or a redirect) breaks the rules. `missing`: 404 or 410. `down`: anything else. */
  | { ok: false; why: "refused" | "missing" | "html" | "too_big" | "down" };

export interface OutsideFetch {
  get: typeof fetch;
  timeoutMs: number;
  allowHost: (hostname: string) => Promise<boolean>;
  testOrigin: string | undefined;
  accept: string;
  maxBytes: number;
}

/**
 * Fetch something from outside Terrakin by the card rules (the comment at the top): https on the
 * usual port, a host name, every redirect held to the same rules, `allowHost` before every request,
 * one timeout for the whole read, HTML refused, and the body read only up to `maxBytes`. Cards
 * (here) and partner art (partner-art.ts) both read through it.
 */
export async function fetchOutside(uri: string, o: OutsideFetch): Promise<OutsideRead> {
  if (!URL.canParse(uri)) return { ok: false, why: "refused" };
  let url = new URL(uri);
  const signal = AbortSignal.timeout(o.timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      if (cardUrlProblem(url, o.testOrigin)) return { ok: false, why: "refused" };
      if (url.origin !== o.testOrigin && !(await withinTime(o.allowHost(url.hostname), signal))) {
        return { ok: false, why: "refused" };
      }
      const res = await o.get(url.href, {
        headers: { accept: o.accept },
        redirect: "manual",
        signal,
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const next = res.headers.get("location");
        if (!next || hop >= MAX_REDIRECTS || !URL.canParse(next, url.href)) {
          return { ok: false, why: "refused" };
        }
        url = new URL(next, url);
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        await res.body?.cancel();
        return { ok: false, why: "missing" };
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, why: "down" };
      }
      const type = res.headers.get("content-type") ?? "";
      if (/^text\/html/i.test(type)) {
        await res.body?.cancel();
        return { ok: false, why: "html" };
      }
      const bytes = await readCapped(res.body, o.maxBytes);
      if (!bytes) return { ok: false, why: "too_big" };
      return { ok: true, bytes, type };
    }
  } catch {
    return { ok: false, why: "down" };
  }
}

/** The real reader. */
export function httpCardReader(options: CardReaderOptions = {}): CardReader {
  const fetching: OutsideFetch = {
    get: options.fetch ?? ((input, init) => fetch(input, init)),
    timeoutMs: options.timeoutMs ?? CARD_TIMEOUT_MS,
    allowHost: options.allowHost ?? (async () => true),
    testOrigin: options.testOrigin,
    accept: "application/json",
    maxBytes: CARD_MAX_BYTES,
  };
  return async (uri) => {
    if (uri.length > CARD_MAX_BYTES * 2) return bad(TOO_BIG);
    if (/^data:/i.test(uri)) return readDataUri(uri);
    const read = await fetchOutside(uri, fetching);
    if (read.ok) return parsed(read.bytes);
    switch (read.why) {
      case "refused":
        return bad(BAD_URL);
      case "missing":
        return bad("The agent's card isn't there (its address answers 404).");
      case "html":
        return bad(NOT_JSON);
      case "too_big":
        return bad(TOO_BIG);
      case "down":
        return down;
    }
  };
}

/** `promise`, or false once `signal` aborts: a slow DNS answer counts against the same 5 seconds. */
function withinTime(promise: Promise<boolean>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const stop = () => resolve(false);
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      (ok) => {
        signal.removeEventListener("abort", stop);
        resolve(ok);
      },
      () => resolve(false),
    );
  });
}

/** `data:application/json[;charset=utf-8][;base64],...` */
function readDataUri(uri: string): CardRead {
  const comma = uri.indexOf(",");
  if (comma < 0) return bad(BAD_URL);
  const meta = uri.slice(5, comma).toLowerCase().split(";");
  if (meta[0] !== "application/json") return bad(BAD_URL);
  const payload = uri.slice(comma + 1);
  let bytes: Uint8Array;
  try {
    if (meta.includes("base64")) {
      const binary = atob(payload);
      bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
  } catch {
    return bad(NOT_JSON);
  }
  if (bytes.byteLength > CARD_MAX_BYTES) return bad(TOO_BIG);
  return parsed(bytes);
}

function parsed(bytes: Uint8Array): CardRead {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return bad(NOT_JSON);
  }
  const card = parseCard(body);
  return card ? { ok: true, card } : bad("The agent's card isn't a registration file.");
}

/** The two things we read from a registration file, or undefined when it isn't one. */
export function parseCard(body: unknown): AgentCard | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const { name, services, endpoints } = body as {
    name?: unknown;
    services?: unknown;
    endpoints?: unknown;
  };
  const terrakin: string[] = [];
  // `services` is the current ERC-8004 name; earlier registration files call the list `endpoints`.
  for (const list of [services, endpoints]) {
    if (!Array.isArray(list)) continue;
    for (const service of list.slice(0, 100)) {
      if (!service || typeof service !== "object") continue;
      const { name: serviceName, endpoint } = service as { name?: unknown; endpoint?: unknown };
      if (serviceName === "terrakin" && typeof endpoint === "string" && endpoint.length <= 200) {
        terrakin.push(endpoint);
      }
    }
  }
  return { name: typeof name === "string" ? name.slice(0, 500) : "", terrakin };
}

/** The endpoint a card must list to name a resident: their profile on terrakin.org, exactly. */
export const residentEndpoint = (residentId: string) => `https://terrakin.org/r/${residentId}`;

/** Whether the card names this resident. Exact match only: no other host, path, or trailing slash. */
export const cardNames = (card: AgentCard, residentId: string) =>
  card.terrakin.includes(residentEndpoint(residentId));

/** Addresses a self-hosted server must never fetch a card from: loopback, private, link-local, and the like. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip);
  if (v4) {
    const [a = 0, b = 0] = v4.slice(1, 3).map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && Number(v4[3]) === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (!v6.includes(":")) return true;
  return (
    v6 === "::" ||
    v6 === "::1" ||
    /^f[cd]/.test(v6) ||
    /^fe[89ab]/.test(v6) ||
    /^fe[c-f]/.test(v6) ||
    /^ff/.test(v6) ||
    v6.startsWith("::ffff:") ||
    v6.startsWith("64:ff9b:")
  );
}
