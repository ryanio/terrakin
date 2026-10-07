import {
  CATALOG_VERSION,
  CHANGELOG_ENTRIES,
  CHECKIN_LIMITS,
  CHECKIN_SUGGESTED_HOURS,
  type CheckinResponse,
  changelogResponse,
  DEVLOG_POSTS,
  devlogEntry,
  type FirstVisitResponse,
  ROUTINE_LIMITS,
} from "@terrakin/protocol";
import {
  heldAsideOf,
  holidayField,
  inventoryOf,
  isTownsfolk,
  skyAt,
  takenDownOf,
  timeOfDayAt,
  type WorldState,
} from "@terrakin/sim";
import { firstVisitSteps, setupSteps } from "./checkin-steps";
import {
  type BookFacts,
  pickSuggestion,
  SUGGEST_AGAIN_DAYS,
  type Suggestions,
  tryStates,
} from "./checkin-suggest";
import { todoLines } from "./checkin-todo";
import { todaysLines } from "./coins";
import { checkinEvents, eventView } from "./events";
import { gamesCheckin } from "./games";
import { gardenOf } from "./items";
import { awayLine } from "./routines";
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
  /**
   * Ready crops in your garden by tile, and things received in gifts today. Absent (or null)
   * before items open, so digests in a world without them stay as they were.
   */
  items?: [string[], number] | null;
  /**
   * Your listings staff took down that wait for room in your things. Absent when there are none,
   * so other digests stay as they were.
   */
  takenDown?: string[];
  /**
   * Your bounties marked done and waiting for you to pay, and the newest open bounty. Absent (or
   * null) before bounties open, so digests in a world without them stay as they were.
   */
  bounties?: [string[], string | null] | null;
  /**
   * Your things taken down from display that wait for room in your things. Absent when there are
   * none, so other digests stay as they were.
   */
  heldAside?: string[];
  /**
   * The away log's newest line and its day count (a folded refusal grows it). Absent when your
   * routines never wrote one, so other digests stay as they were.
   */
  away?: [string, number];
  /**
   * Events you're going to (or host) that start within a day, and events on now. Absent when there
   * are none, so other digests stay as they were.
   */
  events?: [string[], string[]];
  /**
   * Party games: the tables and rounds waiting on your choice, your tables ready to start, and
   * the newest game of yours that ended. Absent (or null) without a seat or a game just ended, so
   * other digests stay as they were.
   */
  games?: [string[], string[], string | null] | null;
  /** The newest devlog post's day. Absent (or null) with no posts, so digests stay as they were. */
  devlog?: string | null;
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
      ...(parts.items ? [parts.items] : []),
      ...(parts.takenDown?.length ? [parts.takenDown] : []),
      ...(parts.bounties ? [parts.bounties] : []),
      ...(parts.heldAside?.length ? [["held", ...parts.heldAside]] : []),
      ...(parts.away ? [["away", ...parts.away]] : []),
      ...(parts.events ? [["events", ...parts.events]] : []),
      ...(parts.games ? [["games", ...parts.games]] : []),
      ...(parts.devlog ? [["devlog", parts.devlog]] : []),
    ]),
  );
}

/**
 * The changelog a check-in carries: entries from the day of `since` on, the newest few of them, and
 * whether they're news. Entries are dated by day, so the day of `since` comes back every time; they
 * are news on a first check-in, on the first check-in of a UTC day, and when an entry is dated after
 * the last check-in's day. The JSON check-in's `todo` and the link check-in's list speak up only
 * then.
 */
export function checkinChangelog(sinceGiven: boolean, since: number, now: number) {
  const sinceDate = new Date(since).toISOString().slice(0, 10);
  const entries = changelogResponse(CHANGELOG_ENTRIES, { since: sinceDate }).entries;
  const changelog = entries.slice(0, CHECKIN_LIMITS.changelog);
  const firstToday = !sinceGiven || since < Math.floor(now / DAY_MS) * DAY_MS;
  const news = changelog.length > 0 && (firstToday || entries.some((e) => e.date > sinceDate));
  return { sinceDate, entries, changelog, news };
}

/** A resident's collection book, as the suggestions that read it see it. */
const bookOf = (social: SocialService, viewer: string): BookFacts => ({
  has: (kind) => social.collection.has(viewer, kind),
});

/**
 * `GET /v1/first-visit`: every first-visit step with whether it's done, the suggestions open to
 * `viewer` or tried, and today's suggestion as their next check-in with news would pick it. Reads
 * only: no check-in is recorded and nothing is marked as suggested, so the check-in that follows
 * answers as it would have. Today's suggestion follows the check-in's rule: none while a step of
 * their own first visit is left, the one they got today if they got one, else the pick. Townsfolk
 * get nothing.
 */
export function firstVisitView(
  state: WorldState,
  social: SocialService,
  viewer: string,
  options: {
    done: ReadonlySet<string>;
    joinedDay?: number | undefined;
    suggestions: Pick<Suggestions, "suggested">;
  },
): FirstVisitResponse {
  if (!state.residents[viewer] || isTownsfolk(state, viewer)) {
    return { steps: [], tries: [], tryToday: null };
  }
  const { done, joinedDay } = options;
  const book = bookOf(social, viewer);
  const setup = setupSteps(state, social, viewer, done, joinedDay);
  const today = Math.floor(social.now() / DAY_MS);
  let tryToday: string | null = null;
  if (setup.firstVisit.length === 0) {
    const asked = options.suggestions.suggested(viewer, today, today - SUGGEST_AGAIN_DAYS);
    tryToday = asked.today
      ? ([...asked.days].find(([, day]) => day === today)?.[0] ?? null)
      : (pickSuggestion({
          state,
          viewer,
          done,
          book,
          later: setup.later,
          quiet: false,
          stepsOnly: false,
          today,
          days: asked.days,
        })?.id ?? null);
  }
  return {
    steps: firstVisitSteps(state, social, viewer, done, joinedDay),
    tries: tryStates(state, viewer, done, book),
    tryToday,
  };
}

/**
 * Everything new for `viewer` since `since`. Notifications and posts come from the same services as
 * the single routes; letters, gestures, and notices also leave out residents blocked either way
 * and residents suspended now, since a check-in brings them up on a schedule. Reads only: nothing
 * is marked read. `todo` is built from counts and ids, never from resident text.
 *
 * `digest` fingerprints what's waiting, not the window `since` picks: unread notifications and
 * letters, the newest gesture, followed post, and notice, open votes, the purse, and the newest
 * changelog entry and devlog post. With `seen` equal to it, the answer is the same shape with
 * `unchanged: true`, the unread counts and purse, and every list empty.
 *
 * It has no `links`: `GET /v1/checkin` adds them on the request's origin (`checkinWithLinks`).
 */
export function checkinView(
  state: WorldState,
  social: SocialService,
  viewer: string,
  options: {
    since: string | undefined;
    seen?: string | undefined;
    /** The command types the viewer has had accepted, ever. */
    done?: ReadonlySet<string>;
    /** Where daily suggestions are remembered. Without it, nothing is suggested. */
    suggestions?: Suggestions;
    /**
     * Suggest only first-visit steps added after the viewer joined: the link check-in's choice,
     * since the rest of the suggestions name API calls.
     */
    stepsOnly?: boolean;
    /**
     * The UTC day the viewer joined, which says which first-visit steps are theirs (decision
     * 0129). Without it, every step is.
     */
    joinedDay?: number | undefined;
    /**
     * When the devlog post of a day came out in this world (`CheckinLog.published`). Without it, a
     * post counts as out from the start of its day.
     */
    devlogAt?: (date: string) => number;
  },
): Omit<CheckinResponse, "links"> {
  const now = social.now();
  const since = checkinSince(options.since, now);
  // What it's like out, read off the same clock as `GET /v1/world` (decision 0073), and the
  // catalog's version, so an agent knows when to read `GET /v1/catalog` again.
  const sky = {
    ...skyAt(now, state.day),
    timeOfDay: timeOfDayAt(now),
    ...holidayField(state.day),
    catalog: CATALOG_VERSION,
  };
  const done = options.done ?? new Set<string>();
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

  const { sinceDate, entries, changelog, news } = checkinChangelog(
    options.since !== undefined,
    since,
    now,
  );
  const today = Math.floor(now / DAY_MS);

  // The devlog (decision 0105): the newest post, once it came out after `since`. Posts are dated by
  // day, so "came out" is when this world first served it, and `since` makes it come once.
  const post = DEVLOG_POSTS[0];
  const postAt = post ? (options.devlogAt?.(post.date) ?? Date.parse(post.date)) : Number.NaN;
  const devlog = post && postAt > since ? devlogEntry(post) : undefined;

  const coins = todaysLines(state, viewer, (id) => social.authorView(id));
  // Only what you planted: anyone who can build on a plot may harvest it, but on a shared plot the
  // check-in leaves a co-owner's crops for them to bring up.
  const ready = gardenOf(state, viewer).filter(
    (c) => c.ready && state.items?.crops[`${c.x},${c.y}`]?.by === viewer,
  );
  const things = inventoryOf(state, viewer);
  const held = takenDownOf(state, viewer).map((l) => l.id);
  const aside = heldAsideOf(state, viewer).map((d) => d.good.id);
  // Bounties (decision 0062): yours that are done and waiting for your pay, and new ones others
  // posted since the last check-in. Ids only, never their words.
  const bountyList = state.bounties?.list;
  const toPay = (bountyList ?? []).filter(
    (b) => b.poster === viewer && b.proposal === undefined && b.status === "done",
  );
  const openBounties = (bountyList ?? []).filter(
    (b) =>
      b.status === "open" && b.poster !== viewer && (b.proposal !== undefined || shown(b.poster)),
  );
  const sinceDay = Math.floor(since / DAY_MS);
  const newBounties = openBounties.filter((b) => b.postedDay >= sinceDay);
  // Events (RFC 0010): ones you're going to or host that start within a day, and what's on now.
  // The todo lines name them by id and time, never by their words.
  const eventCtx = social.eventContext(viewer);
  const events = checkinEvents(state, eventCtx, viewer, DAY_MS);
  const nearIds = [...new Set([...events.soon, ...events.hosting].map((e) => e.id))];

  // What routines did while you were away (RFC 0009): lines from codes and ids, never words.
  const awayRows = social.away.since(viewer, since, ROUTINE_LIMITS.checkinLines);
  const away = awayRows.flatMap((row) => awayLine(social, viewer, row) ?? []);
  const awayRefused = social.away.refusedSince(viewer, since);
  const newestAway = social.away.newest(viewer);
  // Party games (RFC 0011): tables and rounds by id, never a name or anyone's choice.
  const games = gamesCheckin(state, viewer, since, now);

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
    items: things ? [ready.map((c) => `${c.x},${c.y}`), things.receivedToday] : null,
    ...(held.length > 0 ? { takenDown: held } : {}),
    bounties: bountyList ? [toPay.map((b) => b.id), openBounties.at(-1)?.id ?? null] : null,
    ...(aside.length > 0 ? { heldAside: aside } : {}),
    ...(newestAway ? { away: [`a_${newestAway.n}`, newestAway.days] as [string, number] } : {}),
    ...(nearIds.length > 0 || events.live.length > 0
      ? { events: [nearIds, events.live.map((e) => e.id)] as [string[], string[]] }
      : {}),
    games: games
      ? [
          games.yourMove.map((m) => `${m.table}:${m.round}`),
          games.canStart,
          games.ended[0]?.table ?? null,
        ]
      : null,
    devlog: post?.date ?? null,
  });
  const setup = setupSteps(state, social, viewer, done, options.joinedDay);
  const firstVisit = setup.firstVisit.map((s) => s.step);
  // Nothing moved since `seen` and no first-visit step is left: `unchanged`, unless today's
  // suggestion is waiting.
  const quiet = options.seen !== undefined && options.seen === digest && firstVisit.length === 0;
  // Today's suggestion, once a UTC day, and only once the first visit is done.
  const asked = options.suggestions?.suggested(viewer, today, today - SUGGEST_AGAIN_DAYS);
  const suggestion =
    asked && !asked.today && firstVisit.length === 0
      ? pickSuggestion({
          state,
          viewer,
          done,
          book: bookOf(social, viewer),
          later: setup.later,
          quiet,
          stepsOnly: options.stepsOnly ?? false,
          today,
          days: asked.days,
        })
      : null;
  if (suggestion) options.suggestions?.suggest(viewer, suggestion.id, today);
  const tryToday = suggestion?.id ?? null;

  if (quiet && tryToday === null) {
    return {
      at: new Date(now).toISOString(),
      since: new Date(since).toISOString(),
      ...sky,
      notifications: { unread: notes.unread, items: [] },
      letters: { unread: lettersUnread, items: [] },
      gestures: [],
      following: [],
      proposals: [],
      notices: [],
      coins,
      changelog: [],
      away: { items: [], refused: 0 },
      events: { soon: [], live: [] },
      todo: [],
      firstVisit,
      tryToday,
      digest,
      unchanged: true,
      everyHours: CHECKIN_SUGGESTED_HOURS,
    };
  }

  const todo = todoLines({
    state,
    social,
    viewer,
    now,
    sinceDate,
    firstVisit: setup.firstVisit,
    games,
    coins,
    ready,
    things,
    held,
    aside,
    unread: notes.unread,
    notifications,
    toPay,
    newBounties,
    lettersUnread,
    letters,
    gestures,
    proposals,
    following,
    events,
    going: eventCtx.mine,
    changelog: { news, entries: entries.length, shown: changelog.length },
    devlog,
    away,
    suggestion,
  });
  return {
    at: new Date(now).toISOString(),
    since: new Date(since).toISOString(),
    ...sky,
    notifications: { unread: notes.unread, items: notifications },
    letters: { unread: lettersUnread, items: letters },
    gestures,
    following,
    proposals,
    notices,
    coins,
    changelog,
    ...(devlog ? { devlog } : {}),
    away: { items: away, refused: awayRefused },
    events: {
      soon: events.soon.map((e) => eventView(state, e, eventCtx, viewer)),
      live: events.live.map((e) => eventView(state, e, eventCtx, viewer)),
    },
    ...(games ? { games } : {}),
    todo,
    firstVisit,
    tryToday,
    digest,
    everyHours: CHECKIN_SUGGESTED_HOURS,
  };
}
