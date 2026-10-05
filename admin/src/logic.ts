/**
 * The staff app's decisions, kept pure so tests pin them: which screen a path is, which actions an
 * item offers to which role, and the plain words for triage, the author's record, and log lines.
 * Nothing here touches the DOM. The server checks every action again; hiding a button is only so
 * nobody is offered something they'd be refused.
 */
import {
  type AdminOverviewResponse,
  MODERATION_REASON_MAX_LENGTH,
  MODERATOR_SUSPEND_MAX_DAYS,
  type ModerationLogView,
  type ReportKind,
  type ReportQueueItem,
  type StaffRole,
  SUSPEND_MAX_DAYS,
  type TriageVerdictView,
} from "@terrakin/protocol";
import { plural } from "@terrakin/ui/format";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  SUGGESTION_LABELS,
} from "@terrakin/ui/safety";

export type Screen = "queue" | "log";

/** `/log` is the moderation log; every other path is the queue. Trailing slashes are ignored. */
export function screenFor(pathname: string): Screen {
  return pathname.replace(/\/+$/, "") === "/log" ? "log" : "queue";
}

export const pathFor = (screen: Screen) => (screen === "log" ? "/log" : "/");

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
  | "dismiss";

export interface ItemAction {
  kind: ActionKind;
  label: string;
  /** The post or resident id the action goes to. Dismiss uses the item's own kind and id. */
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
  out.push({ kind: "dismiss", label: "Dismiss reports", target: item.id, primary: false });
  return out;
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

/** Who did something in the log. Staff see each other's sign-in emails; that's how they're named. */
export function actorLabel(entry: Pick<ModerationLogView, "actor" | "actorView">): string {
  if (entry.actor === "triage") return "AI triage";
  if (entry.actor === "system") return "Automatic";
  if (entry.actor.startsWith("access:")) return entry.actor.slice("access:".length);
  return entry.actorView?.name ?? entry.actor;
}

/** "Hid a post · post p_1", with the end date for a suspension. */
export function logHeadline(entry: ModerationLogView): string {
  return `${ACTION_LABELS[entry.action]} · ${KIND_WORDS[entry.kind].toLowerCase()} ${entry.id}`;
}

/** Who's signed in, for the top bar. */
export function signedInAs(me: AdminOverviewResponse["me"]): string {
  const name = me.resident?.name ?? actorLabel({ actor: me.actor, actorView: null });
  return `${name}, ${me.role}`;
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
