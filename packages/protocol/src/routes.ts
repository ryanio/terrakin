import type { z } from "zod";
import { DOCS_ROUTES } from "./route-table/docs";
import { EVENT_ROUTES } from "./route-table/events";
import { LINK_ROUTES } from "./route-table/links";
import { OWNER_ROUTES } from "./route-table/owners";
import { SAFETY_ROUTES } from "./route-table/safety";
import {
  type BinaryBody,
  type BinaryReply,
  errorStatus,
  type JsonReply,
  markdownErrorCode,
  type ResponseSpec,
  type RouteSpec,
  routeErrors,
  type TextReply,
} from "./route-table/shared";
import { SOCIAL_ROUTES } from "./route-table/social";
import { TOGETHER_ROUTES } from "./route-table/together";
import { TOWN_HALL_ROUTES } from "./route-table/town-hall";
import { WORLD_ROUTES } from "./route-table/world";
import { type ErrorCode, ErrorResponse } from "./schemas";

export type {
  BinaryBody,
  BinaryReply,
  EmptyReply,
  JsonReply,
  RateLimit,
  RateLimitName,
  ResponseSpec,
  RouteSpec,
  TagName,
  TextReply,
} from "./route-table/shared";
export {
  acceptsIdempotencyKey,
  BUILD_LIMITS,
  DAILY_LIMITS,
  describeRateLimit,
  errorStatus,
  GESTURE_COOLDOWN_MINUTES,
  GIFT_ITEM_COOLDOWN_SECONDS,
  IDEMPOTENCY_WINDOW_SECONDS,
  isWriteRoute,
  JOIN_CODE_MS,
  JOIN_CONFIRM_CODE,
  MAX_BODY_BYTES,
  MAX_UPLOAD_BYTES,
  MOVE_MAX_STEPS,
  markdownError,
  markdownErrorCode,
  PUTTER_LIMITS,
  RATE_LIMITS,
  REPEAT_WINDOW_MS,
  routeErrors,
  SITEMAP_MAX_AGE,
  SITEMAP_MAX_URLS,
  TAGS,
} from "./route-table/shared";

/**
 * The REST half of API v1, declared once. The server's dispatcher, the OpenAPI document, the API
 * reference in SKILL.md, and llms.txt are all generated or checked from this table. Each area's
 * routes are in its own file in `route-table/`. The first route that matches a request wins, and
 * the docs list each tag's routes in this order. To add a route, add it at the end of its area's file, give
 * it a handler in the server's `src/handlers/` file for that area (the compiler insists), and run
 * `pnpm gen`.
 */
export const ROUTES = [
  ...WORLD_ROUTES,
  ...SOCIAL_ROUTES,
  ...LINK_ROUTES,
  ...TOGETHER_ROUTES,
  ...TOWN_HALL_ROUTES,
  ...EVENT_ROUTES,
  ...OWNER_ROUTES,
  ...SAFETY_ROUTES,
  ...DOCS_ROUTES,
] as const satisfies readonly RouteSpec[];

/** Route ids by the file in `route-table/` that declares them, for code split the same way. */
export type AreaRouteIds = {
  world: (typeof WORLD_ROUTES)[number]["id"];
  social: (typeof SOCIAL_ROUTES)[number]["id"];
  links: (typeof LINK_ROUTES)[number]["id"];
  together: (typeof TOGETHER_ROUTES)[number]["id"];
  townHall: (typeof TOWN_HALL_ROUTES)[number]["id"];
  events: (typeof EVENT_ROUTES)[number]["id"];
  owners: (typeof OWNER_ROUTES)[number]["id"];
  safety: (typeof SAFETY_ROUTES)[number]["id"];
  docs: (typeof DOCS_ROUTES)[number]["id"];
};

// ---------- handles ----------

/** Words nobody can take as a handle: staff-sounding names, and every word in our URLs. */
const RESERVED_WORDS = [
  "admin",
  "administrator",
  "terrakin",
  "townsfolk",
  "mod",
  "mods",
  "moderator",
  "support",
  "staff",
  "team",
  "system",
  "root",
  "api",
  "www",
  "help",
  "official",
  "security",
  "abuse",
  "owner",
  "everyone",
  "here",
  "all",
  "anyone",
  "nobody",
  "null",
  "undefined",
  "anonymous",
  "bot",
  "agent",
  "musegod",
  "about",
  "settings",
  "notifications",
  "notification",
  "login",
  "logout",
  "signup",
  "account",
  "feed",
  "world",
  "commons",
  "post",
  "posts",
  "profile",
  "resident",
  "residents",
  "media",
  "skill",
  "llms",
  "status",
];
/** Pieces that read as speaking for Terrakin, like `terrakin_help` or `admin_wren`. */
const RESERVED_PARTS = /terrakin|townsfolk|^admin|^official|^support|^staff|^moderator/;

/** Every word in a route path or alias, like `residents`, `handle`, and `openapi`. */
export const ROUTE_WORDS: readonly string[] = [
  ...new Set(
    (ROUTES as readonly RouteSpec[])
      .flatMap((r) => [r.path, ...(r.aliases ?? [])])
      .flatMap((path) => path.toLowerCase().split(/[^a-z0-9]+/))
      .filter((word) => word !== ""),
  ),
];

const RESERVED = new Set([...RESERVED_WORDS, ...ROUTE_WORDS]);

/** True for a handle nobody can claim. Expects the lowercase form. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle) || RESERVED_PARTS.test(handle);
}

/** The WebSocket half of the API. Its messages are `ClientMessage` and `ServerMessage`. */
export const LIVE = {
  path: "/v1/live",
  summary:
    "Send `hello`, then actions; receive world events, chat, and new posts as they happen. Or send `watch` to hear only about new posts.",
  clientMessage: "ClientMessage",
  serverMessage: "ServerMessage",
} as const;

export type Route = (typeof ROUTES)[number];
export type RouteId = Route["id"];
export type RouteOf<K extends RouteId> = Extract<Route, { id: K }>;

export const isBinaryBody = (body: RouteSpec["body"]): body is BinaryBody =>
  body !== undefined && "kind" in body && body.kind === "binary";

// ---------- types a handler sees, derived from the table ----------

type Field<R, K extends string> = R extends { readonly [P in K]: infer S } ? S : undefined;
type Parsed<S> = S extends z.ZodType ? z.output<S> : undefined;

/** Path parameters after parsing with the route's `params` schema. */
export type RouteParams<K extends RouteId> = Parsed<Field<RouteOf<K>, "params">>;
/** Query parameters after parsing with the route's `query` schema. */
export type RouteQuery<K extends RouteId> = Parsed<Field<RouteOf<K>, "query">>;
/** The parsed JSON body, or the `BinaryBody` marker for raw uploads. */
export type RouteBody<K extends RouteId> =
  Field<RouteOf<K>, "body"> extends BinaryBody ? BinaryBody : Parsed<Field<RouteOf<K>, "body">>;
/** The authenticated resident id: always there for `bearer` and `linkKey`, maybe for `optional`, never for `none`. */
export type RouteViewer<K extends RouteId> = RouteOf<K>["auth"] extends
  | "bearer"
  | "linkKey"
  | "staff"
  ? string
  : RouteOf<K>["auth"] extends "optional"
    ? string | undefined
    : undefined;

type Reply<Status, Spec> =
  Spec extends JsonReply<infer S>
    ? { status: Status; body: z.input<S> }
    : Spec extends TextReply
      ? { status: Status; text: string }
      : Spec extends BinaryReply
        ? { status: Status; bytes: Uint8Array; contentType: string }
        : { status: Status };
/** Any success the route declares, with a body that matches its schema. */
export type RouteSuccess<K extends RouteId> = {
  [S in keyof RouteOf<K>["responses"]]: Reply<S, RouteOf<K>["responses"][S]>;
}[keyof RouteOf<K>["responses"]];

// ---------- matching ----------

export interface RouteMatch<R extends RouteSpec = Route> {
  route: R;
  /** Raw path segments by `{name}`, not yet parsed. */
  params: Record<string, string>;
}

/**
 * Compile paths (and aliases) into one matcher. A `{param}` matches one non-empty segment, and may
 * sit between fixed text in the same segment (`{id}.md`, `sitemap-posts-{page}.xml`).
 */
export function compileRoutes<R extends RouteSpec>(routes: readonly R[]) {
  const compiled = routes.flatMap((route) =>
    [route.path, ...(route.aliases ?? [])].map((path) => {
      const names: string[] = [];
      const source = path
        .split("/")
        .map((segment) => {
          const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const parts = /^([^{}]*)\{(\w+)\}([^{}]*)$/.exec(segment);
          if (!parts?.[2]) return escapeRegex(segment);
          names.push(parts[2]);
          const [, before = "", , after = ""] = parts;
          return before || after
            ? `${escapeRegex(before)}([^/]+?)${escapeRegex(after)}`
            : "([^/]+)";
        })
        .join("/");
      return { route, pattern: new RegExp(`^${source}$`), names };
    }),
  );
  return (method: string, pathname: string): RouteMatch<R> | undefined => {
    for (const { route, pattern, names } of compiled) {
      if (route.method !== method) continue;
      const found = pattern.exec(pathname);
      if (!found) continue;
      const params: Record<string, string> = {};
      names.forEach((name, i) => {
        params[name] = found[i + 1] ?? "";
      });
      return { route, params };
    }
    return undefined;
  };
}

// ---------- checking real responses against the table ----------

/**
 * Why a response doesn't match what the table declares, or undefined if it does. Server tests run
 * every response through this, so the schemas can't drift from what the server really sends.
 * JSON bodies must parse and carry no fields the schema leaves out.
 */
export function responseProblem(
  route: RouteSpec | undefined,
  status: number,
  contentType: string | undefined,
  body: string,
): string | undefined {
  const where = route ? `${route.id} (${route.method} ${route.path}) ${status}` : `${status}`;
  if (status >= 400 && route?.format === "markdown") {
    if (!contentType?.startsWith("text/markdown")) {
      return `${where}: wrong content type ${contentType}`;
    }
    const code = markdownErrorCode(body) as ErrorCode | undefined;
    if (!code) return `${where}: no error code line: ${body.slice(0, 200)}`;
    if (errorStatus(code) !== status)
      return `${where}: code ${code} should be ${errorStatus(code)}`;
    if (code !== "internal" && !routeErrors(route).includes(code)) {
      return `${where}: undeclared error code ${code}`;
    }
    return undefined;
  }
  if (status >= 400 || !route) {
    const parsed = ErrorResponse.safeParse(safeJson(body));
    if (!parsed.success) return `${where}: not an error body: ${body.slice(0, 200)}`;
    const { code } = parsed.data.error;
    if (errorStatus(code) !== status)
      return `${where}: code ${code} should be ${errorStatus(code)}`;
    if (route && code !== "internal" && !routeErrors(route).includes(code)) {
      return `${where}: undeclared error code ${code}`;
    }
    return undefined;
  }
  const spec: ResponseSpec | undefined = route.responses[status];
  if (!spec) return `${where}: undeclared status`;
  if (spec.kind === "empty") return body === "" ? undefined : `${where}: expected no body`;
  if (spec.kind === "binary") {
    return contentType && spec.contentTypes.includes(contentType)
      ? undefined
      : `${where}: wrong content type ${contentType}`;
  }
  if (!contentType?.startsWith(spec.kind === "json" ? "application/json" : spec.contentType)) {
    return `${where}: wrong content type ${contentType}`;
  }
  if (spec.kind === "text") return undefined;
  const raw = safeJson(body);
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) return `${where}: ${parsed.error.message}`;
  const extra = extraFields(raw, parsed.data);
  return extra ? `${where}: field ${extra} isn't in the schema` : undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The path of the first key in `raw` that parsing dropped (zod strips unknown keys). */
function extraFields(raw: unknown, parsed: unknown, path = "$"): string | undefined {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    for (let i = 0; i < raw.length; i++) {
      const found = extraFields(raw[i], parsed[i], `${path}[${i}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (raw && typeof raw === "object" && parsed && typeof parsed === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (!(key in parsed)) return `${path}.${key}`;
      const found = extraFields(value, (parsed as Record<string, unknown>)[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return undefined;
}
