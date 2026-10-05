/**
 * The typed request helper both browser apps use for the REST API. Every response is parsed with
 * a protocol schema; anything that doesn't match is an error, never trusted. Errors carry the
 * server's own words when they're plain words.
 */
import { ErrorBody } from "@terrakin/protocol";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

/** Anything with a zod-style `safeParse`. */
export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
}

/** For replies with no body (204). */
export const Nothing: Schema<null> = { safeParse: () => ({ success: true, data: null }) };

/** The `{ error: { code, message } }` body every failed request carries. */
export function errorOf(json: unknown) {
  const parsed = ErrorBody.safeParse((json as { error?: unknown } | undefined)?.error);
  return parsed.success ? parsed.data : undefined;
}

export const OFFLINE = "Can't reach Terrakin right now. Check your connection and try again.";

/** The server's message when it is plain words; a gentle fallback when it is a schema dump. */
export function friendlyMessage(message: string, fallback: string): string {
  const m = message.trim();
  if (!m || m.startsWith("[") || m.startsWith("{")) return fallback;
  return m;
}

/** `?a=1&b=2` from the defined values, or "". */
export const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

export interface RequestOptions {
  /** Headers for every call, like the bearer token. */
  headers: () => Record<string, string>;
  /** Sees every error the server sends, before the caller does (for app-wide notices). */
  onError?: (code: string, message: string, status: number) => void;
  /** A one-line note per failed call (`GET /v1/feed 503 unavailable`), for error reports. */
  breadcrumb?: (text: string) => void;
  /** A response that didn't match its schema. */
  onBadResponse?: (path: string, error: unknown) => void;
  /**
   * What to tell someone whose key the server doesn't know (a 401), in the app's own words. The
   * server's message is for developers ("bearer token") and says nothing about what to do.
   */
  unauthorized?: string;
}

/** A `request(method, path, schema, body?)` function for one app. */
export function makeRequest(options: RequestOptions) {
  return async function request<T>(
    method: string,
    path: string,
    schema: Schema<T>,
    body?: unknown,
  ): Promise<Result<T>> {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: {
          ...options.headers(),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      options.breadcrumb?.(`${method} ${path} offline`);
      return { ok: false, status: 0, code: "offline", message: OFFLINE };
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const err = errorOf(json);
      options.breadcrumb?.(`${method} ${path} ${res.status} ${err?.code ?? "unknown"}`);
      if (err) options.onError?.(err.code, err.message, res.status);
      return {
        ok: false,
        status: res.status,
        code: err?.code ?? "unknown",
        message:
          res.status === 401 && options.unauthorized
            ? options.unauthorized
            : friendlyMessage(err?.message ?? "", "Something went wrong. Try again."),
      };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      console.warn("Unexpected response from", path, parsed.error);
      options.onBadResponse?.(path, parsed.error);
      return {
        ok: false,
        status: res.status,
        code: "bad_response",
        message: "Something went wrong.",
      };
    }
    return { ok: true, data: parsed.data };
  };
}
