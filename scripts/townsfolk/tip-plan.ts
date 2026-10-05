/**
 * Who the townsfolk give coins to today, worked out from what the API shows (tips.ts reads it).
 * Pure: no network, no clock, no files, so the tests can feed it fixtures.
 *
 * Two kinds of gift, both from a townsfolk resident's daily budget:
 * - A welcome of 10 to each resident who got a welcome gift from the treasury since the last run.
 * - One tip of up to 25 to the author of the most-reacted post of the last day, if it isn't by
 *   townsfolk.
 *
 * The sim has the final say (25 a resident a day from all townsfolk together, never to townsfolk or
 * maintainers), and tips.ts treats its refusals as normal. This only plans gifts that should fit.
 */

/** The amounts. `perResident` must match the sim's `ECONOMY.townsfolkPerResident` (a test checks). */
export const TIPS = {
  /** To each newcomer. */
  welcome: 10,
  /** The most for the day's best post. */
  post: 25,
  /** The most all townsfolk together give one resident in a UTC day. */
  perResident: 25,
  /** How far back a post counts as "of the last day". */
  postWindowMs: 86_400_000,
  /** Best posts to try, in order, when the sim refuses one (a maintainer's, say). */
  postCandidates: 3,
  /** Posts remembered as tipped, so one that stays on top isn't tipped two days running. */
  rememberPosts: 50,
} as const;

/** A townsfolk resident who can give, with today's purse. */
export interface Giver {
  key: string;
  name: string;
  residentId: string;
  balance: number;
  /** Their purse ledger, as ids. */
  ledger: LedgerEntry[];
  notes: { welcome: string; post: string };
}

export interface LedgerEntry {
  day: number;
  amount: number;
  reason: string;
  /** The other resident's id, on a gift. */
  with?: string;
  note?: string;
}

/** A welcome gift the treasury paid, from its public ledger. */
export interface WelcomeLine {
  seq: number;
  day: number;
  residentId: string;
  name: string;
}

export interface FeedPost {
  id: string;
  authorId: string;
  authorName: string;
  authorTownsfolk: boolean;
  /** ISO time. */
  createdAt: string;
  /** All reactions together. */
  reactions: number;
}

/** What tips.ts remembers between runs. */
export interface TipState {
  /** Treasury welcome lines up to this seq are done with: given, skipped, or refused. */
  welcomedThrough?: number;
  /** The last UTC day a best-post tip was tried. */
  postTipDay?: number;
  /** Posts already tipped, newest last. */
  tippedPosts: string[];
}

export interface TipInput {
  /** Today, in UTC days since 1970-01-01, from `GET /v1/town`. */
  today: number;
  /** Now, in ms. */
  now: number;
  givers: Giver[];
  /** Every townsfolk id in the world (`GET /v1/world`). */
  townsfolk: string[];
  welcomes: WelcomeLine[];
  posts: FeedPost[];
  state: TipState;
}

export interface PlannedGift {
  why: "welcome" | "post";
  from: { key: string; name: string; residentId: string };
  to: string;
  toName: string;
  amount: number;
  note: string;
  /** The treasury welcome line this answers. */
  seq?: number;
  /** The post this tips. */
  postId?: string;
}

/** One newcomer, in the order they were welcomed: a gift to send, or a reason to skip. */
export type WelcomeStep =
  | { seq: number; gift: PlannedGift }
  | { seq: number; skip: string; name: string };

export interface TipPlan {
  /**
   * Newcomers in seq order. Once each is sent or refused, the state may move `welcomedThrough` to
   * its seq. Newcomers after `unfunded` aren't listed: they wait for a run with budget left.
   */
  welcomes: WelcomeStep[];
  /** How many newcomers wait because the budgets ran out. */
  unfunded: number;
  /** Best-post tips to try in order; stop at the first one the sim accepts. */
  posts: PlannedGift[];
  /** Why there's no best-post tip, when there isn't one. */
  noPostTip?: string;
  /** A starting point for `welcomedThrough` on a first run, so older welcomes are never revisited. */
  baseline?: number;
}

/** What all townsfolk gave each resident today, from their ledgers. */
export function givenToday(givers: Giver[], today: number): Map<string, number> {
  const given = new Map<string, number>();
  for (const g of givers) {
    for (const line of g.ledger) {
      if (line.reason !== "gift_out" || line.day !== today || line.with === undefined) continue;
      given.set(line.with, (given.get(line.with) ?? 0) - line.amount);
    }
  }
  return given;
}

/** Residents a townsfolk gift with one of these notes went to, on `day` or (without it) ever. */
function giftedWith(givers: Giver[], notes: Set<string>, day?: number): Set<string> {
  const to = new Set<string>();
  for (const g of givers) {
    for (const line of g.ledger) {
      if (line.reason !== "gift_out" || line.with === undefined || line.note === undefined)
        continue;
      if (day !== undefined && line.day !== day) continue;
      if (notes.has(line.note)) to.add(line.with);
    }
  }
  return to;
}

export function planTips(input: TipInput): TipPlan {
  const { today, givers, state } = input;
  const townsfolk = new Set([...input.townsfolk, ...givers.map((g) => g.residentId)]);
  const given = givenToday(givers, today);
  const balance = new Map(givers.map((g) => [g.key, g.balance]));
  const giveTo = (id: string) => TIPS.perResident - (given.get(id) ?? 0);
  const welcomeNotes = new Set(givers.map((g) => g.notes.welcome));
  const postNotes = new Set(givers.map((g) => g.notes.post));
  const welcomedBefore = giftedWith(givers, welcomeNotes);

  // Newcomers since the last run. On the first run, only today's and yesterday's.
  const lines = [...input.welcomes].sort((a, b) => a.seq - b.seq);
  const since = state.welcomedThrough;
  const fresh = lines.filter((l) => (since === undefined ? l.day >= today - 1 : l.seq > since));
  const older = lines.filter((l) => since === undefined && l.day < today - 1);
  const baseline = older.length > 0 ? older[older.length - 1]?.seq : undefined;

  const plan: TipPlan = {
    welcomes: [],
    unfunded: 0,
    posts: [],
    ...(since === undefined && baseline !== undefined ? { baseline } : {}),
  };

  // Each newcomer goes to the next townsfolk in turn, starting somewhere new each day.
  let turn = givers.length > 0 ? today % givers.length : 0;
  const seen = new Set<string>();
  for (const [i, line] of fresh.entries()) {
    const skip = (why: string) => plan.welcomes.push({ seq: line.seq, skip: why, name: line.name });
    if (townsfolk.has(line.residentId)) {
      skip("townsfolk");
      continue;
    }
    if (seen.has(line.residentId) || welcomedBefore.has(line.residentId)) {
      skip("already welcomed");
      continue;
    }
    seen.add(line.residentId);
    const amount = Math.min(TIPS.welcome, giveTo(line.residentId));
    if (amount < 1) {
      skip("had their townsfolk coins for today");
      continue;
    }
    let giver: Giver | undefined;
    for (let k = 0; k < givers.length; k++) {
      const g = givers[(turn + k) % givers.length];
      if (g && (balance.get(g.key) ?? 0) >= amount) {
        giver = g;
        turn = (turn + k + 1) % givers.length;
        break;
      }
    }
    if (!giver) {
      plan.unfunded = fresh.length - i;
      break;
    }
    balance.set(giver.key, (balance.get(giver.key) ?? 0) - amount);
    given.set(line.residentId, (given.get(line.residentId) ?? 0) + amount);
    plan.welcomes.push({
      seq: line.seq,
      gift: {
        why: "welcome",
        from: { key: giver.key, name: giver.name, residentId: giver.residentId },
        to: line.residentId,
        toName: line.name,
        amount,
        note: giver.notes.welcome,
        seq: line.seq,
      },
    });
  }

  // The day's best post.
  if (state.postTipDay === today || giftedWith(givers, postNotes, today).size > 0) {
    plan.noPostTip = "already tipped a post today";
    return plan;
  }
  const tipped = new Set(state.tippedPosts);
  const ranked = input.posts
    .filter(
      (p) =>
        p.reactions > 0 &&
        !p.authorTownsfolk &&
        !townsfolk.has(p.authorId) &&
        !tipped.has(p.id) &&
        input.now - Date.parse(p.createdAt) <= TIPS.postWindowMs,
    )
    .sort(
      (a, b) =>
        b.reactions - a.reactions ||
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (a.id < b.id ? -1 : 1),
    );
  if (ranked.length === 0) {
    plan.noPostTip = "no post from the last day with a reaction";
    return plan;
  }
  // Whoever has the most left gives it; ties go to the earlier persona.
  const giver = [...givers].sort(
    (a, b) => (balance.get(b.key) ?? 0) - (balance.get(a.key) ?? 0),
  )[0];
  const purse = giver ? (balance.get(giver.key) ?? 0) : 0;
  if (!giver || purse < 1) {
    plan.noPostTip = "no budget left";
    return plan;
  }
  const authors = new Set<string>();
  for (const post of ranked) {
    if (plan.posts.length >= TIPS.postCandidates) break;
    if (authors.has(post.authorId)) continue;
    authors.add(post.authorId);
    const amount = Math.min(TIPS.post, giveTo(post.authorId), purse);
    if (amount < 1) continue;
    plan.posts.push({
      why: "post",
      from: { key: giver.key, name: giver.name, residentId: giver.residentId },
      to: post.authorId,
      toName: post.authorName,
      amount,
      note: giver.notes.post,
      postId: post.id,
    });
  }
  if (plan.posts.length === 0) plan.noPostTip = "the best posts' authors had their coins today";
  return plan;
}

/** The state after a run, given which newcomer seqs were sent or refused and the post outcome. */
export function nextState(
  state: TipState,
  plan: TipPlan,
  done: { welcomedThrough?: number; postTried: boolean; postTipped?: string; today: number },
): TipState {
  const welcomedThrough = done.welcomedThrough ?? state.welcomedThrough ?? plan.baseline;
  const tippedPosts = done.postTipped
    ? [...state.tippedPosts, done.postTipped].slice(-TIPS.rememberPosts)
    : state.tippedPosts;
  return {
    ...(welcomedThrough === undefined ? {} : { welcomedThrough }),
    ...(done.postTried
      ? { postTipDay: done.today }
      : state.postTipDay === undefined
        ? {}
        : { postTipDay: state.postTipDay }),
    tippedPosts,
  };
}
