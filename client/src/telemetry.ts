/// <reference types="vite/client" />
/**
 * Analytics and error reporting. Neither carries anything personal:
 * no names, colors, chat, notes, tokens, or resident ids ever leave through here.
 *
 * - Google Analytics starts from `startAnalytics`, only on the production site. Every hit, including
 *   the ones gtag.js sends on its own (user_engagement, scroll, outbound clicks), inherits a
 *   templated page ("/r/:id"), a fixed title, and an empty referrer, because we `set` them before
 *   any event and again on every route change. We send page views plus the two events below.
 * - Sentry reports errors from production builds only, with chat-bearing breadcrumbs dropped,
 *   clicks reduced to tag, id, and classes, and any token scrubbed.
 */
import type { Breadcrumb, BreadcrumbHint, ErrorEvent } from "@sentry/browser";
import { savedToken } from "./net";

type GtagEvent = "join" | "bring_ai_copy";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

const GA_ID = "G-QMRE88BYL1";

/** The only hosts that report to GA and Sentry. An allowlist, so dev servers on a LAN address, a
 * phone, Tailscale, `pnpm start`, previews, and tests never send anything. */
const PRODUCTION_HOSTS = new Set(["terrakin.org"]);

/** True only for a production build served from the real site. */
export function isProductionSite(host: string, prodBuild: boolean = import.meta.env.PROD): boolean {
  return prodBuild && PRODUCTION_HOSTS.has(host);
}

/**
 * The page fields every analytics hit carries. `template` is a route template from the router
 * ("/r/:id"), never a real path. The title is fixed per template, because page titles carry
 * resident names, and the referrer is always empty, because it can hold a real profile or post URL.
 */
export function pageFields(origin: string, template: string) {
  return {
    page_location: `${origin}${template}`,
    page_title: PAGE_TITLES[template] ?? "Terrakin",
    page_referrer: "",
  };
}

/**
 * Load gtag.js, with the page fields set before anything else so no hit can carry the real URL.
 * `template` is the route template of the page we started on.
 */
export function startAnalytics(template: string) {
  try {
    if (!isProductionSite(window.location.hostname)) return;
    const layer: unknown[] = window.dataLayer ?? [];
    window.dataLayer = layer;
    window.gtag = function gtag() {
      // biome-ignore lint/complexity/noArguments: gtag.js only understands the arguments object.
      layer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("set", pageFields(window.location.origin, template));
    window.gtag("config", GA_ID, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      send_page_view: false,
    });
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.append(s);
  } catch {
    // Analytics must never break the game.
  }
}

/** Fire an anonymous analytics event. Never pass parameters: the event name is the whole payload. */
export function track(event: GtagEvent) {
  try {
    window.gtag?.("event", event);
  } catch {
    // Analytics must never break the game.
  }
}

/**
 * Count a page view. `set` comes first so every later hit (engagement, scroll, clicks) reports the
 * same template instead of the real address.
 */
export function pageView(template: string) {
  try {
    const gtag = window.gtag;
    if (!gtag) return;
    const fields = pageFields(window.location.origin, template);
    gtag("set", fields);
    gtag("event", "page_view", fields);
  } catch {
    // Analytics must never break the game.
  }
}

const PAGE_TITLES: Record<string, string> = {
  "/": "Feed",
  "/r/:id": "Profile",
  "/r/:id/3d": "Plot in 3D",
  "/gallery/3d": "Gallery in 3D",
  "/@:handle": "Profile",
  "/p/:id": "Post",
  "/claim/:code": "Claim",
  "/notifications": "Notifications",
  "/world": "World",
  "/docs": "Docs",
  "/letters": "Letters",
  "/letters/:id": "Letters",
  "/i/:code": "Invite",
  "/not-found": "Not found",
};

/** Swap resident, post, notification, and media ids, and handles, in a URL or path for placeholders. */
export function templateIds(text: string): string {
  // Invite codes are capabilities, letter ids are private, and handles name people: template them.
  return text
    .replace(/(\/by-handle\/)[^/?#\s"]+/g, "$1:handle")
    .replace(
      /(\/(?:r|p|i|media|residents|posts|letters|invites)\/)(?!by-handle\/)[A-Za-z0-9_-]+/g,
      "$1:id",
    )
    .replace(/([?&]with=)[A-Za-z0-9_-]+/g, "$1:id")
    .replace(/\/@[A-Za-z0-9_%]+/g, "/@:handle")
    .replace(/\bn_[0-9a-f]{16}\b/g, ":id");
}

const SENTRY_DSN =
  "https://30d8206b7ef3de8e82039fbb7b9b347c@o4512190538514432.ingest.us.sentry.io/4512199441252352";

/** Breadcrumb kinds that can't carry chat, names, or notes. Everything else is dropped. */
const SAFE_BREADCRUMBS = new Set(["navigation", "fetch", "xhr", "ui.click"]);
const SECRET_KEY = /token|authorization|cookie/i;
const TOKEN_IN_TEXT = /(token\\?"?\s*[:=]\s*\\?"?)[\w.~+/-]{6,}/gi;

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : scrubValue(v, depth + 1);
  }
  return out;
}

/** Remove the saved token anywhere it appears, and any value stored under a token-like key. */
export function scrubEvent<T extends object>(event: T, token: string | null): T {
  let json = JSON.stringify(event);
  if (token) json = json.split(token).join("[redacted]");
  json = json.replace(TOKEN_IN_TEXT, "$1[redacted]");
  json = templateIds(json);
  return scrubValue(JSON.parse(json), 0) as T;
}

/** Class names and ids we keep in a click breadcrumb: plain identifiers only. */
const SAFE_TOKEN = /^[A-Za-z][\w-]{0,40}$/;

interface ElementLike {
  tagName?: unknown;
  id?: unknown;
  className?: unknown;
}

/**
 * Describe a clicked element as `tag#id.class.class`, and nothing else. Sentry's own click message
 * adds attributes like aria-label and title, which hold resident names and file names.
 */
export function describeElement(target: unknown): string | null {
  if (!target || typeof target !== "object") return null;
  const el = target as ElementLike;
  if (typeof el.tagName !== "string" || !el.tagName) return null;
  let out = el.tagName.toLowerCase();
  if (typeof el.id === "string" && SAFE_TOKEN.test(el.id)) out += `#${el.id}`;
  // SVG elements have an SVGAnimatedString here, not a string: skip their classes.
  if (typeof el.className === "string") {
    for (const c of el.className.split(/\s+/)) if (SAFE_TOKEN.test(c)) out += `.${c}`;
  }
  return out;
}

export function filterBreadcrumb(crumb: Breadcrumb, hint?: BreadcrumbHint): Breadcrumb | null {
  if (!crumb.category || !SAFE_BREADCRUMBS.has(crumb.category)) return null;
  if (crumb.category === "ui.click") {
    // Rebuild the message from the element itself. No element, no breadcrumb.
    const event = hint?.event as { target?: unknown } | undefined;
    const message = describeElement(event?.target);
    if (!message) return null;
    const { data: _data, ...rest } = crumb;
    return { ...rest, message };
  }
  if (crumb.data) {
    const data = { ...crumb.data };
    // Request URLs and navigation paths carry resident and post ids: template them.
    for (const key of ["url", "from", "to"]) {
      const value = data[key];
      if (typeof value === "string") data[key] = templateIds(value.split("?")[0] ?? "");
    }
    crumb.data = data;
  }
  return crumb;
}

/** Start error reporting in production builds. Loaded as its own chunk so it never delays the first paint. */
export async function initErrorReporting() {
  if (!isProductionSite(window.location.hostname)) return;
  try {
    const { startSentry } = await import("./sentry");
    startSentry({
      dsn: SENTRY_DSN,
      environment: import.meta.env.MODE,
      // Sentry 11 replaced `sendDefaultPii` with per-category switches. All of them off: no user
      // info, IPs, cookies, headers, bodies, query strings, or local variables.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
        genAI: { inputs: false, outputs: false },
      },
      tracesSampleRate: 0,
      beforeBreadcrumb: (crumb, hint) => filterBreadcrumb(crumb, hint),
      beforeSend: (event: ErrorEvent) => scrubEvent(event, savedToken()),
    });
  } catch {
    // A blocked or failed load just means no error reports.
  }
}
