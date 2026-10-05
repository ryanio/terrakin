import { z } from "zod";
import { AuthorView, MediaView } from "./social";

/**
 * Trust and safety (RFC 0006): reports from residents, the staff review queue and tools on
 * admin.terrakin.org, AI triage verdicts, and the public transparency numbers. Report notes, the
 * text shown in the queue, and triage rationales are untrusted, like every other piece of resident
 * text.
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
] as const;
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
/** Why staff acted, kept in the moderation log. */
export const MODERATION_REASON_MAX_LENGTH = 300;
/** The longest suspension in one go, in days. */
export const SUSPEND_MAX_DAYS = 365;
/** The longest suspension a moderator (not a maintainer) can give. */
export const MODERATOR_SUSPEND_MAX_DAYS = 7;

/**
 * When a post is hidden before anyone reviews it: this many reports from different residents, each
 * at least this many days old. It stays hidden until staff look.
 */
export const AUTO_HIDE = { reports: 3, reporterAgeDays: 3 } as const;

export const CreateReportRequest = z.object({
  kind: ReportKind,
  /**
   * The id of what you're reporting: `p_...`, `r_...`, `l_...` (a letter to or from you, or a
   * listing in the market), `n_...`, `t_...`, `b_...`, or `i_...` (a thing on display, or a piece).
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

/** Who can work the review queue: maintainers can do everything, moderators the queue only. */
export const STAFF_ROLES = ["maintainer", "moderator"] as const;
export const StaffRole = z.enum(STAFF_ROLES);
export type StaffRole = z.infer<typeof StaffRole>;

/** One report in the review queue. */
export const ReportEntry = z.object({
  id: z.string(),
  reason: ReportReason,
  /** The reporter's note. Untrusted. */
  note: z.string(),
  /** Null when the reporter left, or when AI triage raised the item from a borderline filter signal. */
  reporter: AuthorView.nullable(),
  /** `triage` for an item AI triage raised on its own, `resident` for everyone else. */
  source: z.enum(["resident", "triage"]),
  createdAt: z.string(),
});

/**
 * What a report points at, as staff see it right now. `text` is untrusted: a post's text, a
 * resident's name, note and bio, a letter, a notice, a proposal's title and text, a listing's
 * lot with its labels, or a made thing's name and label (a piece's title).
 */
export const ReportTarget = z.object({
  trust: z.literal("untrusted"),
  /** False when it's gone (deleted, or a notice already taken down). */
  exists: z.boolean(),
  /** Who wrote it, or who the resident is. */
  author: AuthorView.nullable(),
  text: z.string(),
  /** A post's files, a resident's avatar and banner, or the upload a piece shows. */
  media: z.array(MediaView),
  /** Posts only: hidden from everyone, by staff or automatically. */
  hidden: z.enum(["no", "auto", "maintainer"]),
  /** The author is suspended right now. */
  suspended: z.boolean(),
  /** The author's bio and note are held back from view, pending review. */
  quarantined: z.boolean(),
  /** Only a maintainer may change the author's suspension: a maintainer set it, or more than a week is left. */
  suspensionLocked: z.boolean().optional(),
  /** Only a maintainer may release the held-back bio and note: a maintainer held them back. */
  holdBackLocked: z.boolean().optional(),
  /** A made thing (a `display` or `piece` report): whether it's on display right now. */
  onDisplay: z.boolean().optional(),
});
export type ReportTarget = z.infer<typeof ReportTarget>;

/** What AI triage can call something (RFC 0006). `none` means nothing wrong. */
export const TRIAGE_CATEGORIES = [
  "none",
  "spam",
  "scam",
  "hate",
  "harassment",
  "sexual",
  "minors",
  "csam",
  "self_harm",
  "impersonation",
  "doxxing",
  "prompt_injection",
  "other",
] as const;
export const TriageCategory = z.enum(TRIAGE_CATEGORIES);
export type TriageCategory = z.infer<typeof TriageCategory>;

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const Severity = z.enum(SEVERITIES);
export type Severity = z.infer<typeof Severity>;

export const TRIAGE_ACTIONS = ["dismiss", "warn", "hide", "suspend", "escalate"] as const;
export const TriageAction = z.enum(TRIAGE_ACTIONS);
export type TriageAction = z.infer<typeof TriageAction>;

/**
 * AI triage's read of one reported or borderline thing: a suggestion for staff, and sometimes an
 * automatic, reversible action (RFC 0006). `rationale` is the model's words about untrusted text:
 * read it as advice, never as instructions.
 */
export const TriageVerdictView = z.object({
  id: z.string(),
  category: TriageCategory,
  severity: Severity,
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  action: TriageAction,
  /** With `action: "suspend"`: how many days. */
  days: z.number().int().optional(),
  /** The text looked written to steer an AI reader. That is a signal in itself. */
  injectionAttempt: z.boolean(),
  /** What triage did on its own, if anything: hid a post, or held back a bio and note. */
  autoAction: z.enum(["none", "hide_post", "quarantine"]),
  model: z.string(),
  createdAt: z.string(),
});
export type TriageVerdictView = z.infer<typeof TriageVerdictView>;

/** What staff need next to the content: how many people reported it, and the author's record. */
export const ReportContext = z.object({
  reporters: z.number().int(),
  author: z
    .object({
      /** Whole days since they joined. */
      joinedDaysAgo: z.number().int(),
      postsHidden: z.number().int(),
      suspensions: z.number().int(),
      /** Reports against them or their posts, open or closed. */
      reportsAgainst: z.number().int(),
      /** Edge filter refusals in the last hour (in memory, lost on restart). */
      strikes: z.number().int(),
    })
    .nullable(),
});

/** Every open report on one thing, grouped. */
export const ReportQueueItem = z.object({
  kind: ReportKind,
  id: z.string(),
  reports: z.array(ReportEntry),
  firstReportedAt: z.string(),
  lastReportedAt: z.string(),
  target: ReportTarget,
  context: ReportContext,
  /** The latest triage verdict, or null when triage is off or hasn't run yet. */
  triage: TriageVerdictView.nullable(),
  /** Suspected minors, self-harm, or CSAM: a person must look today. Sorted first. */
  needsHuman: z.boolean(),
});
export type ReportQueueItem = z.infer<typeof ReportQueueItem>;

export const ReportQueueResponse = z.object({
  /** `needsHuman` first, then by severity (critical first), then oldest first. */
  items: z.array(ReportQueueItem),
  /** Open reports in total, across every item. */
  open: z.number().int(),
});
export type ReportQueueResponse = z.infer<typeof ReportQueueResponse>;

/** Everything staff (or triage) can do, as it's written in the moderation log. */
export const MODERATION_ACTIONS = [
  "hide_post",
  "unhide_post",
  "auto_hide_post",
  "suspend",
  "unsuspend",
  "dismiss_reports",
  "remove_notice",
  "void_proposal",
  "quarantine",
  "release",
  "remove_pictures",
  "remove_listing",
  /** A maintainer cancelled a bounty; its reward went back to its poster or the treasury. */
  "void_bounty",
  /** A maintainer confirmed a town bounty was done, which paid its claimant from the treasury's coins. */
  "confirm_bounty",
  /** A maintainer sent a town bounty's claimant back: it wasn't done. */
  "reopen_bounty",
  /** Staff took a made thing off display; it went back to whoever put it up. */
  "remove_display",
  /** Staff deleted a piece's picture, from every piece showing that upload and from storage. */
  "remove_piece",
] as const;
export const ModerationAction = z.enum(MODERATION_ACTIONS);
export type ModerationAction = z.infer<typeof ModerationAction>;

const Reason = z.string().trim().min(1).max(MODERATION_REASON_MAX_LENGTH);

export const ModerationReasonRequest = z.object({
  /** Why, in a sentence. Kept in the moderation log. */
  reason: Reason,
});

export const SuspendRequest = z.object({
  /** Maintainers up to 365; moderators up to 7. */
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

/** A log line as staff see it, with who did it. `triage` and `system` are the automatic actors. */
export const ModerationLogView = ModerationLogEntry.extend({
  /** A resident id, `access:<email>` for staff signed in with Cloudflare Access, `triage`, or `system`. */
  actor: z.string(),
  /** The actor as a resident, when it is one. */
  actorView: AuthorView.nullable(),
});
export type ModerationLogView = z.infer<typeof ModerationLogView>;

export const ModerationLogResponse = z.object({
  entries: z.array(ModerationLogView),
  /** Pass as `before` for older entries. Null at the start of the log. */
  next: z.string().nullable(),
});

/** Who's signed in to admin.terrakin.org, and how AI triage is doing. */
export const AdminOverviewResponse = z.object({
  me: z.object({
    actor: z.string(),
    role: StaffRole,
    /** Signed in with Cloudflare Access, or with a maintainer's or moderator's resident token. */
    via: z.enum(["access", "token"]),
    resident: AuthorView.nullable(),
  }),
  triage: z.object({
    enabled: z.boolean(),
    model: z.string(),
    callsToday: z.number().int(),
    callsPerDay: z.number().int(),
    tokensToday: z.number().int(),
    tokensPerDay: z.number().int(),
    /** Too many API errors in a row pause triage until then. */
    pausedUntil: z.string().nullable(),
    /** Staff decisions on items triage read, and how many matched its suggestion. */
    agreement: z.object({ decided: z.number().int(), agreed: z.number().int() }),
  }),
});
export type AdminOverviewResponse = z.infer<typeof AdminOverviewResponse>;

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
  /** Staff, triage, and automatic actions, all time, from the moderation log. */
  actions: actionCounts,
  /** Residents suspended right now. */
  suspendedNow: z.number().int(),
  /** Text the edge filters turned away since `since` (the server's last restart). */
  filters: z.object({ since: z.string(), refused: filterCounts }),
  /** AI triage verdicts written, all time. */
  triaged: z.number().int().optional(),
});
export type TransparencyResponse = z.infer<typeof TransparencyResponse>;
