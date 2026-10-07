import {
  type ErrorCode,
  errorStatus,
  linkHeader,
  markdownError,
  PROTOCOL_VERSION,
  type RateLimitName,
  type RouteSpec,
} from "@terrakin/protocol";
import type { Failure, HandlerReply } from "./handlers/shared";
import type { StoredResponse } from "./idempotency";
import type { RateLimiters, Take } from "./rate-limit";

/**
 * How the dispatcher in `api.ts` turns replies into HTTP: the response shape, the headers every
 * answer or error carries, and `render`, which answers with the route's declared response.
 */

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  /** Text, or raw bytes for a binary reply (letter images). */
  body: string | Uint8Array;
}

/** Headers every API response carries. */
export const API_HEADERS = {
  "api-version": String(PROTOCOL_VERSION),
  link: linkHeader(),
} as const;

/** `RateLimit-Policy` and `RateLimit` (IETF httpapi-ratelimit-headers), from one bucket's take. */
export function rateLimitHeaders(name: RateLimitName, limiter: RateLimiters, take: Take) {
  const window = Math.ceil(limiter.capacity / limiter.perSecond);
  return {
    "ratelimit-policy": `"${name}";q=${limiter.capacity};w=${window}`,
    ratelimit: `"${name}";r=${take.remaining};t=${take.reset}`,
  };
}

function json(status: number, body: unknown): ApiResponse {
  return {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

/** How long a 429 tells the client to wait when nothing more precise is known. */
const DEFAULT_RETRY_SECONDS = 60;

/** The headers every error carries: how to authenticate on a 401, when to come back on a 429. */
function errorHeaders(code: ErrorCode, retryAfter?: number): Record<string, string> {
  const status = errorStatus(code);
  if (status === 401) return { "www-authenticate": 'Bearer realm="terrakin"' };
  if (status === 429) {
    return { "retry-after": String(Math.max(1, retryAfter ?? DEFAULT_RETRY_SECONDS)) };
  }
  return {};
}

export function error(
  code: ErrorCode,
  message: string,
  retryAfter?: number,
  didYouMean?: string,
): ApiResponse {
  const body = { code, message, ...(didYouMean ? { did_you_mean: didYouMean } : {}) };
  return withHeaders(json(errorStatus(code), { error: body }), errorHeaders(code, retryAfter));
}

export function withHeaders(response: ApiResponse, headers: Record<string, string>): ApiResponse {
  return { ...response, headers: { ...response.headers, ...headers } };
}

/** The `error.code` of a JSON error reply, for traces and metrics. Markdown errors carry none. */
export function errorCode(response: ApiResponse): string | undefined {
  if (response.status < 400 || typeof response.body !== "string") return undefined;
  if (!response.headers["content-type"]?.startsWith("application/json")) return undefined;
  try {
    const code = (JSON.parse(response.body) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Replay a first response, unless it's one the client should be free to simply retry. */
export const keepable = (response: ApiResponse) => response.status < 500 && response.status !== 429;

export const stored = (response: ApiResponse): StoredResponse => ({
  status: response.status,
  contentType: response.headers["content-type"],
  // Only JSON and text replies are stored: idempotency keys apply to writes, never to file reads.
  body: typeof response.body === "string" ? response.body : "",
});

/**
 * Headers on every answer of a Markdown link route. These pages can hold a link key, so nothing
 * may cache them, index them, or pass their URL on as a referrer.
 */
const PRIVATE_PAGE = {
  "content-type": "text/markdown; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

/**
 * Whether an `If-None-Match` header names `tag`: any one of its tags, weak or strong (a proxy that
 * compresses the answer may weaken the `ETag` it saw), or `*`.
 */
function etagMatches(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const one = t.trim();
    return one === "*" || one.replace(/^W\//, "") === tag;
  });
}

/**
 * Turn a handler's reply into HTTP, using the route's declared response for that status. A JSON
 * reply with an `etag` gets one, and a 304 when `ifNoneMatch` already names it.
 */
export function render(
  route: RouteSpec,
  reply: HandlerReply | Failure,
  help?: string,
  ifNoneMatch?: string,
): ApiResponse {
  if ("error" in reply) {
    if (route.format !== "markdown") return error(reply.error, reply.message, reply.retryAfter);
    return {
      status: errorStatus(reply.error),
      headers: { ...PRIVATE_PAGE, ...errorHeaders(reply.error, reply.retryAfter) },
      body: markdownError(reply.error, reply.message, help),
    };
  }
  const spec = route.responses[reply.status];
  if (!spec) throw new Error(`Route ${route.id} declares no ${reply.status} response.`);
  if (spec.kind === "json") {
    if (!spec.etag) return json(reply.status, reply.body);
    // Public data that's the same for everyone, like the catalog: a cache keeps it, and asks each
    // time whether it's still current.
    const headers = { etag: `"${spec.etag(reply.body)}"`, "cache-control": "public, no-cache" };
    if (etagMatches(ifNoneMatch, headers.etag)) return { status: 304, headers, body: "" };
    const out = json(reply.status, reply.body);
    return { ...out, headers: { ...out.headers, ...headers } };
  }
  if (spec.kind === "empty") return { status: reply.status, headers: {}, body: "" };
  if (route.format === "markdown") {
    return { status: reply.status, headers: PRIVATE_PAGE, body: reply.text ?? "" };
  }
  if (spec.kind === "binary") {
    // Private to the two residents: never cached (a shared browser must not hand it to the next
    // person), and inert if opened directly.
    return {
      status: reply.status,
      headers: {
        "content-type": reply.contentType ?? "application/octet-stream",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        // no-store: a shared browser must not hand one person's letter picture to the next.
        "cache-control": "no-store",
      },
      body: reply.bytes ?? new Uint8Array(0),
    };
  }
  const type =
    spec.contentType.startsWith("text/") || spec.contentType.endsWith("/xml")
      ? `${spec.contentType}; charset=utf-8`
      : spec.contentType;
  const cache =
    spec.maxAge === undefined ? {} : { "cache-control": `public, max-age=${spec.maxAge}` };
  return {
    status: reply.status,
    headers: { "content-type": type, ...cache },
    body: reply.text ?? "",
  };
}
