import { purseOf, residentById, treasuryOf } from "@terrakin/sim";
import type { SocialService } from "./social-service";
import type { SqlExec } from "./sql-store";
import {
  ALL_TIP_NOTES,
  type FeedPost,
  type Giver,
  type LedgerEntry,
  nextState,
  type PlannedGift,
  planTips,
  TIP_NOTES,
  TIPS,
  type TipState,
  tipNotesFor,
  type WelcomeLine,
} from "./tip-plan";
import type { WorldService } from "./world-service";

/**
 * The townsfolk's daily coin tips, run inside the world once a day (docs/plans/townsfolk-chatter.md,
 * "Coins"): 10 coins to each newcomer since the last run, and a tip for the day's most-reacted post
 * that isn't by townsfolk. The choosing is `planTips` (`tip-plan.ts`), the same plan
 * `scripts/townsfolk/tips.ts` makes through the public API.
 *
 * Each gift goes through `WorldService.act`, the action path `/v1/actions` uses, as the townsfolk
 * resident giving it, so the sim checks every gift exactly as before: 25 coins a day to one resident
 * from all townsfolk together, none to townsfolk or maintainers, none across a block. There is no
 * model call, so there is no spend guard; those caps are the guard. Like the route, it calls
 * `WorldService.arrive` first: once the world has implicit presence (decision 0071), a giver who was
 * away comes back with the gift itself, and the idle sweep takes them out again.
 *
 * A refusal is counted by its code and the run moves on, never retried. A thrown error stops the
 * run; the state is saved after each gift, so the next day's run picks up. It runs at most once a
 * UTC day in each mode, however often it's called. `dry` plans and checks each gift with the sim's
 * own dry run and gives nothing. Logs carry counts and codes only.
 */

export type TipsMode = "off" | "dry" | "on";
const TIPS_MODES: readonly TipsMode[] = ["off", "dry", "on"];

/** `TERRAKIN_TIPS`: `off` (the default), `dry`, or `on`. */
export function tipsMode(env: { TERRAKIN_TIPS?: string | undefined }): TipsMode {
  const mode = env.TERRAKIN_TIPS?.trim();
  return TIPS_MODES.includes(mode as TipsMode) ? (mode as TipsMode) : "off";
}

/** How often the Node server asks; the run itself goes once a day. */
export const TIPS_CHECK_MS = 3_600_000;

/** What a run came to. Counts and codes only. */
export interface TipsResult {
  /** Why nothing was planned: off, coins not open, already run today, or no townsfolk with a purse. */
  skipped?: "off" | "closed" | "done" | "nobody";
  /** Newcomers given a welcome (in a dry run, who would be). */
  welcomed: number;
  /** Newcomer gifts the sim refused. */
  refused: number;
  /** Newcomers the plan passed over: townsfolk, already welcomed, or at the day's limit. */
  skippedNewcomers: number;
  /** Newcomers waiting for tomorrow's budgets. */
  waiting: number;
  /** Coins given to newcomers. */
  welcomeCoins: number;
  /** The day's post tip: given, refused for every candidate, or none to give. */
  post: "tipped" | "refused" | "none";
  postCoins: number;
  /** The treasury's history no longer reached back to the last run, so a newcomer may be missed. */
  gap: boolean;
  /** An error stopped the run partway. */
  stopped: boolean;
  /** The sim's refusal codes, in order. */
  codes: string[];
}

const EMPTY: TipsResult = {
  welcomed: 0,
  refused: 0,
  skippedNewcomers: 0,
  waiting: 0,
  welcomeCoins: 0,
  post: "none",
  postCoins: 0,
  gap: false,
  stopped: false,
  codes: [],
};

export interface TownsfolkTipsOptions {
  mode: TipsMode;
  world: WorldService;
  social: SocialService;
  /** The founding townsfolk, from `TERRAKIN_TOWNSFOLK`. */
  townsfolk: ReadonlySet<string>;
  now?: () => number;
}

type Outcome = { kind: "sent" } | { kind: "refused"; code: string } | { kind: "stop" };

/**
 * A welcome visit's tip: given, checked by a dry run and not given, refused by the sim (`stopped` for a refusal
 * about the giver or the server), or none: tips off, coins not open, the giver can't give today,
 * not due, or no budget.
 */
export type WelcomeTip =
  | { kind: "sent"; amount: number }
  | { kind: "checked"; amount: number }
  | { kind: "refused"; code: string }
  | { kind: "none"; why: "off" | "closed" | "giver" | "not_due" | "no_budget" };

/**
 * Refusals about the giver or the server, not the newcomer: a failed log write (`internal`), a giver
 * in a filter cool-down (`rate_limited`), or one the world doesn't know (`unauthorized`). These stop
 * the run, so the newcomer is tried again the next day instead of being passed over.
 */
const STOP_CODES: ReadonlySet<string> = new Set(["internal", "rate_limited", "unauthorized"]);

/** The daily cron in wrangler.jsonc, just after midnight UTC. A test keeps the two the same. */
export const TIPS_CRON = "7 0 * * *";

/** A treasury ledger line, as the sim keeps it. */
interface TreasuryLine {
  seq: number;
  day: number;
  reason: string;
  with?: string;
}

/** The order the personas were written in, so turns go round as the script's do. */
const PERSONA_ORDER = Object.keys(TIP_NOTES);

export class TownsfolkTips {
  readonly mode: TipsMode;
  private readonly world: WorldService;
  private readonly social: SocialService;
  private readonly townsfolk: ReadonlySet<string>;
  private readonly sql: SqlExec;
  private readonly now: () => number;

  constructor(options: TownsfolkTipsOptions) {
    this.mode = options.mode;
    this.world = options.world;
    this.social = options.social;
    this.townsfolk = options.townsfolk;
    this.sql = options.social.sql;
    this.now = options.now ?? Date.now;
    for (const statement of [
      // What the script kept in its state file: newcomers handled, the last post tip, posts tipped.
      `CREATE TABLE IF NOT EXISTS townsfolk_tips (
        id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL
      )`,
      // Newcomers a welcome visit tipped (decision 0142), so the daily run never tips them again.
      `CREATE TABLE IF NOT EXISTS townsfolk_tips_welcomed (
        resident_id TEXT PRIMARY KEY, at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS townsfolk_tips_runs (
        n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, day INTEGER NOT NULL,
        mode TEXT NOT NULL, result TEXT NOT NULL
      )`,
    ]) {
      this.sql.exec(statement);
    }
  }

  /** The last run: when, which world day, in which mode, and what it came to. */
  lastRun(): { at: number; day: number; mode: TipsMode; result: TipsResult } | null {
    const row = [
      ...this.sql.exec(
        "SELECT at, day, mode, result FROM townsfolk_tips_runs ORDER BY n DESC LIMIT 1",
      ),
    ][0];
    if (!row) return null;
    return {
      at: Number(row.at),
      day: Number(row.day),
      mode: String(row.mode) as TipsMode,
      result: { ...EMPTY, ...(JSON.parse(String(row.result)) as Partial<TipsResult>) },
    };
  }

  /** What's remembered between runs. A lost row is safe: the purse ledgers show who was welcomed. */
  state(): TipState {
    const row = [...this.sql.exec("SELECT state FROM townsfolk_tips WHERE id = 1")][0];
    if (!row) return { tippedPosts: [] };
    const state = JSON.parse(String(row.state)) as TipState;
    return { ...state, tippedPosts: state.tippedPosts ?? [] };
  }

  private save(state: TipState) {
    this.sql.exec(
      `INSERT INTO townsfolk_tips (id, state) VALUES (1, ?)
        ON CONFLICT (id) DO UPDATE SET state = excluded.state`,
      JSON.stringify(state),
    );
  }

  /** Give today's tips (or, in a dry run, check them). Once a UTC day per mode. */
  run(): TipsResult {
    if (this.mode === "off") return { ...EMPTY, skipped: "off" };
    const world = this.world.state;
    const today = world.day;
    const treasury = treasuryOf(world);
    if (today === undefined || !treasury) return { ...EMPTY, skipped: "closed" };
    if (this.ranOn(today)) return { ...EMPTY, skipped: "done" };
    // Filled in as the run goes, so an error partway still records what went out.
    const result: TipsResult = { ...EMPTY, codes: [] };
    try {
      this.give(today, treasury.ledger, result);
    } catch (err) {
      console.error("Townsfolk tips failed", err instanceof Error ? err.name : "");
      result.stopped = true;
    }
    this.sql.exec(
      "INSERT INTO townsfolk_tips_runs (at, day, mode, result) VALUES (?, ?, ?, ?)",
      this.now(),
      today,
      this.mode,
      JSON.stringify(result),
    );
    this.sql.exec(
      "DELETE FROM townsfolk_tips_runs WHERE n <= (SELECT MAX(n) FROM townsfolk_tips_runs) - 60",
    );
    console.info(
      `Townsfolk tips (${this.mode}): ${result.skipped ?? `welcomed ${result.welcomed}, refused ${result.refused}, skipped ${result.skippedNewcomers}, waiting ${result.waiting}, post ${result.post}${result.stopped ? ", stopped" : ""}${result.gap ? ", gap" : ""}${result.codes.length ? ` (${result.codes.join(" ")})` : ""}`}`,
    );
    return result;
  }

  private ranOn(day: number): boolean {
    const row = [
      ...this.sql.exec(
        "SELECT COUNT(*) AS c FROM townsfolk_tips_runs WHERE day = ? AND mode = ?",
        day,
        this.mode,
      ),
    ][0];
    return Number(row?.c ?? 0) > 0;
  }

  /**
   * Newcomers since the treasury began: its own history (the last 50 lines), and the welcome line in
   * each resident's purse, which a busy day of shop and market lines can't push out of the treasury's
   * view before the run.
   */
  private welcomes(treasuryLedger: readonly TreasuryLine[]): WelcomeLine[] {
    const world = this.world.state;
    const lines = new Map<number, WelcomeLine>();
    const add = (seq: number, day: number, residentId: string) => {
      if (lines.has(seq)) return;
      lines.set(seq, { seq, day, residentId, name: residentById(world, residentId)?.name ?? "" });
    };
    for (const l of treasuryLedger) {
      if (l.reason === "welcome" && l.with !== undefined) add(l.seq, l.day, l.with);
    }
    for (const [id, ledger] of Object.entries(world.economy?.ledgers ?? {})) {
      for (const l of ledger) if (l.reason === "welcome") add(l.seq, l.day, id);
    }
    return [...lines.values()];
  }

  private give(today: number, treasuryLedger: readonly TreasuryLine[], result: TipsResult) {
    const { givers, others } = this.purses();
    if (givers.length === 0) {
      result.skipped = "nobody";
      return;
    }
    const world = this.world.state;
    const now = this.now();
    const dry = this.mode === "dry";
    let state = this.state();
    const welcomes = this.welcomes(treasuryLedger);
    const plan = planTips({
      today,
      now,
      givers,
      otherLedgers: others,
      knownNotes: ALL_TIP_NOTES,
      townsfolk: [...(world.townsfolk ?? [])],
      // Newcomers come from the purses too, so there's no `oldestTreasurySeq` and no gap to flag.
      welcomes,
      alreadyWelcomed: this.welcomedNow(welcomes.map((l) => l.residentId)),
      posts: this.recentPosts(now),
      state,
    });
    result.waiting = plan.unfunded;
    result.gap = plan.gap === true;
    const keep = (next: TipState) => {
      state = next;
      if (!dry) this.save(state);
    };

    let welcomedThrough: number | undefined;
    for (const step of plan.welcomes) {
      if ("skip" in step) {
        result.skippedNewcomers++;
        welcomedThrough = step.seq;
        continue;
      }
      const outcome = this.send(step.gift, dry);
      if (outcome.kind === "stop") {
        result.stopped = true;
        break;
      }
      welcomedThrough = step.seq;
      if (outcome.kind === "sent") {
        result.welcomed++;
        result.welcomeCoins += step.gift.amount;
      } else {
        result.refused++;
        result.codes.push(outcome.code);
      }
      keep(nextState(state, plan, { welcomedThrough, postTried: false, today }));
    }
    keep(
      nextState(state, plan, {
        ...(welcomedThrough === undefined ? {} : { welcomedThrough }),
        postTried: false,
        today,
      }),
    );
    if (result.stopped) return;

    // The best posts in order, once each, until one is accepted.
    for (const gift of plan.posts) {
      const outcome = this.send(gift, dry);
      if (outcome.kind === "stop") {
        result.stopped = true;
        return;
      }
      keep(nextState(state, plan, { postTried: true, today }));
      if (outcome.kind === "sent") {
        result.post = "tipped";
        result.postCoins = gift.amount;
        if (gift.postId) {
          keep(nextState(state, plan, { postTried: true, postTipped: gift.postId, today }));
        }
        return;
      }
      result.post = "refused";
      result.codes.push(outcome.code);
    }
  }

  /**
   * One newcomer's welcome tip now, from one townsfolk resident, for a welcome visit
   * (`townsfolk-welcome.ts`). The same plan the daily run makes, with that giver alone and every
   * other townsfolk purse counted, so it's given only when the daily run would give it: their
   * treasury welcome is in a ledger, the daily run hasn't handled it, no townsfolk welcome went to
   * them before, and today's 25 and the giver's purse have room. A gift given is kept in
   * `townsfolk_tips_welcomed`, which the daily run and this read as well as the ledgers (a giver's
   * ledger keeps only its newest lines), so nobody is welcomed twice. Writes no run row and leaves
   * the daily state alone. A dry run checks the gift and gives nothing, and so does every call while
   * `TERRAKIN_TIPS` is `dry`; while it's `off`, nothing is planned.
   */
  welcomeNow(residentId: string, giverId: string, dry: boolean): WelcomeTip {
    if (this.mode === "off") return { kind: "none", why: "off" };
    const world = this.world.state;
    const today = world.day;
    const treasury = treasuryOf(world);
    if (today === undefined || !treasury) return { kind: "none", why: "closed" };
    const { givers, others } = this.purses();
    const giver = givers.find((g) => g.residentId === giverId);
    if (!giver) return { kind: "none", why: "giver" };
    const plan = planTips({
      today,
      now: this.now(),
      givers: [giver],
      otherLedgers: [...others, ...givers.filter((g) => g !== giver).map((g) => g.ledger)],
      knownNotes: ALL_TIP_NOTES,
      townsfolk: [...(world.townsfolk ?? [])],
      welcomes: this.welcomes(treasury.ledger).filter((l) => l.residentId === residentId),
      alreadyWelcomed: this.welcomedNow([residentId]),
      posts: [],
      state: this.state(),
    });
    const step = plan.welcomes[0];
    if (!step) return { kind: "none", why: plan.unfunded > 0 ? "no_budget" : "not_due" };
    if ("skip" in step) {
      // The planner's words for a newcomer who already had all their townsfolk coins today.
      const full = step.skip === "had their townsfolk coins for today";
      return { kind: "none", why: full ? "no_budget" : "not_due" };
    }
    const checkOnly = dry || this.mode === "dry";
    const outcome = this.send(step.gift, checkOnly);
    if (outcome.kind === "sent" && checkOnly) return { kind: "checked", amount: step.gift.amount };
    if (outcome.kind === "sent") {
      this.sql.exec(
        "INSERT OR IGNORE INTO townsfolk_tips_welcomed (resident_id, at) VALUES (?, ?)",
        residentId,
        this.now(),
      );
      return { kind: "sent", amount: step.gift.amount };
    }
    if (outcome.kind === "refused") return { kind: "refused", code: outcome.code };
    return { kind: "refused", code: "stopped" };
  }

  /**
   * Of these residents, the ones a welcome visit already gave a welcome tip. One lookup each: a
   * Durable Object binds at most 100 values to a statement.
   */
  private welcomedNow(ids: readonly string[]): string[] {
    return [...new Set(ids)].filter(
      (id) =>
        [...this.sql.exec("SELECT 1 FROM townsfolk_tips_welcomed WHERE resident_id = ?", id)]
          .length > 0,
    );
  }

  /**
   * One gift through the action path, as the townsfolk resident giving it: `arrive`, then `act`, as
   * `/v1/actions` does. A dry run checks an away giver as if they'd come back, and brings nobody in.
   * A refusal about the giver or the server (`STOP_CODES`) stops the run instead, so the newcomer
   * waits for the next one.
   */
  private send(gift: PlannedGift, dry: boolean): Outcome {
    const giver = gift.from.residentId;
    try {
      if (!dry && !this.world.arrive(giver, "give_coins").ok) return { kind: "stop" };
      const done = this.world.act(giver, {
        type: "give_coins",
        to: gift.to,
        amount: gift.amount,
        note: gift.note,
        ...(dry ? { dry: true } : {}),
      });
      if (done.ok) return { kind: "sent" };
      if (STOP_CODES.has(done.error.code)) return { kind: "stop" };
      return { kind: "refused", code: done.error.code };
    } catch (err) {
      console.error("Townsfolk tip failed", err instanceof Error ? err.name : "");
      return { kind: "stop" };
    }
  }

  /**
   * Every townsfolk resident with a purse, in the personas' order: those who give today, and the
   * ledgers of those who can't (suspended), whose gifts still count.
   */
  private purses(): { givers: Giver[]; others: LedgerEntry[][] } {
    const world = this.world.state;
    const ids = [...this.townsfolk];
    const handles = new Map(ids.map((id) => [id, this.social.authorView(id)?.handle]));
    const rank = (id: string) => {
      const at = PERSONA_ORDER.indexOf(handles.get(id) ?? "");
      return at < 0 ? PERSONA_ORDER.length + ids.indexOf(id) : at;
    };
    const givers: Giver[] = [];
    const others: LedgerEntry[][] = [];
    for (const id of [...ids].sort((a, b) => rank(a) - rank(b))) {
      const resident = residentById(world, id);
      const purse = purseOf(world, id);
      if (!resident || !purse) continue;
      const ledger = purse.ledger.map((l) => ({
        day: l.day,
        amount: l.amount,
        reason: l.reason,
        ...(l.with === undefined ? {} : { with: l.with }),
        ...(l.note === undefined ? {} : { note: l.note }),
      }));
      if (this.social.safety.suspendedUntil(id) !== undefined) {
        others.push(ledger);
        continue;
      }
      const handle = handles.get(id);
      givers.push({
        key: handle ?? `townsfolk_${ids.indexOf(id) + 1}`,
        name: resident.name,
        residentId: id,
        balance: purse.balance,
        ledger,
        notes: tipNotesFor(handle),
      });
    }
    return { givers, others };
  }

  /** Top-level posts from the last day, newest first, a few pages at most, as anyone sees them. */
  private recentPosts(now: number): FeedPost[] {
    const posts: FeedPost[] = [];
    let before: string | undefined;
    for (let page = 0; page < 6; page++) {
      const feed = this.social.feed({ limit: 50, before });
      for (const p of feed.posts) {
        if (p.repostedBy) continue;
        const reactions = Object.values(p.reactions).reduce<number>((sum, n) => sum + (n ?? 0), 0);
        posts.push({
          id: p.id,
          authorId: p.author.id,
          authorName: p.author.name,
          authorTownsfolk: p.author.townsfolk === true,
          createdAt: p.createdAt,
          reactions,
        });
      }
      const oldest = feed.posts.at(-1);
      before = feed.next ?? undefined;
      if (!before || !oldest || now - Date.parse(oldest.createdAt) > TIPS.postWindowMs) break;
    }
    return posts;
  }
}
