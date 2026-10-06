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
import { templateIds } from "./telemetry";

export interface SentryHandle {
  crumb(crumb: Breadcrumb): void;
  message(text: string): void;
}

export function startSentry(options: BrowserOptions): SentryHandle {
  init({
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
