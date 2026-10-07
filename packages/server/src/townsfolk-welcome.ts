import {
  activeTables,
  type Input,
  plotHeart,
  plotsOwnedBy,
  residentById,
  seatOf,
  type WorldEvent,
  type WorldState,
} from "@terrakin/sim";
import type { SocialService } from "./social-service";
import type { SqlExec } from "./sql-store";
import { report } from "./telemetry";
import type { TownsfolkTips } from "./townsfolk-tips";
import type { WorldService } from "./world-service";

/**
 * A welcome visit (decision 0142): a few minutes after a person claims their first plot, the townsfolk resident whose home is
 * nearest visits their door, waves, and gives the welcome tip when the daily run would.
 *
 * `noteCommitted` (wired to `WorldService.onCommitted`) queues a row when a `settle` or `claim`
 * leaves a person owning one plot, and `run` (from the minute sweep, and the World object's alarm,
 * set for `nextAt`) carries out the ones that are due. Everything goes through the paths townsfolk
 * already use: `visit` through `arrive` and `act`, so the server picks the tile and the log keeps
 * it (decision 0091); the wave through `TogetherService.sendGesture`, so blocks and the gesture
 * cooldown apply and the newcomer gets a notice; and the tip through `TownsfolkTips.welcomeNow`,
 * the daily run's own plan and action path. No model, no text from anyone: a wave carries no note,
 * and the tip's note is the giver's fixed welcome line.
 *
 * Guards: one row per resident ever, marked done before anything is tried, so a crash partway
 * never brings a second visit; `WELCOME.perRun` a run; nothing for a suspended newcomer;
 * `TERRAKIN_WELCOME_VISITS` (`off` by default) turns it all off; and the tip is given only when
 * the daily run hasn't, which the daily run then sees in the giver's ledger. Logs carry counts and
 * codes only.
 */

export type WelcomeMode = "off" | "dry" | "on";
const WELCOME_MODES: readonly WelcomeMode[] = ["off", "dry", "on"];

/** `TERRAKIN_WELCOME_VISITS`: `off` (the default), `dry`, or `on`. */
export function welcomeMode(env: { TERRAKIN_WELCOME_VISITS?: string | undefined }): WelcomeMode {
  const mode = env.TERRAKIN_WELCOME_VISITS?.trim();
  return WELCOME_MODES.includes(mode as WelcomeMode) ? (mode as WelcomeMode) : "off";
}

export const WELCOME = {
  /** How long after the claim the visit comes: time to look around, still the same sitting. */
  afterMs: 2 * 60_000,
  /** A visit this long overdue (the server was down) is dropped; the daily run still tips. */
  staleMs: 6 * 3_600_000,
  /** Visits a run, so a burst of claims spreads over a few minutes. */
  perRun: 3,
  /** Townsfolk tried for one newcomer, nearest first, when a visit is refused. */
  tries: 3,
  /** The least time before the World object's alarm, so a waiting row never spins it. */
  wakeGapMs: 60_000,
} as const;

/** What a run came to. Counts and codes only. */
export interface WelcomeRun {
  skipped?: "off";
  /** Newcomers visited and waved to (in a dry run, who would be). */
  welcomed: number;
  /** Welcome tips given with a visit (coins moved; a dry run's checked tips aren't counted). */
  tipped: number;
  /** Rows closed without a visit: stale, suspended, no plot, nobody to send, or refused. */
  dropped: number;
  /** Refusal and drop codes, in order. */
  codes: string[];
}

export interface TownsfolkWelcomeOptions {
  mode: WelcomeMode;
  world: WorldService;
  social: SocialService;
  /** The founding townsfolk, from `TERRAKIN_TOWNSFOLK`. */
  townsfolk: ReadonlySet<string>;
  /** The daily tips, for a welcome tip in the same pass. Without it, the visit never tips. */
  tips?: TownsfolkTips;
  now?: () => number;
  /** Hears each newly queued visit, so the Worker can set its alarm for it. */
  onQueued?: () => void;
}

type Visited = { ok: true; by: string } | { ok: false; code: string };

/**
 * Whether this committed input was the resident's first claim ever. The sim keeps who had the
 * treasury's welcome gift, paid on the first `settle` or `claim` (a `coins` event with reason
 * `welcome`) or owed from then (the end of the `owed` line); a world without coins keeps no record,
 * so nobody is queued there.
 */
function firstClaim(state: WorldState, actor: string, events: readonly WorldEvent[]): boolean {
  const econ = state.economy;
  if (!econ) return false;
  const paid = events.some(
    (e) => e.type === "coins" && e.residentId === actor && e.reason === "welcome",
  );
  return paid || econ.owed.at(-1) === actor;
}

export class TownsfolkWelcome {
  readonly mode: WelcomeMode;
  private readonly world: WorldService;
  private readonly social: SocialService;
  private readonly townsfolk: ReadonlySet<string>;
  private readonly tips: TownsfolkTips | undefined;
  private readonly sql: SqlExec;
  private readonly now: () => number;
  private readonly onQueued: (() => void) | undefined;

  constructor(options: TownsfolkWelcomeOptions) {
    this.mode = options.mode;
    this.world = options.world;
    this.social = options.social;
    this.townsfolk = options.townsfolk;
    this.tips = options.tips;
    this.sql = options.social.sql;
    this.now = options.now ?? Date.now;
    this.onQueued = options.onQueued;
    // One row per resident, ever. `done_at` is set before the visit is tried.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS townsfolk_welcomes (
      resident_id TEXT PRIMARY KEY, claimed_at INTEGER NOT NULL, due_at INTEGER NOT NULL,
      done_at INTEGER, mode TEXT NOT NULL DEFAULT '', visitor TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT '', tip TEXT NOT NULL DEFAULT ''
    )`);
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS townsfolk_welcomes_due ON townsfolk_welcomes (done_at, due_at)",
    );
  }

  /**
   * Queue a visit when this input was a person's first claim ever: the one the sim pays the
   * treasury's welcome gift for, or puts them in line for (`welcomeDue`). A resident who had a plot
   * before and settles again gets none. Never throws: a failure is reported and the claim stands.
   */
  noteCommitted(input: Input, events: readonly WorldEvent[]): void {
    if (this.mode === "off") return;
    const { command, actor } = input;
    if (command.type !== "settle" && command.type !== "claim") return;
    try {
      if (!events.some((e) => e.type === "plot_claimed" && e.ownerId === actor)) return;
      const state = this.world.state;
      if (residentById(state, actor)?.kind !== "human" || this.townsfolk.has(actor)) return;
      if (!firstClaim(state, actor, events)) return;
      const now = this.now();
      this.sql.exec(
        "INSERT OR IGNORE INTO townsfolk_welcomes (resident_id, claimed_at, due_at) VALUES (?, ?, ?)",
        actor,
        now,
        now + WELCOME.afterMs,
      );
      this.onQueued?.();
    } catch (err) {
      report(err, "welcome.queue", { command: command.type });
    }
  }

  /**
   * When the World object should next wake for a visit, or undefined with none waiting. Never
   * sooner than `WELCOME.wakeGapMs` from now, so a row a run leaves for later can't spin the alarm.
   */
  nextAt(): number | undefined {
    if (this.mode === "off") return undefined;
    const row = [
      ...this.sql.exec("SELECT MIN(due_at) AS at FROM townsfolk_welcomes WHERE done_at IS NULL"),
    ][0];
    if (row?.at === null || row?.at === undefined) return undefined;
    return Math.max(Number(row.at), this.now() + WELCOME.wakeGapMs);
  }

  /** Carry out the visits that are due, at most `WELCOME.perRun`. */
  run(): WelcomeRun {
    const result: WelcomeRun = { welcomed: 0, tipped: 0, dropped: 0, codes: [] };
    if (this.mode === "off") return { ...result, skipped: "off" };
    const now = this.now();
    const due = [
      ...this.sql.exec(
        `SELECT resident_id, claimed_at FROM townsfolk_welcomes
          WHERE done_at IS NULL AND due_at <= ? ORDER BY due_at, resident_id LIMIT ?`,
        now,
        WELCOME.perRun,
      ),
    ];
    if (due.length === 0) return result;
    const dry = this.mode === "dry";
    for (const row of due) {
      const id = String(row.resident_id);
      // Marked done first: whatever happens next, this resident never gets a second visit.
      this.finish(id, { outcome: "started" });
      const drop = (code: string) => {
        result.dropped++;
        result.codes.push(code);
        this.finish(id, { outcome: code });
      };
      if (now - Number(row.claimed_at) > WELCOME.staleMs) {
        drop("stale");
        continue;
      }
      if (this.social.safety.suspendedUntil(id) !== undefined) {
        drop("suspended");
        continue;
      }
      try {
        const visited = this.visit(id, dry);
        if (!visited.ok) {
          drop(visited.code);
          continue;
        }
        const waved = this.wave(visited.by, id, dry);
        const tip = this.tip(id, visited.by, dry);
        result.welcomed++;
        if (tip === "sent") result.tipped++;
        if (waved !== "waved") result.codes.push(waved);
        this.finish(id, { by: visited.by, outcome: waved, tip });
      } catch (err) {
        report(err, "welcome.visit");
        drop("error");
      }
    }
    console.info(
      `Townsfolk welcome (${this.mode}): welcomed ${result.welcomed}, tipped ${result.tipped}, dropped ${result.dropped}${result.codes.length ? ` (${result.codes.join(" ")})` : ""}`,
    );
    return result;
  }

  /** Townsfolk who could visit this newcomer, nearest home to their plot first. */
  private visitors(newcomer: string, heart: { x: number; y: number }): string[] {
    const state = this.world.state;
    const seated = new Set(
      activeTables(state).flatMap((t) => [...this.townsfolk].filter((id) => seatOf(t, id))),
    );
    return [...this.townsfolk]
      .flatMap((id) => {
        const r = residentById(state, id);
        if (!r || seated.has(id)) return [];
        if (this.social.safety.suspendedUntil(id) !== undefined) return [];
        if (this.social.blockedEither(id, newcomer)) return [];
        const from = r.hearth ?? r;
        return [{ id, far: Math.max(Math.abs(from.x - heart.x), Math.abs(from.y - heart.y)) }];
      })
      .sort((a, b) => a.far - b.far || (a.id < b.id ? -1 : 1))
      .map((c) => c.id);
  }

  /**
   * The nearest townsfolk resident who can visits the newcomer's plot, through `arrive` and `act`
   * as `/v1/actions` does; the world picks the tile and logs it. One already standing there counts.
   */
  private visit(newcomer: string, dry: boolean): Visited {
    const state = this.world.state;
    const plot = plotsOwnedBy(state, newcomer)[0];
    if (!plot) return { ok: false, code: "no_plot" };
    const candidates = this.visitors(newcomer, plotHeart(state, plot)).slice(0, WELCOME.tries);
    if (candidates.length === 0) return { ok: false, code: "nobody" };
    let code = "nobody";
    for (const by of candidates) {
      if (!dry && !this.world.arrive(by, "visit").ok) continue;
      const done = this.world.act(by, {
        type: "visit",
        px: plot.px,
        py: plot.py,
        ...(dry ? { dry: true } : {}),
      });
      if (done.ok || done.error.code === "already_there") return { ok: true, by };
      code = done.error.code;
    }
    return { ok: false, code };
  }

  /** A wave with no note, as chatter's: a notice and the live socket. Dry, only checked. */
  private wave(from: string, to: string, dry: boolean): string {
    const together = this.social.together;
    if (dry) {
      const checked = together.checkGesture(from, to, { kind: "wave" });
      return checked.ok ? "waved" : checked.code;
    }
    const sent = together.sendGesture(from, to, { kind: "wave" });
    if (!sent.ok) return sent.code;
    this.world.notify(to, together.liveGesture(sent.value.gesture, sent.value.streak));
    return "waved";
  }

  /**
   * The welcome tip, when the daily run would give it. A code for the row: `sent` only when coins
   * moved, `checked` when a dry run (this one's or `TERRAKIN_TIPS`) found it would.
   */
  private tip(newcomer: string, giver: string, dry: boolean): string {
    if (!this.tips) return "off";
    const tip = this.tips.welcomeNow(newcomer, giver, dry);
    if (tip.kind === "sent" || tip.kind === "checked") return tip.kind;
    return tip.kind === "refused" ? tip.code : tip.why;
  }

  private finish(id: string, row: { by?: string; outcome: string; tip?: string }) {
    this.sql.exec(
      `UPDATE townsfolk_welcomes SET done_at = ?, mode = ?, visitor = ?, outcome = ?, tip = ?
        WHERE resident_id = ?`,
      this.now(),
      this.mode,
      row.by ?? "",
      row.outcome,
      row.tip ?? "",
      id,
    );
  }

  /** One resident's row, for tests and staff: when it came due, who went, and what happened. */
  rowFor(
    residentId: string,
  ): { dueAt: number; done: boolean; by: string; outcome: string; tip: string } | undefined {
    const row = [
      ...this.sql.exec(
        "SELECT due_at, done_at, visitor, outcome, tip FROM townsfolk_welcomes WHERE resident_id = ?",
        residentId,
      ),
    ][0];
    if (!row) return undefined;
    return {
      dueAt: Number(row.due_at),
      done: row.done_at !== null,
      by: String(row.visitor),
      outcome: String(row.outcome),
      tip: String(row.tip),
    };
  }
}
