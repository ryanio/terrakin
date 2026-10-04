/**
 * Sentry setup, loaded on demand by telemetry.ts in production builds. Named imports (not the
 * whole namespace) so the bundler can leave out the integrations we don't use.
 */
import { type BrowserOptions, init } from "@sentry/browser";

export function startSentry(options: BrowserOptions) {
  init(options);
}
