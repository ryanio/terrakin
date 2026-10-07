import { z } from "zod";
import { CheckinStats } from "./checkin";
import { REPORT_REASONS, ReportReason } from "./reasons";
import { AuthorView, MediaView, ReactionKey } from "./social";

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
  /** A hosted event, by its id (`e_7`): its title and text (RFC 0010). */
  "event",
] as const;
export const ReportKind = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof ReportKind>;

/** Why: the community rule it broke. */
export { REPORT_REASONS, ReportReason } from "./reasons";

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
 * resident's name, note, bio, pet's name, and plot names, a letter, a notice, a proposal's title
 * and text, a listing's lot with its labels, or a made thing's name and label (a piece's title).
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
  /**
   * A resident report: how many plot names are theirs to answer for, on plots they own or names
   * they wrote (decision 0121). Each is in `text`; `clear-plot-names` takes them down. Absent at 0.
   */
  plotNames: z.number().int().optional(),
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
  /** A maintainer called off an event; a Commons booking's deposit went back to its host. */
  "void_event",
  /** Staff took down the names of a resident's plots (decision 0121). */
  "clear_plot_names",
] as const;
export const ModerationAction = z.enum(MODERATION_ACTIONS);
export type ModerationAction = z.infer<typeof ModerationAction>;

const Reason = z.string().trim().min(1).max(MODERATION_REASON_MAX_LENGTH);

export const ModerationReasonRequest = z.object({
  /** Why, in a sentence. Kept in the moderation log. */
  reason: Reason,
});

/**
 * Staff taking down something a resident owns: a post, their pictures, a listing, a thing on
 * display, or a piece's picture. The owner gets a takedown notice naming `rule`, never `reason`.
 */
export const TakedownRequest = ModerationReasonRequest.extend({
  /** The community rule it broke, told to its owner. Without it, the rule most reports named. */
  rule: ReportReason.optional(),
});
export type TakedownRequest = z.infer<typeof TakedownRequest>;

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
  /** For a takedown: the rule its owner was told it broke. */
  rule: ReportReason.optional(),
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

/**
 * The townsfolk's daily coin tips (docs/plans/townsfolk-chatter.md, "Coins"): the mode, and what
 * the last run came to, in counts. `dry` checks each gift with the sim and gives nothing.
 */
const TipsStatus = z.object({
  mode: z.enum(["off", "dry", "on"]),
  lastRun: z
    .object({
      at: z.string(),
      /** The world's day it ran for. */
      day: z.number().int(),
      mode: z.enum(["off", "dry", "on"]),
      skipped: z.enum(["off", "closed", "done", "nobody"]).optional(),
      welcomed: z.number().int(),
      refused: z.number().int(),
      skippedNewcomers: z.number().int(),
      waiting: z.number().int(),
      welcomeCoins: z.number().int(),
      post: z.enum(["tipped", "refused", "none"]),
      postCoins: z.number().int(),
      gap: z.boolean(),
      stopped: z.boolean(),
      /** The sim's refusal codes. */
      codes: z.array(z.string()),
    })
    .nullable(),
});

/**
 * Whether chatter draws real residents in: the notes it put up, how many a real resident replied or
 * reacted to, and those replies and reactions.
 */
const ChatterParticipation = z.object({
  notes: z.number().int(),
  answered: z.number().int(),
  replies: z.number().int(),
  reactions: z.number().int(),
});

/** What townsfolk chatter can do (decision 0114). */
export const TOWNSFOLK_ACTIONS = [
  "post",
  "reply",
  "like",
  "react",
  "praise",
  "admire",
  "wave",
] as const;
export const TownsfolkAction = z.enum(TOWNSFOLK_ACTIONS);
export type TownsfolkAction = z.infer<typeof TownsfolkAction>;

/** Who's signed in to admin.terrakin.org, and how AI triage is doing. */
export const AdminOverviewResponse = z.object({
  me: z.object({
    actor: z.string(),
    role: StaffRole,
    /** Signed in with Cloudflare Access, or with a maintainer's or moderator's resident token. */
    via: z.enum(["access", "token"]),
    /** Their token's resident, or the one `TERRAKIN_STAFF_RESIDENTS` maps their Access email to. */
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
  /** How many residents check in, and how far apart. */
  checkins: CheckinStats,
  /**
   * What AI calls cost, from the spend ledger: every call triage and townsfolk chatter made. Amounts
   * are millionths of a US dollar. Never resident text or ids.
   */
  spend: z.object({
    todayMicroUsd: z.number().int(),
    /** The last `days` UTC days, today included. */
    windowMicroUsd: z.number().int(),
    days: z.number().int(),
    lines: z.array(
      z.object({
        purpose: z.string(),
        model: z.string(),
        calls: z.number().int(),
        microUsd: z.number().int(),
        /** Cache reads as a share of all input tokens, 0 to 1. */
        cacheReadShare: z.number(),
      }),
    ),
    /** Chatter over the window: calls, notes that went up, a dry run's drafts, answers turned away. */
    chatter: z.object({
      calls: z.number().int(),
      notes: z.number().int(),
      drafts: z.number().int(),
      refused: z.number().int(),
      microUsd: z.number().int(),
    }),
  }),
  /**
   * The townsfolk's daily coin tips (docs/plans/townsfolk-chatter.md, "Coins"): the mode, and what
   * the last run came to, in counts. `dry` checks each gift with the sim and gives nothing.
   */
  tips: TipsStatus,
  /** Townsfolk chatter (docs/plans/townsfolk-chatter.md): its settings, today's use, and drafts. */
  chatter: z.object({
    /** `off` without a key or with no calls a day; `dry` stores drafts and posts nothing. */
    mode: z.enum(["off", "dry", "posts", "all"]),
    /** `quiet` runs only while real residents post little; `off` runs every time. */
    gate: z.enum(["quiet", "off"]),
    /** Townsfolk residents who act in one run. */
    perRun: z.number().int(),
    model: z.string(),
    callsToday: z.number().int(),
    callsPerDay: z.number().int(),
    tokensToday: z.number().int(),
    tokensPerDay: z.number().int(),
    pausedUntil: z.string().nullable(),
    /**
     * The last run: when, and a skip reason (`busy`, `rested`, ...), a stop reason (`capped`,
     * `paused`, `idle`), or each call's outcome, comma separated.
     */
    lastRun: z.object({ at: z.string(), result: z.string() }).nullable(),
    /**
     * Whether chatter draws real residents in, over the same window as `spend`: the notes it put
     * up, how many a real resident replied or reacted to, and those replies and reactions.
     */
    participation: ChatterParticipation,
    /**
     * A dry run's newest answers, for staff to read before posts go live. The model wrote `text`;
     * it can quote residents, so it's shown as text only.
     */
    drafts: z.array(
      z.object({
        at: z.string(),
        persona: z.string(),
        action: z.string(),
        outcome: z.string(),
        text: z.string(),
        postId: z.string().nullable(),
      }),
    ),
  }),
});
export type AdminOverviewResponse = z.infer<typeof AdminOverviewResponse>;

/**
 * What the townsfolk are doing (`GET /v1/admin/townsfolk`, staff only): chatter's settings and
 * today's use, each townsfolk resident with what they did today, the latest things they did, and
 * the last coin tips. Text in `activity` was written by the model or by residents; show it as text.
 */
export const TownsfolkActivityResponse = z.object({
  chatter: z.object({
    /** `off` without a key or with no calls a day. */
    mode: z.enum(["off", "dry", "posts", "all"]),
    /** `quiet` runs only while real residents post little; `off` runs every time. */
    gate: z.enum(["quiet", "off"]),
    /** Townsfolk residents who act in one run. */
    perRun: z.number().int(),
    model: z.string(),
    callsToday: z.number().int(),
    callsPerDay: z.number().int(),
    pausedUntil: z.string().nullable(),
    lastRun: z.object({ at: z.string(), result: z.string() }).nullable(),
    /** Over the last 30 days. */
    participation: ChatterParticipation,
  }),
  tips: TipsStatus,
  townsfolk: z.array(
    z.object({
      resident: AuthorView,
      /** What they did today (UTC), by action, live or drafted. */
      today: z.record(TownsfolkAction, z.number().int()),
      /** When they last did anything, or null. */
      lastAt: z.string().nullable(),
    }),
  ),
  /** Newest first. */
  activity: z.array(
    z.object({
      at: z.string(),
      by: AuthorView,
      action: TownsfolkAction,
      /** Done for real, or only drafted by a dry run. */
      live: z.boolean(),
      /** The note or reply the model wrote. */
      text: z.string(),
      /**
       * For a post, the post as it is now; for a reply, like, or reaction, the post it answered.
       * Null when it's gone or hidden.
       */
      post: z.object({ id: z.string(), author: AuthorView, text: z.string() }).nullable(),
      /** The resident praised, waved to, or whose plot was admired. */
      resident: AuthorView.nullable(),
      reaction: ReactionKey.nullable(),
    }),
  ),
});
export type TownsfolkActivityResponse = z.infer<typeof TownsfolkActivityResponse>;

/**
 * The newcomer funnel on the staff app (`GET /v1/admin/newcomers`, decision 0141): for each UTC
 * week of joins, how many people and how many AIs reached each first step. Counts only: no names,
 * ids, or text.
 */

/** The steps in the order a newcomer usually meets them. `pet` is counted beside them. */
export const NEWCOMER_STEPS = ["joined", "claimed", "hearth", "thing", "look", "social"] as const;
export type NewcomerStep = (typeof NEWCOMER_STEPS)[number];

/** How many weekly cohorts the funnel shows, this week included. */
export const NEWCOMER_WEEKS = 8;

const newcomerCount = z.number().int().nonnegative();

/**
 * How many residents of one kind did each step, ever, in any order: `joined` is everyone in the
 * cohort, and each later count is a subset of it.
 */
export const NewcomerCounts = z.object({
  joined: newcomerCount,
  /** Owns or shares a plot now, or ever sent `claim` or `settle`. */
  claimed: newcomerCount,
  /** Has a hearth now, or ever sent `set_hearth`. */
  hearth: newcomerCount,
  /**
   * Planted, harvested, gathered, fished, crafted, or made a piece, or the collection book shows a
   * kind of thing the pantry doesn't hand out (a gift, a buy).
   */
  thing: newcomerCount,
  /** Wears a theme, a pattern, an item of wear, or a hair style now. */
  look: newcomerCount,
  /**
   * Posted, replied, reacted, reposted, followed, sent a gesture, praised, or wrote a letter or a
   * notice. Waves a putter or a routine sent by itself don't count.
   */
  social: newcomerCount,
  /** Has a pet now, or ever adopted one. */
  pet: newcomerCount,
});
export type NewcomerCounts = z.infer<typeof NewcomerCounts>;

export const NewcomerCohort = z.object({
  /** The Monday the UTC week starts, as `YYYY-MM-DD`. Null for all time. */
  week: z.string().nullable(),
  people: NewcomerCounts,
  agents: NewcomerCounts,
  /**
   * Residents in this cohort whose name a resident who joined earlier already had, which is often
   * someone joining again (issue #46). They are still counted above, once per resident.
   */
  sameName: newcomerCount,
});
export type NewcomerCohort = z.infer<typeof NewcomerCohort>;

export const NewcomersResponse = z.object({
  /** Today, UTC, as `YYYY-MM-DD`. */
  today: z.string(),
  /** The last `NEWCOMER_WEEKS` weeks, newest first, this one included, empty weeks too. */
  weeks: z.array(NewcomerCohort),
  allTime: NewcomerCohort,
  /** Residents who joined before the world counted days: in all time, in no week. */
  undated: newcomerCount,
});
export type NewcomersResponse = z.infer<typeof NewcomersResponse>;

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
