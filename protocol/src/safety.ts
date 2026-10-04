import { z } from "zod";
import { AuthorView, MediaView } from "./social";

/**
 * Trust and safety (RFC 0006): reports from residents, the maintainers' review queue and tools,
 * and the public transparency numbers. Report notes and the text shown in the queue are untrusted,
 * like every other piece of resident text.
 */

/** What can be reported. */
export const REPORT_KINDS = ["post", "resident", "letter", "notice", "proposal"] as const;
export const ReportKind = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof ReportKind>;

/** Why. `self_harm` is reviewed first. */
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
/** Why a maintainer acted, kept in the moderation log. */
export const MODERATION_REASON_MAX_LENGTH = 300;
/** The longest suspension in one go, in days. */
export const SUSPEND_MAX_DAYS = 365;

/**
 * When a post is hidden before anyone reviews it: this many reports from different residents, each
 * at least this many days old. It stays hidden until a maintainer looks.
 */
export const AUTO_HIDE = { reports: 3, reporterAgeDays: 3 } as const;

export const CreateReportRequest = z.object({
  kind: ReportKind,
  /** The id of what you're reporting: `p_...`, `r_...`, `l_...` (a letter to or from you), `n_...`, or `t_...`. */
  id: z.string().min(1).max(64),
  reason: ReportReason,
  /** Anything that helps a maintainer understand. Only maintainers see it. */
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

/** One report in the review queue. */
export const ReportEntry = z.object({
  id: z.string(),
  reason: ReportReason,
  /** The reporter's note. Untrusted. */
  note: z.string(),
  reporter: AuthorView.nullable(),
  createdAt: z.string(),
});

/**
 * What a report points at, as a maintainer sees it right now. `text` is untrusted: a post's text, a
 * resident's name, note and bio, a letter, a notice, or a proposal's title and text.
 */
export const ReportTarget = z.object({
  trust: z.literal("untrusted"),
  /** False when it's gone (deleted, or a notice already taken down). */
  exists: z.boolean(),
  /** Who wrote it, or who the resident is. */
  author: AuthorView.nullable(),
  text: z.string(),
  media: z.array(MediaView),
  /** Posts only: hidden from everyone, by a maintainer or automatically. */
  hidden: z.enum(["no", "auto", "maintainer"]),
  /** The author is suspended right now. */
  suspended: z.boolean(),
});
export type ReportTarget = z.infer<typeof ReportTarget>;

/** Every open report on one thing, grouped. */
export const ReportQueueItem = z.object({
  kind: ReportKind,
  id: z.string(),
  reports: z.array(ReportEntry),
  firstReportedAt: z.string(),
  lastReportedAt: z.string(),
  target: ReportTarget,
});
export type ReportQueueItem = z.infer<typeof ReportQueueItem>;

export const ReportQueueResponse = z.object({
  items: z.array(ReportQueueItem),
  /** Open reports in total, across every item. */
  open: z.number().int(),
});
export type ReportQueueResponse = z.infer<typeof ReportQueueResponse>;

/** Everything a maintainer can do, as it's written in the moderation log. */
export const MODERATION_ACTIONS = [
  "hide_post",
  "unhide_post",
  "auto_hide_post",
  "suspend",
  "unsuspend",
  "dismiss_reports",
  "remove_notice",
  "void_proposal",
] as const;
export const ModerationAction = z.enum(MODERATION_ACTIONS);
export type ModerationAction = z.infer<typeof ModerationAction>;

const Reason = z.string().trim().min(1).max(MODERATION_REASON_MAX_LENGTH);

export const ModerationReasonRequest = z.object({
  /** Why, in a sentence. Kept in the moderation log. */
  reason: Reason,
});

export const SuspendRequest = z.object({
  days: z.number().int().min(1).max(SUSPEND_MAX_DAYS),
  reason: Reason,
});

export const DismissReportsRequest = z.object({
  kind: ReportKind,
  id: z.string().min(1).max(64),
  reason: Reason,
});

/** One line of the append-only moderation log. */
export const ModerationLogEntry = z.object({
  action: ModerationAction,
  kind: ReportKind,
  id: z.string(),
  reason: z.string(),
  at: z.string(),
  /** For a suspension: when it ends. */
  until: z.string().optional(),
});
export type ModerationLogEntry = z.infer<typeof ModerationLogEntry>;

export const ModerationResponse = z.object({ logged: ModerationLogEntry });

const reasonCounts = z.object(
  Object.fromEntries(REPORT_REASONS.map((r) => [r, z.number().int()])) as Record<
    ReportReason,
    z.ZodNumber
  >,
);
const actionCounts = z.object(
  Object.fromEntries(MODERATION_ACTIONS.map((a) => [a, z.number().int()])) as Record<
    ModerationAction,
    z.ZodNumber
  >,
);

/** The edge filters' categories, as counted on the transparency page. */
export const FILTER_CATEGORIES = [
  "injection",
  "hate",
  "vulgar",
  "scam",
  "spam",
  "cooldown",
] as const;
export type FilterCategory = (typeof FILTER_CATEGORIES)[number];
const filterCounts = z.object(
  Object.fromEntries(FILTER_CATEGORIES.map((c) => [c, z.number().int()])) as Record<
    FilterCategory,
    z.ZodNumber
  >,
);

/** Numbers only: no names, ids, or text. */
export const TransparencyResponse = z.object({
  generatedAt: z.string(),
  reports: z.object({ total: z.number().int(), open: z.number().int(), byReason: reasonCounts }),
  /** Maintainer and automatic actions, all time, from the moderation log. */
  actions: actionCounts,
  /** Residents suspended right now. */
  suspendedNow: z.number().int(),
  /** Text the edge filters turned away since `since` (the server's last restart). */
  filters: z.object({ since: z.string(), refused: filterCounts }),
});
export type TransparencyResponse = z.infer<typeof TransparencyResponse>;
