import { KARMA, type KarmaView, karmaTier, tierAtLeast } from "@terrakin/protocol";
import { type DailyAward, ECONOMY, type Resident } from "@terrakin/sim";
import type { SqlExec } from "./sql-store";
import { DAY_MS, utcDay } from "./together";
import type { WorldCredit } from "./world-service";

/**
 * Karma (RFC 0008 phase 3, decision 0055): standing earned from other residents' appreciation over
 * the last 90 whole UTC days, up to yesterday. It lives here with the social data, outside the
 * sim, and reaches coins only through the logged `daily_awards`.
 */

/** Who appreciated whom, and when. Days are UTC days. */
export interface KarmaFacts {
  /** A resident who reacted to someone's visible posts on a day, once per pair per day. */
  reactions: { from: string; to: string; day: number }[];
  /** One row per praise (already once a day per pair). */
  praise: { from: string; to: string; day: number }[];
  /** A resident who admired something `to` made, on display, on a day. Once per pair per day. */
  admires?: { from: string; to: string; day: number }[];
  /** Coins or a thing given. Several on one day from the same giver count once. */
  gifts: { from: string; to: string; day: number }[];
  /** A reply of `to`'s that the post's author, `from`, hearted. One per reply. */
  heartedReplies: { from: string; to: string }[];
  /** A Town Hall vote. Changing a vote still counts the proposal once. */
  votes: { from: string; proposal: string }[];
  /** A resident whose post, profile, letter, notice, or proposal staff acted on after a report. */
  upheld: string[];
}

export interface KarmaRules {
  /** Whether appreciation from this resident counts: not townsfolk, not suspended. */
  counts: (from: string) => boolean;
  /** Whether two residents are one household: a person and their AI, or two AIs of one person. */
  paired: (a: string, b: string) => boolean;
}

/**
 * Every resident's karma from the facts. Reactions and praise are weighted by the giver's tier, and
 * that tier is read from a first pass where each counts what a Newcomer's would, so one more pass
 * settles it and nobody's weight depends on their own. Scores never go below 0.
 */
export function scoreKarma(facts: KarmaFacts, rules: KarmaRules): Map<string, KarmaView> {
  const from = (f: string, to: string) => f !== to && rules.counts(f) && !rules.paired(f, to);
  const add = (map: Map<string, number>, id: string, n: number) =>
    map.set(id, (map.get(id) ?? 0) + n);
  const once = new Set<string>();
  const first = (key: string) => {
    if (once.has(key)) return false;
    once.add(key);
    return true;
  };

  // Everything but reactions and praise is the same in both passes.
  const rest = new Map<string, number>();
  for (const g of facts.gifts) {
    if (from(g.from, g.to) && first(`gift ${g.from} ${g.to} ${g.day}`)) add(rest, g.to, KARMA.gift);
  }
  for (const r of facts.heartedReplies) if (from(r.from, r.to)) add(rest, r.to, KARMA.heartedReply);
  for (const v of facts.votes)
    if (first(`vote ${v.from} ${v.proposal}`)) add(rest, v.from, KARMA.vote);
  for (const id of facts.upheld) add(rest, id, -KARMA.upheldReport);
  const reactions = facts.reactions.filter(
    (r) => from(r.from, r.to) && first(`reaction ${r.from} ${r.to} ${r.day}`),
  );
  const praise = facts.praise.filter((p) => from(p.from, p.to));
  const admires = (facts.admires ?? []).filter(
    (a) => from(a.from, a.to) && first(`admire ${a.from} ${a.to} ${a.day}`),
  );

  const base = new Map(rest);
  for (const r of reactions) add(base, r.to, KARMA.reaction.newcomer);
  for (const p of praise) add(base, p.to, KARMA.praise.newcomer);
  for (const a of admires) add(base, a.to, KARMA.admire.newcomer);
  const tierOf = (id: string) => karmaTier(Math.max(0, base.get(id) ?? 0));
  const final = new Map(rest);
  for (const r of reactions) add(final, r.to, KARMA.reaction[tierOf(r.from)]);
  for (const p of praise) add(final, p.to, KARMA.praise[tierOf(p.from)]);
  for (const a of admires) add(final, a.to, KARMA.admire[tierOf(a.from)]);
  const scores = new Map<string, KarmaView>();
  for (const [id, n] of final) {
    const score = Math.max(0, n);
    scores.set(id, { score, tier: karmaTier(score) });
  }
  return scores;
}

export interface KarmaOptions {
  sql: SqlExec;
  now: () => number;
  /** The team's townsfolk. Their appreciation counts for nobody, and they get no awards. */
  townsfolk: ReadonlySet<string>;
  suspended: (id: string) => boolean;
  /** Owner-linked pairs, as (agent, owner). */
  ownerPairs: () => readonly (readonly [string, string])[];
  /** Gifts and votes from the world's log, from a day on. Default: none. */
  credits?: ((sinceDay: number) => readonly WorldCredit[]) | undefined;
  /** Who was a report upheld against, between two times. */
  upheldAgainst: (fromMs: number, toMs: number) => string[];
  resident: (id: string) => Resident | undefined;
  /** Whole UTC days since a resident joined (`WorldService.residentAgeDays`). */
  ageDays: (id: string) => number;
}

const NEWCOMER: KarmaView = { score: 0, tier: "newcomer" };

export class KarmaService {
  /** Every score, worked out once per UTC day: karma counts up to yesterday, so it holds all day. */
  private cache: { day: number; scores: Map<string, KarmaView> } | undefined;

  private readonly o: KarmaOptions;

  constructor(options: KarmaOptions) {
    this.o = options;
    // Who admired whose work on display, once per pair per day. The world log holds the admires,
    // but not whose work each was, so the server keeps that here as they happen.
    this.o.sql.exec(
      `CREATE TABLE IF NOT EXISTS admires (
        admirer TEXT NOT NULL, maker TEXT NOT NULL, day INTEGER NOT NULL,
        PRIMARY KEY (admirer, maker, day)
      )`,
    );
  }

  /** Remember that `admirer` admired something `maker` made, on `day`. */
  recordAdmire(admirer: string, maker: string, day: number) {
    this.o.sql.exec(
      "INSERT OR IGNORE INTO admires (admirer, maker, day) VALUES (?, ?, ?)",
      admirer,
      maker,
      day,
    );
  }

  private rows(query: string, ...bindings: (string | number)[]) {
    return [...this.o.sql.exec(query, ...bindings)];
  }

  private rules(): KarmaRules {
    // A household is a person and every AI they've claimed: none of them counts for another.
    const ownerOf = new Map(this.o.ownerPairs().map(([agent, owner]) => [agent, owner]));
    const household = (id: string) => ownerOf.get(id) ?? id;
    return {
      counts: (id) => !this.o.townsfolk.has(id) && !this.o.suspended(id),
      paired: (a, b) => household(a) === household(b),
    };
  }

  /** Residents who reacted to someone's visible posts, once per pair per day, in `[from, to)`. */
  private reactions(fromDay: number, toDay: number): KarmaFacts["reactions"] {
    return this.rows(
      `SELECT p.author AS to_id, r.resident_id AS from_id, r.created_at / ${DAY_MS} AS day
        FROM reactions r JOIN posts p ON p.id = r.post_id
        WHERE p.hidden = 0 AND r.created_at >= ? AND r.created_at < ? AND r.resident_id <> p.author
        GROUP BY p.author, r.resident_id, day`,
      fromDay * DAY_MS,
      toDay * DAY_MS,
    ).map((row) => ({ from: String(row.from_id), to: String(row.to_id), day: Number(row.day) }));
  }

  /** What karma reads for the days `[from, to)`. */
  facts(fromDay: number, toDay: number): KarmaFacts {
    const praise = this.rows(
      "SELECT giver, receiver, day FROM praise WHERE day >= ? AND day < ?",
      fromDay,
      toDay,
    ).map((row) => ({ from: String(row.giver), to: String(row.receiver), day: Number(row.day) }));
    const heartedReplies = this.rows(
      `SELECT reply.author AS to_id, parent.author AS from_id
        FROM reactions r
        JOIN posts reply ON reply.id = r.post_id
        JOIN posts parent ON parent.id = reply.reply_to
        WHERE r.key = 'heart' AND r.resident_id = parent.author AND reply.hidden = 0
          AND r.created_at >= ? AND r.created_at < ?`,
      fromDay * DAY_MS,
      toDay * DAY_MS,
    ).map((row) => ({ from: String(row.from_id), to: String(row.to_id) }));
    const credits = (this.o.credits?.(fromDay) ?? []).filter((c) => c.day < toDay);
    const admires = this.rows(
      "SELECT admirer, maker, day FROM admires WHERE day >= ? AND day < ?",
      fromDay,
      toDay,
    ).map((row) => ({ from: String(row.admirer), to: String(row.maker), day: Number(row.day) }));
    return {
      reactions: this.reactions(fromDay, toDay),
      praise,
      admires,
      gifts: credits.flatMap((c) => (c.kind === "gift" ? [c] : [])),
      heartedReplies,
      votes: credits.flatMap((c) => (c.kind === "vote" ? [c] : [])),
      upheld: this.o.upheldAgainst(fromDay * DAY_MS, toDay * DAY_MS),
    };
  }

  /** Everyone's karma, up to yesterday. */
  all(): Map<string, KarmaView> {
    const today = utcDay(this.o.now());
    if (this.cache?.day !== today) this.cache = { day: today, scores: this.scoresBefore(today) };
    return this.cache.scores;
  }

  /** Everyone's karma over the 90 days before `day`. */
  private scoresBefore(day: number): Map<string, KarmaView> {
    return scoreKarma(this.facts(day - KARMA.windowDays, day), this.rules());
  }

  /** One resident's karma. */
  of(id: string): KarmaView {
    return this.all().get(id) ?? NEWCOMER;
  }

  /**
   * Appreciation coins for `day`: for each resident, 1 for every other resident who reacted to
   * their visible posts that day, up to `ECONOMY.appreciationCap`. A reaction counts only from a
   * resident who was at least Neighbor when the day began, has a hearth now, and was at least
   * `KARMA.appreciationMinAgeDays` old that day, and never from yourself, your household (a person
   * and the AIs they claimed), the townsfolk, or a suspended resident. Townsfolk and suspended residents get none. Sorted by
   * resident, so the logged input doesn't depend on row order.
   */
  awards(day: number): DailyAward[] {
    // Tiers as they stood when the day began, so the day's own praise can't lift a reactor.
    const scores = this.scoresBefore(day);
    const rules = this.rules();
    const daysAgo = utcDay(this.o.now()) - day;
    const counted = new Map<string, Set<string>>();
    for (const { from, to } of this.reactions(day, day + 1)) {
      if (from === to || !rules.counts(from) || rules.paired(from, to)) continue;
      if (!rules.counts(to) || !this.o.resident(to)) continue;
      if (!tierAtLeast((scores.get(from) ?? NEWCOMER).tier, KARMA.appreciationTier)) continue;
      if (!this.o.resident(from)?.hearth) continue;
      if (this.o.ageDays(from) - daysAgo < KARMA.appreciationMinAgeDays) continue;
      const set = counted.get(to) ?? new Set<string>();
      set.add(from);
      counted.set(to, set);
    }
    return [...counted.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([to, reactors]) => ({
        to,
        amount: Math.min(reactors.size, ECONOMY.appreciationCap),
        reason: "appreciation" as const,
      }));
  }
}
