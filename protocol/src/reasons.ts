import { z } from "zod";

/**
 * The community rules a report names and a takedown notice cites (RFC 0006). Its own module so
 * both `safety.ts` and the notifications in `social.ts` can use it without importing each other.
 * `self_harm` is reviewed first.
 */
export const REPORT_REASONS = [
  "spam",
  "scam",
  "hate",
  "harassment",
  "sexual",
  "self_harm",
  "impersonation",
  "other",
] as const;
export const ReportReason = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReason>;
