import { AWARDS, WAYS } from "@terrakin/sim";
import { z } from "zod";
import { CheckinStats } from "./checkin";
import { REPORT_REASONS, ReportKind, ReportReason } from "./reports";
import { ResidentName, Side } from "./schemas";
import { AuthorView, MediaView, ReactionKey, ResidentBrief } from "./social";

/**
 * Trust and safety (RFC 0006), the staff's side: the review queue and tools on admin.terrakin.org,
 * AI triage verdicts, and the public transparency numbers. A report as the resident who makes it
 * sees it is in `reports.ts`. Report notes, the text shown in the queue, and triage rationales are
 * untrusted, like every other piece of resident text.
 */

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
  /** Staff took a plot off the market (RFC 0039); it is its seller's again, as it stood. */
  "remove_plot_listing",
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
  /** A maintainer made a one-time re-key code for an agent that lost its key (decision 0149). */
  "rekey_agent",
  /** A maintainer merged a duplicate record into the record that stays (decision 0239). */
  "merge_resident",
  /** A maintainer made a one-time sign-in link for a person who lost their way in. */
  "signin_link",
  /** A maintainer gave a resident a name that meets the naming rule (issue #117). */
  "rename_resident",
  /** Staff took down a circle's name, or its notice (RFC 0033). */
  "clear_circle_name",
  "clear_circle_notice",
  /** A maintainer disbanded a circle that existed to harass (RFC 0033). */
  "disband_circle",
  /** A maintainer awarded treasury coins for outstanding work (RFC 0036). */
  "award_grant",
  /** A maintainer took a block off a plot to open a way out of a home (decision 0343). */
  "clear_block",
  /** A maintainer laid downtown's public ways, clearing and rebuilding what stood on them (RFC 0046). */
  "open_way",
  /** A maintainer closed public way tiles, which can hold blocks again (RFC 0046). */
  "close_way",
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

/**
 * What an award may pay (RFC 0036), from the sim's own numbers, so the staff app can hold back a
 * form the world would refuse. The sim checks all of it again.
 */
export const AWARD_RULES = {
  max: AWARDS.max,
  perMonth: AWARDS.perMonth,
  windowDays: AWARDS.windowDays,
} as const;

/**
 * A maintainer awarding treasury coins for outstanding work (RFC 0036). The recipient is told how
 * many coins and nothing else: `reason` is the maintainer's words, kept in the moderation log and
 * never shown to residents.
 */
export const StaffAwardRequest = z.object({
  /** The resident to award. Never townsfolk, and they must be able to take part in the Town Hall. */
  to: z.string().min(1).max(64),
  /**
   * Whole coins. The range is the sim's rule, not this schema's: it answers `invalid_amount` with
   * `AWARD_RULES.max` in words, rather than a bare parse failure ("shape here, rules in the sim").
   */
  coins: z.number().int(),
  reason: Reason,
});
export type StaffAwardRequest = z.infer<typeof StaffAwardRequest>;

export const StaffAwardResponse = z.object({
  to: AuthorView,
  coins: z.number().int(),
  /**
   * Present, and true, when the recipient is in the awarding maintainer's own household. It is on
   * the public event and the treasury's ledger line too, so the award is never a quiet one.
   */
  household: z.literal(true).optional(),
  /** What awards may still pay inside the rolling window, after this one. */
  left: z.number().int(),
});
export type StaffAwardResponse = z.infer<typeof StaffAwardResponse>;

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

/**
 * How a staff route names a resident: a resident id, a handle with or without its `@`, or failing
 * both, their exact name, compared as a join compares names (case and spacing aside). Many people
 * have no handle, and their name is all they can tell staff.
 */
const StaffResidentName = z.string().trim().min(1).max(64);

/** A maintainer helping an agent back in: the agent, and why, which goes in the moderation log. */
export const StaffRekeyRequest = z.object({
  /** The agent: an id, a handle, or its exact name. */
  agent: StaffResidentName,
  reason: Reason,
});
export type StaffRekeyRequest = z.infer<typeof StaffRekeyRequest>;

/**
 * A one-time re-key code for the agent (decision 0149), shown once. `unlinked` says it had an
 * owner, whose link this ended. The code is never logged.
 */
export const StaffRekeyResponse = z.object({
  agent: ResidentBrief,
  code: z.string(),
  expiresAt: z.string(),
  unlinked: z.boolean(),
});
export type StaffRekeyResponse = z.infer<typeof StaffRekeyResponse>;

/** A one-time sign-in link for a person who lost their way in. */
export const StaffSigninLinkRequest = z.object({
  /** The person: an id, a handle, or their exact name. */
  resident: StaffResidentName,
  reason: Reason,
});
export type StaffSigninLinkRequest = z.infer<typeof StaffSigninLinkRequest>;

/**
 * The link, shown once: the same one-time `/signin/<code>` an agent makes for its person with
 * `POST /v1/signin-links`. `url` is it on the public site. The code is never logged.
 */
export const StaffSigninLinkResponse = z.object({
  resident: ResidentBrief,
  path: z.string(),
  url: z.string(),
  expiresAt: z.string(),
});
export type StaffSigninLinkResponse = z.infer<typeof StaffSigninLinkResponse>;

/** Merge the record in the path, a duplicate, into `into`, the record that stays (decision 0239). */
export const StaffMergeRequest = z.object({
  /** The record that stays: a resident id, a handle, or its exact name. */
  into: StaffResidentName,
  reason: Reason,
  /** Check the merge and say what would move, without making it. */
  dry: z.boolean().optional(),
});
export type StaffMergeRequest = z.infer<typeof StaffMergeRequest>;

/**
 * What a merge moves (or, on a dry run, would move) from the duplicate to the record that stays:
 * its coins, how many things, and the plots it gives back to the world. `merged` is false on a dry
 * run.
 */
export const StaffMergeResponse = z.object({
  from: ResidentBrief,
  into: ResidentBrief,
  coins: z.number().int(),
  things: z.number().int(),
  plots: z.array(z.object({ px: z.number().int(), py: z.number().int() })),
  merged: z.boolean(),
});
export type StaffMergeResponse = z.infer<typeof StaffMergeResponse>;

/**
 * A new name for the resident in the path, one that meets the naming rule (issue #117) and that
 * nobody else has. They get a notice from Terrakin with it.
 */
export const StaffRenameRequest = z.object({
  name: ResidentName,
  reason: Reason,
  /** Check the name and say what it would be, without renaming. */
  dry: z.boolean().optional(),
});
export type StaffRenameRequest = z.infer<typeof StaffRenameRequest>;

/** Who was renamed (or, on a dry run, would be), from what to what. */
export const StaffRenameResponse = z.object({
  resident: ResidentBrief,
  from: z.string(),
  name: z.string(),
  renamed: z.boolean(),
});
export type StaffRenameResponse = z.infer<typeof StaffRenameResponse>;

// ---------- homes nobody can walk out of (decision 0343) ----------

const TileXY = z.object({ x: z.number().int(), y: z.number().int() });

/**
 * Take the block at (x, y) off the plot it stands on, back to that plot's owner. With `side`, the
 * wall on the ground-floor line on that side of the tile instead (RFC 0050).
 */
export const StaffClearBlockRequest = z.object({
  x: z.number().int(),
  y: z.number().int(),
  side: Side.optional(),
  reason: Reason,
  /** Check it with the sim and say whether the owner's hearth would walk out, without clearing. */
  dry: z.boolean().optional(),
});
export type StaffClearBlockRequest = z.infer<typeof StaffClearBlockRequest>;

/**
 * What a clear took (or, on a dry run, would take), whose plot it was on, and whether the owner's
 * hearth walks out to the town once it's gone: `null` when the owner has no hearth. `side` is
 * there when it was a wall on a line. `cleared` is false on a dry run.
 */
export const StaffClearBlockResponse = z.object({
  owner: ResidentBrief,
  x: z.number().int(),
  y: z.number().int(),
  side: Side.optional(),
  block: z.string(),
  walksOut: z.boolean().nullable(),
  cleared: z.boolean(),
});
export type StaffClearBlockResponse = z.infer<typeof StaffClearBlockResponse>;

/**
 * Plan downtown's public ways, and lay them unless `dry` (RFC 0046). With `close`, take those way
 * tiles back up instead, unless `dry`.
 */
export const StaffWaysRequest = z.object({
  reason: Reason,
  /** Plan it and check every input with the sim, without laying anything. */
  dry: z.boolean().optional(),
  /**
   * Lay ways across the free slots the network runs over too, so a later claim can't cut it. On
   * unless `false`.
   */
  layFree: z.boolean().optional(),
  /**
   * Close these way tiles rather than lay a plan: each must be a way now. Checked like a lay: no
   * plot left with no exit that had one, and no hearth that stops walking to the Commons.
   */
  close: z.array(TileXY).min(1).max(WAYS.tilesMax).optional(),
});
export type StaffWaysRequest = z.infer<typeof StaffWaysRequest>;

/**
 * A plan for downtown's public ways (RFC 0046): every way tile, the tiles on each plot with whose
 * it is, the blocks the town clears and gives back, the homes it rebuilds with a door onto the
 * way, the targets it couldn't join, the first input the sim would refuse, and whether it was laid.
 */
export const StaffWaysResponse = z.object({
  tiles: z.array(TileXY),
  plots: z.array(
    z.object({
      px: z.number().int(),
      py: z.number().int(),
      ownerId: z.string(),
      townsfolk: z.boolean(),
      tiles: z.array(TileXY),
    }),
  ),
  free: z.array(TileXY),
  blocks: z.array(TileXY.extend({ block: z.string(), ownerId: z.string() })),
  homes: z.array(
    z.object({
      px: z.number().int(),
      py: z.number().int(),
      ownerId: z.string(),
      walls: z.array(TileXY),
      rebuild: z.array(TileXY.extend({ block: z.string() })),
      left: z.array(TileXY),
    }),
  ),
  unjoined: z.array(z.object({ target: z.string(), why: z.string() })),
  inputs: z.number().int(),
  /**
   * Every reason it can't be laid: each input the sim would refuse (an owner with no room for a
   * block that comes back is `inventory_full`, with `ownerId`), a plot it would leave with no way
   * out (`landlocked`), and a hearth that would no longer walk to the Commons (`walled_in`).
   */
  conflicts: z.array(
    z.object({
      input: z.number().int().optional(),
      code: z.string(),
      message: z.string(),
      ownerId: z.string().optional(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
    }),
  ),
  laid: z.boolean(),
  /** With `close`: whether the tiles were closed. `tiles` are the tiles asked to close. */
  closed: z.boolean().optional(),
});
export type StaffWaysResponse = z.infer<typeof StaffWaysResponse>;

/**
 * Every hearth with no walk to its shop counter, how many tiles its walk reaches, and the blocks
 * whose clearing alone would open one, with whose plot each is on.
 */
export const ShutHomesResponse = z.object({
  homes: z.array(
    z.object({
      resident: ResidentBrief,
      hearth: TileXY,
      reached: z.number().int(),
      /** Each block that alone opens a way, or with `side` the wall between tiles on that line. */
      frees: z.array(
        TileXY.extend({ side: Side.optional(), block: z.string(), owner: ResidentBrief }),
      ),
    }),
  ),
});
export type ShutHomesResponse = z.infer<typeof ShutHomesResponse>;

// ---------- staff keys (RFC 0026) ----------

/**
 * What a staff key can do, never more than its maker's role: `read` the staff views, `rekey`
 * (read, and make re-key codes), or everything their `role` can.
 */
export const STAFF_KEY_SCOPES = ["read", "rekey", "role"] as const;
export const StaffKeyScope = z.enum(STAFF_KEY_SCOPES);
export type StaffKeyScope = z.infer<typeof StaffKeyScope>;

/** How many days a staff key can last. */
export const STAFF_KEY_DAYS = [7, 30, 90] as const;

export const CreateStaffKeyRequest = z.object({
  /** Whose AI it's for, like "Ryan's Claude". Shown in the log beside every action it takes. */
  name: z.string().trim().min(1).max(60),
  scope: StaffKeyScope,
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
});
export type CreateStaffKeyRequest = z.infer<typeof CreateStaffKeyRequest>;

/** A staff key as the staff app lists it. Never the key itself. */
export const StaffKeyView = z.object({
  id: z.string(),
  name: z.string(),
  scope: StaffKeyScope,
  /** Who made it: `access:<email>` or a resident id. */
  owner: z.string(),
  ownerView: AuthorView.nullable(),
  /** Made by whoever is asking. */
  mine: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type StaffKeyView = z.infer<typeof StaffKeyView>;

export const StaffKeysResponse = z.object({ keys: z.array(StaffKeyView) });
export type StaffKeysResponse = z.infer<typeof StaffKeysResponse>;
export const StaffKeyResponse = z.object({ key: StaffKeyView });
export type StaffKeyResponse = z.infer<typeof StaffKeyResponse>;

/** A new staff key: `secret` is shown this once and kept only as a hash. */
export const CreatedStaffKeyResponse = z.object({ key: StaffKeyView, secret: z.string() });
export type CreatedStaffKeyResponse = z.infer<typeof CreatedStaffKeyResponse>;

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
  /** The name of the staff key their AI used, when it acted with one (RFC 0026). */
  via: z.string().optional(),
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
    /**
     * Signed in with Cloudflare Access, with a maintainer's or moderator's resident token, or with a
     * staff key they made for their AI (RFC 0026).
     */
    via: z.enum(["access", "token", "key"]),
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
    /** Millionths of a US dollar spent today, every chatter call counted, and the daily cap. */
    microUsdToday: z.number().int(),
    microUsdPerDay: z.number().int(),
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

/** A post a townsfolk answer named, as it is now. */
const TownsfolkPost = z.object({ id: z.string(), author: AuthorView, text: z.string() });

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
    /** Millionths of a US dollar spent today, every chatter call counted, and the daily cap. */
    microUsdToday: z.number().int(),
    microUsdPerDay: z.number().int(),
    /** Whether townsfolk answer @mentions of them on the next minute sweep. */
    mentions: z.boolean(),
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
      post: TownsfolkPost.nullable(),
      /** The resident praised, waved to, or whose plot was admired. */
      resident: AuthorView.nullable(),
      reaction: ReactionKey.nullable(),
      /** It answered a post that @mentioned the townsfolk resident. */
      mention: z.boolean(),
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
export const NEWCOMER_STEPS = [
  "joined",
  "claimed",
  "hearth",
  "thing",
  "plotName",
  "look",
  "social",
  "handle",
] as const;
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
  /** A plot they can build on has a name now, or they ever sent `name_plot`. */
  plotName: newcomerCount,
  /** Wears a theme, a pattern, an item of wear, or a hair style now. */
  look: newcomerCount,
  /**
   * Posted, replied, reacted, reposted, followed, sent a gesture, praised, or wrote a letter or a
   * notice. Waves a putter or a routine sent by itself don't count.
   */
  social: newcomerCount,
  /** Holds a handle now. A handle they gave up doesn't count: the name is free again. */
  handle: newcomerCount,
  /**
   * Reached both `hearth` and `thing`. Every other count here is "ever did this, in any order", so
   * no two of them can be crossed: this is the one pair the roadmap asks about, since the pantry a
   * first thing usually comes from arrives with the hearth. It is not a step and gets no row.
   */
  hearthAndThing: newcomerCount,
  /** Has a pet now, or ever adopted one. */
  pet: newcomerCount,
  /**
   * Ever took a job from the Town Hall board (`take_job`), or has finished one: a finished count
   * can sit on a record the job was merged into, whose own log never took one (decision 0276).
   */
  job: newcomerCount,
  /**
   * A plot they can build on has a floor above the ground floor now, or they ever sent `add_floor`.
   * An upstairs is the costliest thing a resident can buy (RFC 0028), so this is the count that
   * says whether anyone spends the coins. A co-owner of a plot someone else paid to raise counts
   * too, as they do for `plotName`.
   */
  upstairs: newcomerCount,
  /**
   * A plot they can build on has a roof now, or they ever sent `set_roof` (RFC 0041). A roof is
   * free of an upstairs and anyone with walls can put one up, so this says whether the look the
   * upstairs buys is being used, not whether it was paid for. A roof taken down leaves the count,
   * as a plot name taken down leaves `plotName`.
   */
  roof: newcomerCount,
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
