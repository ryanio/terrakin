/**
 * Error reports, traces, breadcrumbs, logs, and metrics for the server (decision 0037). Calls go
 * through @sentry/core, which does nothing until an adapter starts a client: the Worker does, while
 * Node and the tests never do, so everything here is safe to call from shared code.
 *
 * What may leave: route templates and ids, methods, status codes, error codes, sim command types,
 * timings, and stack traces. What never leaves: tokens, link keys, invite and claim codes, resident,
 * post, and other ids, handles, IPs, headers, bodies, query strings, or resident text. The scrubbers
 * below enforce that on every event, span, breadcrumb, log, and metric, and `telemetry.test.ts`
 * pins them.
 */
import {
  addBreadcrumb,
  type Breadcrumb,
  captureException,
  type ErrorEvent,
  getActiveSpan,
  getRootSpan,
  type Log,
  type Metric,
  metrics,
  type Options,
  type StreamedSpanJSON,
  startNewTrace,
  startSpan,
  updateSpanName,
} from "@sentry/core";
import { compileRoutes, ROUTES, type RouteSpec } from "@terrakin/protocol";

export type CrumbCategory = "api" | "world" | "live" | "sweep" | "card" | "page";
type Attributes = Record<string, string | number | boolean>;

/** Run `fn` inside a span. Sync in, sync out; a promise in, a promise out. */
export function span<T>(name: string, op: string, fn: () => T, attributes?: Attributes): T {
  return startSpan({ name, op, ...(attributes ? { attributes } : {}) }, fn);
}

/** Background work (the minute sweep) starts its own trace instead of joining whatever ran last. */
export function task<T>(name: string, fn: () => T): T {
  return startNewTrace(() => span(name, "task", fn));
}

/** A breadcrumb. `message` and `data` must be templates, codes, and counts, never resident text. */
export function crumb(category: CrumbCategory, message: string, data?: Attributes) {
  addBreadcrumb({ category, message, level: "info", ...(data ? { data } : {}) });
}

/** Report an error we caught and answered, so it isn't lost behind a polite 500. */
export function report(err: unknown, where: string, attributes?: Attributes) {
  captureException(err, { tags: { where, ...attributes } });
}

/** Count something. Attribute values must be templates or codes, never ids. */
export function count(name: string, attributes: Attributes) {
  metrics.count(name, 1, { attributes });
}

/** Record a level, like how far behind a queue is. Attribute values must be templates or codes. */
export function gauge(name: string, value: number, attributes: Attributes = {}) {
  metrics.gauge(name, value, { attributes });
}

/**
 * Name the request's root span after its route template (`GET /v1/posts/{id}`), so traces group by
 * route and the real path, which can hold a link key, never becomes the name.
 */
export function nameRequest(route: RouteSpec) {
  const active = getActiveSpan();
  if (!active) return;
  const root = getRootSpan(active);
  updateSpanName(root, `${route.method} ${route.path}`);
  root.setAttributes({ "http.route": route.path, "terrakin.route": route.id });
}

// ---------- scrubbing ----------

const matchApi = compileRoutes(ROUTES as readonly RouteSpec[]);

/** Page and file paths outside the route table, most specific first. */
const PATH_TEMPLATES: [RegExp, string][] = [
  [/^\/v1\/act\/[^/]+/, "/v1/act/{key}"],
  [/^\/og\/(profile|post)\/[^/]+\.png$/, "/og/$1/{id}.png"],
  [/^\/(r|p|letters|media)\/[^/]+/, "/$1/{id}"],
  [/^\/(i|claim)\/[^/]+/, "/$1/{code}"],
  [/^\/u\/[^/]+/, "/u/{handle}"],
];

/**
 * A path with every id, key, code, and handle swapped for its placeholder, and no query string.
 * API paths come back as their route template.
 */
export function templatePath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "";
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    const hit = matchApi(method, bare);
    if (hit) return hit.route.path;
  }
  for (const [pattern, template] of PATH_TEMPLATES) {
    if (pattern.test(bare)) return bare.replace(pattern, template);
  }
  // Anything else: a segment that looks like an id or a key is one.
  return bare
    .split("/")
    .map((s) =>
      !s.includes(".") && (s.length >= 24 || (s.length >= 8 && /\d/.test(s))) ? "{id}" : s,
    )
    .join("/");
}

/** A span name like `GET /r/r_0123456789abcdef`, with its path templated. */
function templateSpanName(name: string): string {
  const m = /^([A-Z]+) (\/\S*)$/.exec(name);
  return m ? `${m[1]} ${templatePath(m[2] ?? "")}` : scrubText(name);
}

/** Template a full URL or a bare path; anything that isn't one goes through `scrubText`. */
function templateUrl(value: string): string {
  if (value.startsWith("/")) return templatePath(value);
  try {
    const url = new URL(value);
    return `${url.origin}${templatePath(url.pathname)}`;
  } catch {
    return scrubText(value);
  }
}

const TEXT_RULES: [RegExp, string][] = [
  [/Bearer\s+\S+/gi, "Bearer [redacted]"],
  // Email addresses: staff sign in with theirs (decision 0040), and nothing else needs one.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "{email}"],
  [/\/v1\/act\/[^/\s"'?#]+/g, "/v1/act/{key}"],
  [/\/(i|claim)\/[A-Za-z0-9_-]+/g, "/$1/{code}"],
  [/\/u\/[A-Za-z0-9_]+/g, "/u/{handle}"],
  [/\/by-handle\/[A-Za-z0-9_]+/g, "/by-handle/{handle}"],
  // Server ids: a letter, an underscore, and 16 hex digits (r_, p_, n_, m_, l_, g_).
  [/\b[a-z]_[0-9a-f]{16}\b/g, "{id}"],
  // Tokens and link keys are 32 random bytes in base64url (43 characters or more), hashes 64 hex
  // digits. Trace and event ids are 32, so they survive.
  [/[A-Za-z0-9_-]{40,}/g, "[redacted]"],
  // Owner claim, invite, and re-key codes: four groups of four.
  [/\b[a-z0-9]{4}(?:-[a-z0-9]{4}){3}\b/gi, "{code}"],
  // Invite and owner codes in a path, with or without dashes.
  [/\/invites\/[A-Za-z0-9-]+/g, "/invites/{code}"],
  // A query string after a path or URL.
  [/([\w}/.-])\?[\w%=&.~+/:-]+/g, "$1"],
];

/** Free text (a message, a stack frame, a URL) with ids, keys, codes, handles, and queries removed. */
export function scrubText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TEXT_RULES) out = out.replace(pattern, replacement);
  return out;
}

/** Keys whose values never leave, whatever they hold. */
const DROP_KEY =
  /authorization|cookie|token|secret|password|^ip$|ip_address|client\.address|forwarded|cf-connecting|cf-access-jwt-assertion|cf_authorization|x-terrakin-staff-email|staff_?email|api[-_]?key|query_string|^headers$|^body$|^(request|response)_?body$|^(request|response)\.body$/i;
/** Keys Sentry needs untouched to link an event to its trace. */
const KEEP_KEY = /^(trace_id|span_id|parent_span_id|event_id|segment_id)$/;
/** Keys that hold a URL or a path: templated rather than scrubbed. */
const URL_KEY = /^(url|url\.full|url\.path|http\.url|http\.target|from|to)$/;

function scrubValue(value: unknown, key: string, depth: number): unknown {
  if (typeof value === "string") return URL_KEY.test(key) ? templateUrl(value) : scrubText(value);
  if (depth > 10 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, key, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (DROP_KEY.test(k)) continue;
    out[k] = KEEP_KEY.test(k) ? v : scrubValue(v, k, depth + 1);
  }
  return out;
}

/** Scrub every string in an object, drop every secret-shaped key, and template every URL. */
function scrub<T extends object>(value: T): T {
  return scrubValue(value, "", 0) as T;
}

function scrubEvent(event: ErrorEvent): ErrorEvent {
  const out = scrub(event);
  delete out.user;
  // Cloudflare's timezone for the request comes from the client's IP.
  if (out.contexts) delete out.contexts.culture;
  if (out.request) {
    const { method, url } = out.request;
    out.request = { ...(method ? { method } : {}), ...(url ? { url } : {}) };
  }
  if (out.transaction) {
    out.transaction = templateSpanName(out.transaction);
    // A Worker request is named by its method alone; add the templated path, as on its span.
    const url = out.request?.url;
    if (/^[A-Z]+$/.test(out.transaction) && url) {
      out.transaction = `${out.transaction} ${new URL(url, "https://terrakin.org").pathname}`;
    }
  }
  return out;
}

function scrubSpan(s: StreamedSpanJSON): StreamedSpanJSON {
  const attributes = scrub(s.attributes);
  delete attributes["culture.timezone"];
  let name = templateSpanName(s.name);
  // The Worker names a request span by its method alone. Add the templated path so it groups.
  const path = attributes["url.path"];
  if (/^[A-Z]+$/.test(name) && typeof path === "string") {
    name = `${name} ${path}`;
    if (s.is_segment) attributes["sentry.segment.name"] = name;
  }
  return { ...s, name, attributes };
}

function scrubBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  // Ours carry only templates and codes. Console crumbs can carry anything, so they go.
  if (b.category === "console") return null;
  const data = b.data ? scrub(b.data) : undefined;
  return {
    ...b,
    ...(b.message ? { message: scrubText(b.message) } : {}),
    ...(data ? { data } : {}),
  };
}

// ---------- options ----------

/** Share of requests traced. Errors are always reported, whatever this says. */
export const TRACES_SAMPLE_RATE = 0.25;
/**
 * Work that starts outside a request: the minute sweep (1,440 a day) and actions sent over a live
 * socket. A few traces are enough to see what they cost.
 */
export const BACKGROUND_SAMPLE_RATE = 0.02;
const BACKGROUND = new Set(["world.sweep", "world.run"]);
/**
 * Traces per minute we keep because the caller's `sentry-trace` header said so. Anyone can send
 * that header, so without a cap a script could have every request traced and spend the quota.
 */
export const FORCED_TRACES_PER_MINUTE = 60;

/** Counts traces kept on a caller's say-so, per isolate, per minute. */
export class ForcedTraceBudget {
  private minute = -1;
  private used = 0;
  constructor(private readonly now: () => number = Date.now) {}

  take(): boolean {
    const minute = Math.floor(this.now() / 60_000);
    if (minute !== this.minute) {
      this.minute = minute;
      this.used = 0;
    }
    if (this.used >= FORCED_TRACES_PER_MINUTE) return false;
    this.used++;
    return true;
  }
}

const forcedTraces = new ForcedTraceBudget();

/**
 * The Sentry options for the Worker and the World object. `dsn` undefined means no client and no
 * reports. Every outgoing kind of data has a scrubber here.
 */
export function sentryOptions(
  dsn: string | undefined,
  release: string | undefined,
  budget: ForcedTraceBudget = forcedTraces,
): Partial<Options> {
  return {
    ...(dsn ? { dsn } : {}),
    ...(release ? { release } : {}),
    environment: "production",
    // All off: no user info, IPs, cookies, headers, bodies, query strings, or local variables.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
    },
    tracesSampler: ({ name, parentSampled }) => {
      // A parent that said no is followed. One that said yes is followed within the budget.
      if (parentSampled === false) return false;
      if (parentSampled === true && budget.take()) return true;
      return BACKGROUND.has(name) && parentSampled === undefined
        ? BACKGROUND_SAMPLE_RATE
        : TRACES_SAMPLE_RATE;
    },
    beforeSend: (event) => scrubEvent(event),
    beforeSendSpan: (s) => scrubSpan(s),
    beforeBreadcrumb: (b) => scrubBreadcrumb(b),
    beforeSendLog: (log: Log) => scrub(log),
    beforeSendMetric: (metric: Metric) => scrub(metric),
  };
}
