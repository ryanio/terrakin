/// <reference types="vite/client" />
/**
 * Analytics and error reporting. Neither carries anything personal:
 * no names, colors, chat, notes, tokens, or resident ids ever leave through here.
 *
 * - Google Analytics is loaded by index.html (skipped on local hosts). We only send page views
 *   (as route templates like "/r/:id", never real ids) plus the two events below.
 * - Sentry reports errors from production builds only, with chat-bearing breadcrumbs dropped and
 *   any token scrubbed.
 */
import type { Breadcrumb, ErrorEvent } from "@sentry/browser";
import { savedToken } from "./net";

type GtagEvent = "join" | "bring_ai_copy";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
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
 * Count a page view. `template` is a route template from the router ("/r/:id"), never a real path,
 * and the title is fixed per template: page titles carry resident names, so we never send them.
 * index.html turns off the automatic page view for the same reason.
 */
export function pageView(template: string) {
  try {
    const location = `${window.location.origin}${template}`;
    window.gtag?.("event", "page_view", {
      page_location: location,
      page_path: template,
      page_title: PAGE_TITLES[template] ?? "Terrakin",
    });
  } catch {
    // Analytics must never break the game.
  }
}

const PAGE_TITLES: Record<string, string> = {
  "/": "Feed",
  "/r/:id": "Profile",
  "/p/:id": "Post",
  "/world": "World",
  "/not-found": "Not found",
};

/** Swap resident, post, and media ids in a URL or path for `:id`. */
export function templateIds(text: string): string {
  return text.replace(/(\/(?:r|p|media|residents|posts)\/)[A-Za-z0-9_-]+/g, "$1:id");
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

export function filterBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (!crumb.category || !SAFE_BREADCRUMBS.has(crumb.category)) return null;
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
  if (!import.meta.env.PROD) return;
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
      beforeBreadcrumb: (crumb) => filterBreadcrumb(crumb),
      beforeSend: (event: ErrorEvent) => scrubEvent(event, savedToken()),
    });
  } catch {
    // A blocked or failed load just means no error reports.
  }
}
