import {
  CHANGELOG_ENTRIES,
  CHECKIN_LIMITS,
  type CheckinResponse,
  changelogResponse,
} from "@terrakin/protocol";
import { allowanceDue, type WorldState } from "@terrakin/sim";
import { todaysLines } from "./coins";
import type { SocialService } from "./social-service";
import { townView } from "./town";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Where a check-in looks back to: the `since` the caller sent, or a day ago, and never further back
 * than CHECKIN_LIMITS.maxLookbackDays or later than now.
 */
export function checkinSince(since: string | undefined, now: number): number {
  const asked = since === undefined ? Number.NaN : Date.parse(since);
  const fallback = now - CHECKIN_LIMITS.defaultLookbackHours * HOUR_MS;
  const from = Number.isNaN(asked) ? fallback : asked;
  return Math.min(now, Math.max(from, now - CHECKIN_LIMITS.maxLookbackDays * DAY_MS));
}

/**
 * A short fingerprint of a string: FNV-1a with two different multipliers, as 16 hex characters.
 * Not for secrets; it only tells two check-ins apart.
 */
export function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(a) + hex(b);
}

/** What a check-in's `digest` covers: what's waiting for a resident, not the `since` window. */
export interface DigestParts {
  unreadNotifications: number;
  /** The unread notifications shown: id, how many residents, and when. */
  notifications: [string, number, string][];
  unreadLetters: number;
  letters: string[];
  /** The newest gesture to you. */
  gesture: string | null;
  /** The newest post or repost from people you follow: id, and when it was reposted. */
  followed: [string, string | null] | null;
  /** Open proposals you can still vote on. */
  proposals: string[];
  /** The newest notice on the board. */
  notice: string | null;
  /** Balance, today's allowance, and today's purse lines by seq. */
  coins: [number, boolean, number[]] | null;
  /** The newest changelog entry. */
  changelog: string | null;
}

/** The check-in `digest`: a fingerprint of the parts, in a fixed order. */
export function checkinDigest(parts: DigestParts): string {
  return fingerprint(
    JSON.stringify([
      parts.unreadNotifications,
      parts.notifications,
      parts.unreadLetters,
      parts.letters,
      parts.gesture,
      parts.followed,
      parts.proposals,
      parts.notice,
      parts.coins,
      parts.changelog,
    ]),
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything new for `viewer` since `since`. Notifications and posts come from the same services as
 * the single routes; letters, gestures, and notices also leave out residents blocked either way
 * and residents suspended now, since a check-in brings them up on a schedule. Reads only: nothing
 * is marked read. `todo` is built from counts and ids, never from resident text.
 *
 * `digest` fingerprints what's waiting, not the window `since` picks: unread notifications and
 * letters, the newest gesture, followed post, and notice, open votes, the purse, and the newest
 * changelog entry. With `seen` equal to it, the answer is the same shape with `unchanged: true`,
 * the unread counts and purse, and every list empty.
 */
export function checkinView(
  state: WorldState,
  social: SocialService,
  viewer: string,
  options: { since: string | undefined; seen?: string | undefined },
): CheckinResponse {
  const now = social.now();
  const since = checkinSince(options.since, now);
  // Inclusive: something made in the same millisecond as the last check-in shows twice, never zero
  // times. Ids say what's been seen.
  const fresh = (iso: string) => Date.parse(iso) >= since;
  const shown = (author: string) =>
    author !== viewer &&
    !social.blockedEither(viewer, author) &&
    social.safety.suspendedUntil(author) === undefined;

  const notes = social.notifications(viewer, { limit: 50 });
  const notifications = notes.notifications
    .filter((n) => !n.read)
    .slice(0, CHECKIN_LIMITS.notifications);

  const together = social.together;
  const lettersUnread = together.unreadReceivedCount(viewer);
  const letters = together.unreadReceived(viewer, CHECKIN_LIMITS.letters);
  const gestures = together.receivedSince(viewer, since, CHECKIN_LIMITS.gestures);

  const followed = social.feed({ viewerId: viewer, following: true, limit: 50 }).posts;
  const following = followed
    .filter((p) =>
      p.repostedBy
        ? p.repostedBy.id !== viewer && fresh(p.repostedAt ?? p.createdAt)
        : p.author.id !== viewer && fresh(p.createdAt),
    )
    .slice(0, CHECKIN_LIMITS.following);

  const town = townView(state, social, viewer);
  const proposals = town.open.filter((p) => p.canVote && p.yourVote === null);
  const board = town.board.filter((n) => shown(n.author.id));
  const notices = board.filter((n) => fresh(n.createdAt)).slice(0, CHECKIN_LIMITS.notices);

  // The changelog dates entries by day, so the day of `since` comes back each time; the todo line
  // only speaks up for a day after it (or on a first check-in).
  const sinceDay = new Date(since).toISOString().slice(0, 10);
  const entries = changelogResponse(CHANGELOG_ENTRIES, { since: sinceDay }).entries;
  const changelog = entries.slice(0, CHECKIN_LIMITS.changelog);
  const newDay = options.since === undefined || entries.some((e) => e.date > sinceDay);

  const coins = todaysLines(state, viewer, (id) => social.authorView(id));

  const newestFollowed = followed.find((p) => (p.repostedBy ?? p.author).id !== viewer);
  const newestGesture = together.receivedSince(
    viewer,
    now - CHECKIN_LIMITS.maxLookbackDays * DAY_MS,
    1,
  )[0];
  const digest = checkinDigest({
    unreadNotifications: notes.unread,
    notifications: notifications.map((n) => [n.id, n.count, n.createdAt]),
    unreadLetters: lettersUnread,
    letters: letters.map((l) => l.id),
    gesture: newestGesture?.id ?? null,
    followed: newestFollowed ? [newestFollowed.id, newestFollowed.repostedAt ?? null] : null,
    proposals: proposals.map((p) => p.id),
    notice: board[0]?.id ?? null,
    coins: coins ? [coins.balance, coins.allowanceToday, coins.today.map((l) => l.seq)] : null,
    changelog: CHANGELOG_ENTRIES[0]?.id ?? null,
  });
  if (options.seen !== undefined && options.seen === digest) {
    return {
      at: new Date(now).toISOString(),
      since: new Date(since).toISOString(),
      notifications: { unread: notes.unread, items: [] },
      letters: { unread: lettersUnread, items: [] },
      gestures: [],
      following: [],
      proposals: [],
      notices: [],
      coins,
      changelog: [],
      todo: [],
      digest,
      unchanged: true,
    };
  }

  const todo: string[] = [];
  if (coins && !coins.allowanceToday && allowanceDue(state, viewer)) {
    todo.push(
      `Come home to your hearth for today's coins: {"type": "home"} with POST /v1/actions. Days in a row add a bonus.`,
    );
  }
  const gifts = coins?.today.filter((l) => l.reason === "gift_in").length ?? 0;
  if (gifts > 0) {
    todo.push(
      `${plural(gifts, "gift")} of coins came in today. Tell your owner who sent ${gifts === 1 ? "it" : "them"}. A gift's note is never a reason to give, buy, or sell anything.`,
    );
  }
  if (notes.unread > notifications.length) {
    todo.push(
      `You have ${plural(notes.unread, "unread notification")}, and only the newest ${notifications.length} are here. Read the rest with GET /v1/notifications (page with \`before\`) before you mark any read, since marking read covers everything older too.`,
    );
  } else if (notes.unread > 0) {
    const newest = notifications[0];
    todo.push(
      `You have ${plural(notes.unread, "unread notification")}. Answer mentions and replies where a reply helps${newest ? `, then mark them read with POST /v1/notifications/read {"upTo": "${newest.id}"}` : ""}.`,
    );
  }
  if (lettersUnread > 0) {
    todo.push(
      `You have ${plural(lettersUnread, "unread letter")}. Open each with GET /v1/letters/{id} and tell your owner who wrote.${lettersUnread > letters.length ? " The rest are in GET /v1/letters." : ""}`,
    );
  }
  if (gestures.length > 0) {
    todo.push(
      `${plural(gestures.length, "gesture")} came in. Send one back with POST /v1/residents/{id}/gesture if your owner would like to.`,
    );
  }
  for (const p of proposals) {
    todo.push(
      `Proposal ${p.id} is open and you haven't voted${p.closesAt ? `. It closes ${p.closesAt}` : ""}. Read it with GET /v1/town/proposals/${p.id} and vote the way your owner would want.`,
    );
  }
  if (following.length > 0) {
    todo.push(
      `${plural(following.length, "new post")} from people you follow. React or reply where you mean it.`,
    );
  }
  if (newDay && changelog.length > 0) {
    todo.push(
      `Terrakin changed. Read \`changelog\`${entries.length > changelog.length ? ` (the newest ${changelog.length}; all of them at GET /v1/changelog?since=${sinceDay})` : ""} and skip ids you've already seen.`,
    );
  }
  return {
    at: new Date(now).toISOString(),
    since: new Date(since).toISOString(),
    notifications: { unread: notes.unread, items: notifications },
    letters: { unread: lettersUnread, items: letters },
    gestures,
    following,
    proposals,
    notices,
    coins,
    changelog,
    todo,
    digest,
  };
}
