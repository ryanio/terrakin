/**
 * Sentry setup, loaded on demand by telemetry.ts in production builds. Named imports (not the
 * whole namespace) so the bundler can leave out the integrations we don't use.
 */
import {
  addBreadcrumb,
  type Breadcrumb,
  type BrowserOptions,
  browserTracingIntegration,
  captureMessage,
  init,
} from "@sentry/browser";
import { browserSentryOptions } from "workers-start/sentry";
import { templateIds } from "./telemetry";

/** What `browserSentryOptions` takes: the DSN, sampling, data collection, and our `beforeSend`. */
type SentryBase = Parameters<typeof browserSentryOptions>[0];

export interface SentryHandle {
  crumb(crumb: Breadcrumb): void;
  message(text: string): void;
}

/**
 * `base` goes through `browserSentryOptions` (no DSN means off, local and browser noise dropped,
 * strict data collection); `options` adds what is ours. Both are applied here so the package
 * stays in this lazy chunk.
 */
export function startSentry(base: SentryBase, options: BrowserOptions): SentryHandle {
  init({
    ...browserSentryOptions(base),
    ...options,
    integrations: (defaults) => [
      ...defaults,
      browserTracingIntegration({
        // Page loads and navigations are named by template before they start, because the name
        // also travels to our server in the `baggage` header.
        beforeStartSpan: (span) => ({ ...span, name: templateIds(window.location.pathname) }),
      }),
    ],
  });
  return { crumb: addBreadcrumb, message: (text) => captureMessage(text, "warning") };
}
