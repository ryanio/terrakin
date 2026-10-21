import { z } from "zod";

/**
 * A report as the resident who makes it sees it (RFC 0006): what can be reported, the community
 * rule it names, the request, and the answer. Its own module, apart from the staff's views in
 * `safety.ts`, so the web's Report sheet and the takedown notices in `social.ts` take these and
 * nothing of the review queue.
 */

/** What can be reported. */
export const REPORT_KINDS = [
  "post",
  "resident",
  "letter",
  "notice",
  "proposal",
  "listing",
  "bounty",
  /** A made thing on display on a pedestal or a frame, by its id (`i_7`). */
  "display",
  /** A piece of art, by its id (`i_7`), wherever it is: its picture and its title. */
  "piece",
  /** A hosted event, by its id (`e_7`): its title and text (RFC 0010). */
  "event",
  /** A circle, by its id (`c_3`): its name and its notice (RFC 0033). */
  "circle",
  /** A plot for sale, by its plot coordinates written `px,py` (`3,4`): its price and name (RFC 0039). */
  "plot_listing",
] as const;
export const ReportKind = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof ReportKind>;

/**
 * Why: the community rule it broke, which a takedown notice cites too. `self_harm` is reviewed
 * first.
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

export const REPORT_NOTE_MAX_LENGTH = 500;

export const CreateReportRequest = z.object({
  kind: ReportKind,
  /**
   * The id of what you're reporting: `p_...`, `r_...`, `l_...` (a letter to or from you, or a
   * listing in the market), `n_...`, `t_...`, `b_...`, `i_...` (a thing on display, or a piece), or
   * a plot for sale as `px,py`.
   */
  id: z.string().min(1).max(64),
  reason: ReportReason,
  /** Anything that helps staff understand. Only staff (and the AI that helps them) see it. */
  note: z.string().max(REPORT_NOTE_MAX_LENGTH).optional(),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequest>;

export const ReportStatus = z.enum(["open", "actioned", "dismissed"]);

/** Your report, as you see it. */
export const ReportView = z.object({
  id: z.string(),
  kind: ReportKind,
  /** The id of what you reported. */
  target: z.string(),
  reason: ReportReason,
  status: ReportStatus,
  createdAt: z.string(),
});
export type ReportView = z.infer<typeof ReportView>;

export const ReportResponse = z.object({ report: ReportView });
