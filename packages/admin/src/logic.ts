/**
 * The staff app's decisions, kept pure so tests pin them: which screen a path is, which actions an
 * item offers to which role, and the plain words for triage, the author's record, and log lines.
 * Nothing here touches the DOM. The server checks every action again; hiding a button is only so
 * nobody is offered something they'd be refused.
 */
import {
  type AdminOverviewResponse,
  type BountyView,
  MODERATION_REASON_MAX_LENGTH,
  MODERATOR_SUSPEND_MAX_DAYS,
  type ModerationLogView,
  type ReportKind,
  type ReportQueueItem,
  type ReportReason,
  type StaffRole,
  SUSPEND_MAX_DAYS,
  TOWNSFOLK_ACTIONS,
  type TownsfolkAction,
  type TownsfolkActivityResponse,
  type TriageVerdictView,
} from "@terrakin/protocol";
import { plural, relativeTime } from "@terrakin/ui/format";
import type { IconName } from "@terrakin/ui/icons";
import { REACTIONS } from "@terrakin/ui/reactions";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  REPORT_CHOICES,
  reasonLabel,
  SEVERITY_LABELS,
  SUGGESTION_LABELS,
} from "@terrakin/ui/safety";

export type Screen = "queue" | "log" | "townsfolk" | "bounties";

const PATHS: Record<Screen, string> = {
  queue: "/",
  log: "/log",
  townsfolk: "/townsfolk",
  bounties: "/bounties",
};

/**
 * `/log` is the moderation log, `/townsfolk` what the townsfolk are doing, and `/bounties` the
 * bounties maintainers confirm; every other path is the queue. Trailing slashes are ignored.
 */
export function screenFor(pathname: string): Screen {
  const path = pathname.replace(/\/+$/, "");
  return (
    (Object.keys(PATHS) as Screen[]).find((s) => s !== "queue" && PATHS[s] === path) ?? "queue"
  );
}

export const pathFor = (screen: Screen) => PATHS[screen];

/** Which screens a role gets. Only maintainers move town coins (decision 0062). */
export const screensFor = (role: StaffRole): Screen[] =>
  role === "maintainer" ? ["queue", "log", "townsfolk", "bounties"] : ["queue", "log", "townsfolk"];

/**
 * What a maintainer can do with a bounty: confirm a town bounty its claimant marked done (paying
 * them), and cancel any bounty that hasn't paid. Moderators get nothing; the server refuses them.
 */
export function bountyActions(
  b: Pick<BountyView, "town" | "status" | "claimant" | "grant">,
  role: StaffRole,
): ("confirm" | "reopen" | "void")[] {
  if (role !== "maintainer") return [];
  const running = b.status === "open" || b.status === "claimed" || b.status === "done";
  if (!running) return [];
  const out: ("confirm" | "reopen" | "void")[] = [];
  if (b.town && b.status === "done" && b.claimant) out.push("confirm");
  // A grant has no job to send anyone back from.
  if (b.town && !b.grant && b.claimant) out.push("reopen");
  out.push("void");
  return out;
}

/** The public site for links to profiles and posts: the admin host without its `admin.` label. */
export function mainSite(origin: string): string {
  const url = new URL(origin);
  url.hostname = url.hostname.replace(/^admin\./i, "");
  return url.origin;
}

/** How long each role may suspend for, and the choices the form offers. */
export function suspendLimits(role: StaffRole): { max: number; choices: number[] } {
  return role === "maintainer"
    ? { max: SUSPEND_MAX_DAYS, choices: [1, 3, 7, 30, 90, 365] }
    : { max: MODERATOR_SUSPEND_MAX_DAYS, choices: [1, 3, 7] };
}

export type ActionKind =
  | "hide"
  | "unhide"
  | "suspend"
  | "unsuspend"
  | "quarantine"
  | "release"
  | "remove_pictures"
  | "remove_listing"
  | "remove_display"
  | "remove_piece"
  | "void_bounty"
  | "void_event"
  | "dismiss";

export interface ItemAction {
  kind: ActionKind;
  label: string;
  /**
   * The post, resident, listing, bounty, event, or made thing id the action goes to. Dismiss uses
   * the item's own kind and id.
   */
  target: string;
  primary: boolean;
  /**
   * For what can't be undone (deleting files, a suspension): the button's label after the first
   * tap, and only the second tap acts.
   */
  confirm?: string;
}

/** The resident an item is about: the reported resident, or the author of what was reported. */
export function personOf(item: ReportQueueItem): string | undefined {
  return item.kind === "resident" ? item.id : item.target.author?.id;
}

/**
 * What staff can do with one queue item, in the order the buttons show. Every role gets the same
 * kinds of action, with two limits for moderators: shorter suspensions (see `suspendLimits`), and
 * no changing a suspension or a hold-back that only a maintainer may change (the server refuses
 * those too).
 */
export function itemActions(item: ReportQueueItem, role: StaffRole = "maintainer"): ItemAction[] {
  const maintainer = role === "maintainer";
  const { target } = item;
  const out: ItemAction[] = [];
  if (item.kind === "post" && target.exists) {
    if (target.hidden === "no") {
      out.push({
        kind: "hide",
        label: "Hide post",
        target: item.id,
        primary: true,
        confirm: "Tap again to hide it and delete its files",
      });
    } else {
      // An automatic hide keeps the files; hiding it for good deletes them.
      if (target.hidden === "auto") {
        out.push({
          kind: "hide",
          label: "Confirm hide",
          target: item.id,
          primary: true,
          confirm: "Tap again to delete the files",
        });
      }
      out.push({ kind: "unhide", label: "Show post again", target: item.id, primary: false });
    }
  }
  // Taking a listing down sends the lot back to its seller; it can't be put back in the market.
  if (item.kind === "listing" && target.exists) {
    out.push({
      kind: "remove_listing",
      label: "Take down listing",
      target: item.id,
      primary: true,
      confirm: "Tap again to take it down",
    });
  }
  // A thing on display goes back to whoever put it up, label and picture and all. A reported
  // piece on display can come down this way too, when its title is the problem.
  const shown = item.kind === "display" || (item.kind === "piece" && target.onDisplay === true);
  if (shown && target.exists) {
    out.push({
      kind: "remove_display",
      label: "Take off display",
      target: item.id,
      primary: true,
      confirm: "Tap again to take it down",
    });
  }
  // A piece's picture is deleted for good, from every piece made from that upload, and from
  // storage; the piece keeps its title, and comes off display if it's up.
  if (item.kind === "piece" && target.exists) {
    out.push({
      kind: "remove_piece",
      label: "Delete picture",
      target: item.id,
      primary: !target.onDisplay,
      confirm: "Tap again to delete the picture everywhere",
    });
  }
  const person = personOf(item);
  if (person) {
    if (!target.suspended) {
      out.push({
        kind: "suspend",
        label: "Suspend",
        target: person,
        primary: false,
        confirm: "Tap again to suspend them",
      });
    } else if (maintainer || !target.suspensionLocked) {
      out.push({ kind: "unsuspend", label: "End suspension", target: person, primary: false });
    }
  }
  if (item.kind === "resident" && target.exists) {
    if (!target.quarantined) {
      out.push({
        kind: "quarantine",
        label: "Hold back bio and note",
        target: item.id,
        primary: false,
      });
    } else if (maintainer || !target.holdBackLocked) {
      out.push({ kind: "release", label: "Show bio and note", target: item.id, primary: false });
    }
    if (target.media.length > 0) {
      out.push({
        kind: "remove_pictures",
        label: "Delete profile pictures",
        target: item.id,
        primary: false,
        confirm: "Tap again to delete the pictures",
      });
    }
  }
  // A reported bounty: a maintainer can cancel it, which sends its coins back (decision 0062).
  if (item.kind === "bounty" && target.exists && maintainer) {
    out.push({
      kind: "void_bounty",
      label: "Cancel bounty",
      target: item.id,
      primary: true,
      confirm: "Tap again to cancel it",
    });
  }
  // A reported event (RFC 0010): a maintainer can call it off, which sends a deposit back.
  if (item.kind === "event" && target.exists && maintainer) {
    out.push({
      kind: "void_event",
      label: "Call off event",
      target: item.id,
      primary: true,
      confirm: "Tap again to call it off",
    });
  }
  out.push({ kind: "dismiss", label: "Dismiss reports", target: item.id, primary: false });
  return out;
}

/**
 * Actions that take down something a resident owns. Each one sends its owner a takedown notice
 * naming a rule (decision 0064), so the form asks which.
 */
export const TAKEDOWN_ACTIONS: ReadonlySet<ActionKind> = new Set([
  "hide",
  "remove_pictures",
  "remove_listing",
  "remove_display",
  "remove_piece",
]);

/**
 * The rules a takedown can cite: every report reason but `self_harm`, since someone who may be at
 * risk isn't told they broke a rule (RFC 0006). The server reads it as `other` too.
 */
export const RULE_CHOICES = REPORT_CHOICES.filter((c) => c.reason !== "self_harm");

/**
 * The rule the form starts on: the one most residents' reports named (ties go to the earlier
 * choice), else "Something else". Reports triage raised don't count, so its guess is never
 * preselected.
 */
export function defaultRule(item: Pick<ReportQueueItem, "reports">): ReportReason {
  const counts = new Map<ReportReason, number>();
  for (const r of item.reports) {
    if (r.source === "resident") counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  }
  let best: ReportReason = "other";
  let most = 0;
  for (const { reason } of RULE_CHOICES) {
    const n = counts.get(reason) ?? 0;
    if (n > most) {
      best = reason;
      most = n;
    }
  }
  return best;
}

/** A reason is required for every action, and kept in the log. Undefined when it's fine. */
export function reasonProblem(reason: string): string | undefined {
  const r = reason.trim();
  if (!r) return "Write a reason first. It goes in the log.";
  if (r.length > MODERATION_REASON_MAX_LENGTH) {
    return `Keep the reason to ${MODERATION_REASON_MAX_LENGTH} characters.`;
  }
  return undefined;
}

/** A suspension length the role may give, or why not. */
export function daysProblem(days: number, role: StaffRole): string | undefined {
  const { max } = suspendLimits(role);
  if (!Number.isInteger(days) || days < 1) return "Pick how many days.";
  if (days > max) {
    return role === "maintainer"
      ? `Suspensions go up to ${max} days.`
      : `Moderators can suspend for up to ${max} days. Ask a maintainer for longer.`;
  }
  return undefined;
}

const KIND_WORDS: Record<ReportKind, string> = {
  post: "Post",
  resident: "Resident",
  letter: "Letter",
  notice: "Notice",
  proposal: "Proposal",
  listing: "Listing",
  bounty: "Bounty",
  display: "On display",
  piece: "Piece of art",
  event: "Event",
  plot_name: "Plot name",
};

/** The eyebrow over an item: "Post · 3 reports". */
export function itemHeading(item: ReportQueueItem): string {
  return `${KIND_WORDS[item.kind]} · ${plural(item.reports.length, "report", "reports")}`;
}

/** Short state labels for an item. */
export function itemTags(item: ReportQueueItem): string[] {
  const { target } = item;
  return [
    item.needsHuman ? "A person must look today" : null,
    target.exists ? null : "Gone",
    target.hidden === "auto" ? "Hidden automatically" : null,
    target.hidden === "maintainer" ? "Hidden" : null,
    target.suspended ? "Author suspended" : null,
    target.quarantined ? "Bio and note held back" : null,
  ].filter((t): t is string => t !== null);
}

/** The author's record in one line: "Joined 12 days ago · 1 post hidden · 2 reports". */
export function recordLine(context: ReportQueueItem["context"]): string | undefined {
  const a = context.author;
  if (!a) return undefined;
  const joined =
    a.joinedDaysAgo === 0 ? "Joined today" : `Joined ${plural(a.joinedDaysAgo, "day", "days")} ago`;
  return [
    joined,
    plural(a.postsHidden, "post hidden", "posts hidden"),
    plural(a.suspensions, "suspension", "suspensions"),
    plural(a.reportsAgainst, "report against them", "reports against them"),
    a.strikes > 0
      ? plural(a.strikes, "filter refusal this hour", "filter refusals this hour")
      : null,
  ]
    .filter((p): p is string => p !== null)
    .join(" · ");
}

/** AI triage's suggestion in plain words. Shown as advice; nothing here acts on it. */
export function triageSummary(verdict: TriageVerdictView): {
  suggestion: string;
  detail: string;
  auto: string | undefined;
} {
  const suggestion =
    verdict.action === "suspend" && verdict.days
      ? `${SUGGESTION_LABELS.suspend} for ${plural(verdict.days, "day", "days")}`
      : SUGGESTION_LABELS[verdict.action];
  const detail = [
    CATEGORY_LABELS[verdict.category],
    `${SEVERITY_LABELS[verdict.severity]} severity`,
    `${Math.round(verdict.confidence * 100)}% sure`,
  ].join(" · ");
  const auto =
    verdict.autoAction === "hide_post"
      ? "Triage hid this post on its own. Show it again if that was wrong."
      : verdict.autoAction === "quarantine"
        ? "Triage held back their bio and note on its own. Show them again if that was wrong."
        : undefined;
  return { suggestion, detail, auto };
}

/** A staff sign-in's short name: the part of the email before the "@". */
export const shortStaffName = (email: string) => email.split("@")[0] || email;

/** The sign-in email behind a staff actor, for a tooltip. Undefined for everyone else. */
export function actorEmail(entry: Pick<ModerationLogView, "actor">): string | undefined {
  return entry.actor.startsWith("access:") ? entry.actor.slice("access:".length) : undefined;
}

/** Who did something in the log. A staff sign-in shows as the part of its email before the "@". */
export function actorLabel(entry: Pick<ModerationLogView, "actor" | "actorView">): string {
  if (entry.actor === "triage") return "AI triage";
  if (entry.actor === "system") return "Automatic";
  const email = actorEmail(entry);
  if (email) return shortStaffName(email);
  return entry.actorView?.name ?? entry.actor;
}

/** "Hid a post · post p_1", with the end date for a suspension. */
export function logHeadline(entry: ModerationLogView): string {
  return `${ACTION_LABELS[entry.action]} · ${logTarget(entry)}`;
}

/** "Today", "Yesterday", or "Mon, Oct 5": the heading a day of log entries sits under. */
export function dayLabel(iso: string, nowMs: number): string {
  const day = (ms: number) => new Date(ms).toDateString();
  const at = Date.parse(iso);
  if (day(at) === day(nowMs)) return "Today";
  if (day(at) === day(nowMs - 86_400_000)) return "Yesterday";
  return new Date(at).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** What a log entry acted on, like "post p_1". */
export function logTarget(entry: Pick<ModerationLogView, "kind" | "id">): string {
  return `${KIND_WORDS[entry.kind].toLowerCase()} ${entry.id}`;
}

/** The rule a takedown's owner was told it broke: "Rule told to them: Spam". */
export const ruleLine = (rule: ReportReason) => `Rule told to them: ${reasonLabel(rule)}`;

/** How many residents check in, and how often, in one line. */
export function checkinLine(c: AdminOverviewResponse["checkins"]): string {
  if (c.residentsThisWeek === 0) return "Check-ins: nobody has checked in this week.";
  const week = plural(c.residentsThisWeek, "resident", "residents");
  if (c.residentsToday === null) {
    return `Check-ins: ${week} this week. More numbers once 5 or more check in.`;
  }
  const gap =
    c.medianGapHours === null ? "" : ` Median gap between check-ins: ${c.medianGapHours} hours.`;
  return `Check-ins: ${c.residentsToday} today (${c.scheduledToday ?? 0} on a schedule), ${week} this week.${gap}`;
}

/** How AI triage is doing today, in one line. */
export function triageLine(t: AdminOverviewResponse["triage"], nowMs: number): string {
  if (!t.enabled) return "AI triage is off. Reports wait for people.";
  if (t.pausedUntil && Date.parse(t.pausedUntil) > nowMs) {
    return "AI triage is paused after repeated errors. Reports wait for people until it's back.";
  }
  const n = (x: number) => x.toLocaleString("en-US");
  const used = `AI triage today: ${n(t.callsToday)} of ${n(t.callsPerDay)} calls, ${n(t.tokensToday)} of ${n(t.tokensPerDay)} tokens.`;
  const agreed = t.agreement.decided
    ? ` Staff agreed with it on ${t.agreement.agreed} of ${plural(t.agreement.decided, "decision", "decisions")}.`
    : "";
  return used + agreed;
}

/** Millionths of a dollar as dollars and cents: "$1.20", or "under $0.01" for a little. */
export function dollars(microUsd: number): string {
  if (microUsd > 0 && microUsd < 5_000) return "under $0.01";
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

/** What AI calls cost today and lately, from the spend ledger, in one line. */
export function spendLine(s: AdminOverviewResponse["spend"]): string {
  const total = `AI spend: ${dollars(s.todayMicroUsd)} today, ${dollars(s.windowMicroUsd)} in the last ${s.days} days.`;
  const { chatter } = s;
  if (chatter.calls === 0) return total;
  const made = [
    chatter.notes || !chatter.drafts ? plural(chatter.notes, "note", "notes") : "",
    chatter.drafts ? plural(chatter.drafts, "draft", "drafts") : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const count = chatter.notes + chatter.drafts;
  const each = count > 0 ? ` (${dollars(chatter.microUsd / count)} each)` : "";
  const refused = chatter.refused
    ? `, ${plural(chatter.refused, "answer", "answers")} turned away`
    : "";
  return `${total} Townsfolk chatter: ${made} for ${dollars(chatter.microUsd)}${each}${refused}.`;
}

/**
 * Whether townsfolk chatter draws real residents in: of its notes, how many a real resident replied
 * or reacted to. Undefined until it has put a note up.
 */
export function participationLine(
  p: AdminOverviewResponse["chatter"]["participation"],
  days: number,
): string | undefined {
  if (p.notes === 0) return undefined;
  return `Townsfolk notes in the last ${days} days: ${p.answered} of ${p.notes} drew a reply or reaction from real residents (${plural(p.replies, "reply", "replies")}, ${plural(p.reactions, "reaction", "reactions")}).`;
}

/** What each skip reason means, for the chatter line. */
const CHATTER_SKIPS: Record<string, string> = {
  off: "it was off",
  paused: "it was paused",
  running: "a run was still going",
  busy: "real residents were posting",
  rested: "townsfolk had posted lately",
  nobody: "no townsfolk had anything left to do today",
  capped: "the day's calls or tokens were spent",
  idle: "nobody had anything to post or answer",
};

/** How townsfolk chatter is set up and how its last run went, in one line. */
export function chatterLine(c: AdminOverviewResponse["chatter"], nowMs: number): string {
  if (c.mode === "off") return "Townsfolk chatter is off.";
  if (c.pausedUntil && Date.parse(c.pausedUntil) > nowMs) {
    return "Townsfolk chatter is paused after repeated errors.";
  }
  const when = c.gate === "quiet" ? " while the town is quiet" : "";
  const what = {
    dry: "is a dry run: it writes drafts and does nothing",
    posts: `posts, likes and reacts${when}`,
    all: `posts, replies, reacts, praises, admires plots and waves${when}`,
  }[c.mode];
  const n = (x: number) => x.toLocaleString("en-US");
  const used = ` Today: ${n(c.callsToday)} of ${n(c.callsPerDay)} calls.`;
  const last = c.lastRun
    ? ` Last run: ${CHATTER_SKIPS[c.lastRun.result] ?? plural(c.lastRun.result.split(",").length, "call", "calls")}.`
    : "";
  return `Townsfolk chatter ${what}.${used}${last}`;
}

/** What a dry-run draft was: "would post", or why it was turned away. */
export function draftLabel(d: AdminOverviewResponse["chatter"]["drafts"][number]): string {
  const action =
    (
      {
        post: "a post",
        reply: "a reply",
        like: "a like",
        react: "a reaction",
        praise: "praise",
        admire: "admiring a plot",
        wave: "a wave",
      } as Record<string, string>
    )[d.action] ?? "an answer";
  if (d.outcome.startsWith("draft_")) return `would be ${action}`;
  if (d.outcome === "filtered") return `${action}, turned away by the filters`;
  return `${action}, turned away by the rules`;
}

/** How the townsfolk's daily coin tips are set up and what the last run gave, in one line. */
export function tipsLine(t: AdminOverviewResponse["tips"]): string {
  if (t.mode === "off") return "Townsfolk tips are off here.";
  const what =
    t.mode === "dry"
      ? "Townsfolk tips are a dry run: checked, never given."
      : "Townsfolk tips are on.";
  const last = t.lastRun;
  if (!last) return `${what} No run yet.`;
  if (last.skipped === "nobody") {
    return `${what} Day ${last.day}: no townsfolk had coins to give (their budgets come from what the treasury holds above its reserve).`;
  }
  if (last.skipped) return `${what} Day ${last.day}: nothing to do (${last.skipped}).`;
  const would = last.mode === "dry" ? "would welcome" : "welcomed";
  const parts = [
    `${would} ${plural(last.welcomed, "newcomer", "newcomers")} (${plural(last.welcomeCoins, "coin", "coins")})`,
    ...(last.refused ? [`${last.refused} refused by the world`] : []),
    ...(last.waiting ? [`${last.waiting} waiting for budget`] : []),
    last.post === "tipped"
      ? `${last.mode === "dry" ? "would tip" : "tipped"} the best post ${plural(last.postCoins, "coin", "coins")}`
      : last.post === "refused"
        ? "the best post's tip was refused"
        : "no post to tip",
  ];
  const flags = [
    ...(last.stopped ? [" It stopped partway; tomorrow's run picks up."] : []),
    ...(last.gap ? [" Some newcomers may have been missed (the treasury's history ran out)."] : []),
  ].join("");
  return `${what} Day ${last.day}: ${parts.join(", ")}.${flags}`;
}

// ---------- the townsfolk page ----------

type Activity = TownsfolkActivityResponse["activity"][number];

/** Each townsfolk action's icon, from the shared set. */
export const ACTION_ICONS: Record<TownsfolkAction, IconName> = {
  post: "feed",
  reply: "reply",
  like: "heart",
  react: "smile",
  praise: "star",
  admire: "home",
  wave: "wave",
};

/** Each action counted: one, and more than one. */
const ACTION_COUNTS: Record<TownsfolkAction, [string, string]> = {
  post: ["post", "posts"],
  reply: ["reply", "replies"],
  like: ["like", "likes"],
  react: ["reaction", "reactions"],
  praise: ["praise", "praises"],
  admire: ["plot admired", "plots admired"],
  wave: ["wave", "waves"],
};

/** What one townsfolk resident did today, in counts: "2 posts, 1 reply", or nothing yet. */
export function todayWords(today: Record<TownsfolkAction, number>): string {
  const parts = TOWNSFOLK_ACTIONS.filter((a) => today[a] > 0).map((a) => {
    const [one, many] = ACTION_COUNTS[a];
    return plural(today[a], one, many);
  });
  return parts.length > 0 ? parts.join(", ") : "Nothing yet today";
}

/**
 * What one thing a townsfolk resident did, as a short line: "replied to Ryan", "reacted 🌱 to Ivy's
 * post", "admired Ivy's plot". Names are residents' own words; the page puts the line in as text.
 */
export function activityLine(
  e: Pick<Activity, "action" | "post" | "resident" | "reaction">,
): string {
  const author = e.post?.author.name;
  const person = e.resident?.name;
  switch (e.action) {
    case "post":
      return "posted";
    case "reply":
      return author ? `replied to ${author}` : "replied to a post that's gone";
    case "like":
      return author ? `liked ${author}'s post` : "liked a post that's gone";
    case "react": {
      const emoji = e.reaction ? `${REACTIONS[e.reaction].emoji} ` : "";
      return author
        ? `reacted ${emoji}to ${author}'s post`
        : `reacted ${emoji}to a post that's gone`;
    }
    case "praise":
      return person ? `praised ${person}` : "praised someone who's gone";
    case "admire":
      return person ? `admired ${person}'s plot` : "admired a plot";
    case "wave":
      return person ? `waved to ${person}` : "waved to someone who's gone";
  }
}

/** Chatter's state in one word or two, for the page's first chip. */
export function chatterState(c: TownsfolkActivityResponse["chatter"], nowMs: number): string {
  if (c.mode === "off") return "Off";
  if (c.pausedUntil && Date.parse(c.pausedUntil) > nowMs) return "Paused";
  return c.mode === "dry" ? "Dry run" : "Live";
}

/** When chatter acts: every run, or only while real residents post little. */
export const gateWords = (c: Pick<TownsfolkActivityResponse["chatter"], "gate" | "perRun">) =>
  `${c.gate === "off" ? "Every run" : "Quiet hours only"}, ${plural(c.perRun, "townsfolk", "townsfolk")} a run`;

/** How long ago, in words that read after "Last run" or "Last active": "42m ago", "Oct 5". */
export function sinceWords(iso: string, nowMs: number): string {
  const r = relativeTime(iso, nowMs);
  return r === "now" ? "just now" : /^\d+[mh]$/.test(r) ? `${r} ago` : r;
}
