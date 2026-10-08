import {
  activeTables,
  asJoined,
  chebyshev,
  commonsPlot,
  type Input,
  plotHeart,
  plotOf,
  plotsOwnedBy,
  residentById,
  route,
  STEP,
  seatOf,
  spawnTile,
  type Tile,
  type WorldEvent,
  type WorldState,
  worldGround,
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
 * A greeting (decision 0237) answers the join itself: about a minute after a person first steps
 * into the world, the townsfolk resident whose home is nearest the Commons walks to them in the
 * town square and waves. `noteJoined` (wired to `WorldService.onNewResident`, which only a brand
 * new record reaches) queues it in `townsfolk_greetings`, and the same `run` carries it out. The
 * walk is `home` and then logged `move` steps, as anyone walks; no tip, no note.
 *
 * Guards, for both: one row per resident ever, marked done before anything is tried, so a crash
 * partway never brings a second one; a cap a run; nothing for a suspended newcomer; no townsfolk
 * who is suspended, seated at a game table, or blocked either way; a stale cutoff; and
 * `TERRAKIN_WELCOME_VISITS` (`off` by default) turns it all off. A greeting also skips a newcomer
 * who already left. The tip is given only when the daily run hasn't, which the daily run then
 * sees in the giver's ledger. Logs carry counts and codes only.
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

/** Greetings in the town square (decision 0237), on a person's first join. */
export const GREET = {
  /** How long after the join the greeter is due: the page has loaded and the square is in view. */
  afterMs: 20_000,
  /** A greeting this late is dropped: the moment it was for has passed. */
  staleMs: 5 * 60_000,
  /** Greetings a run. */
  perRun: 3,
  /** Townsfolk tried for one newcomer, nearest the Commons first, when one can't go. */
  tries: 3,
  /** How far the walk to the newcomer looks, in tiles, after the greeter has gone home. */
  radius: 24,
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
  /** Newcomers greeted in the town square (in a dry run, who would be). */
  greeted: number;
  /**
   * Greetings closed without a wave, and why: stale, gone, away, suspended, nobody, no_way, or a
   * refusal.
   */
  greetCodes: string[];
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
    // Greetings (decision 0237): one row per resident, ever, the same way.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS townsfolk_greetings (
      resident_id TEXT PRIMARY KEY, joined_at INTEGER NOT NULL, due_at INTEGER NOT NULL,
      done_at INTEGER, mode TEXT NOT NULL DEFAULT '', greeter TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT ''
    )`);
    this.sql.exec(
      "CREATE INDEX IF NOT EXISTS townsfolk_greetings_due ON townsfolk_greetings (done_at, due_at)",
    );
  }

  /**
   * Queue a greeting for a resident the world just made: their first join, never a return. Only
   * people; agents and townsfolk are never greeted. Never throws.
   */
  noteJoined(residentId: string): void {
    if (this.mode === "off") return;
    try {
      const r = residentById(this.world.state, residentId);
      if (r?.kind !== "human" || this.townsfolk.has(residentId)) return;
      const now = this.now();
      this.sql.exec(
        "INSERT OR IGNORE INTO townsfolk_greetings (resident_id, joined_at, due_at) VALUES (?, ?, ?)",
        residentId,
        now,
        now + GREET.afterMs,
      );
      this.onQueued?.();
    } catch (err) {
      report(err, "welcome.greet_queue");
    }
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
    const times = ["townsfolk_welcomes", "townsfolk_greetings"].flatMap((table) => {
      const row = [
        ...this.sql.exec(`SELECT MIN(due_at) AS at FROM ${table} WHERE done_at IS NULL`),
      ][0];
      return row?.at === null || row?.at === undefined ? [] : [Number(row.at)];
    });
    if (times.length === 0) return undefined;
    return Math.max(Math.min(...times), this.now() + WELCOME.wakeGapMs);
  }

  /**
   * Carry out the greetings that are due, at most `GREET.perRun`, then the visits, at most
   * `WELCOME.perRun`.
   */
  run(): WelcomeRun {
    const result: WelcomeRun = {
      welcomed: 0,
      tipped: 0,
      dropped: 0,
      codes: [],
      greeted: 0,
      greetCodes: [],
    };
    if (this.mode === "off") return { ...result, skipped: "off" };
    this.greetDue(result);
    this.visitDue(result);
    if (result.welcomed + result.dropped + result.greeted + result.greetCodes.length > 0) {
      console.info(
        `Townsfolk welcome (${this.mode}): greeted ${result.greeted}${result.greetCodes.length ? ` (${result.greetCodes.join(" ")})` : ""}, welcomed ${result.welcomed}, tipped ${result.tipped}, dropped ${result.dropped}${result.codes.length ? ` (${result.codes.join(" ")})` : ""}`,
      );
    }
    return result;
  }

  private greetDue(result: WelcomeRun) {
    const now = this.now();
    const due = [
      ...this.sql.exec(
        `SELECT resident_id, joined_at FROM townsfolk_greetings
          WHERE done_at IS NULL AND due_at <= ? ORDER BY due_at, resident_id LIMIT ?`,
        now,
        GREET.perRun,
      ),
    ];
    const dry = this.mode === "dry";
    for (const row of due) {
      const id = String(row.resident_id);
      // Marked done first: whatever happens next, this resident is never greeted twice.
      this.finishGreeting(id, { outcome: "started" });
      const drop = (code: string) => {
        result.greetCodes.push(code);
        this.finishGreeting(id, { outcome: code });
      };
      if (now - Number(row.joined_at) > GREET.staleMs) {
        drop("stale");
        continue;
      }
      if (!residentById(this.world.state, id)?.online) {
        drop("gone");
        continue;
      }
      if (this.social.safety.suspendedUntil(id) !== undefined) {
        drop("suspended");
        continue;
      }
      try {
        const walked = this.walkOver(id, dry);
        if (!walked.ok) {
          drop(walked.code);
          continue;
        }
        const waved = this.wave(walked.by, id, dry);
        if (waved === "waved") result.greeted++;
        else result.greetCodes.push(waved);
        this.finishGreeting(id, { by: walked.by, outcome: waved });
      } catch (err) {
        report(err, "welcome.greet");
        drop("error");
      }
    }
  }

  private visitDue(result: WelcomeRun) {
    const now = this.now();
    const due = [
      ...this.sql.exec(
        `SELECT resident_id, claimed_at FROM townsfolk_welcomes
          WHERE done_at IS NULL AND due_at <= ? ORDER BY due_at, resident_id LIMIT ?`,
        now,
        WELCOME.perRun,
      ),
    ];
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
  }

  /** Townsfolk who could go to this newcomer, nearest home to `heart` first. */
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
   * Whoever greeted them in the square goes last, so the door brings a second face and a wave the
   * gesture cooldown doesn't refuse.
   */
  private visit(newcomer: string, dry: boolean): Visited {
    const state = this.world.state;
    const plot = plotsOwnedBy(state, newcomer)[0];
    if (!plot) return { ok: false, code: "no_plot" };
    const greeter = this.greetingFor(newcomer)?.by;
    const near = this.visitors(newcomer, plotHeart(state, plot));
    const candidates = [
      ...near.filter((id) => id !== greeter),
      ...near.filter((id) => id === greeter),
    ].slice(0, WELCOME.tries);
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

  /**
   * The townsfolk resident whose home is nearest the Commons, of those who can, walks to stand next
   * to the newcomer in the square: `home` first when their hearth is nearer the newcomer than where
   * they stand, then `move` steps from `route`, each through `arrive` and `act` like any
   * resident's, so every step is a logged input and replay needs nothing new. The walk is planned
   * before anything is sent, so a townsfolk who can't get there isn't moved and the next is tried.
   * A newcomer who already left the Commons (an invite settles them at once) gets no walk. Dry, the
   * walk is only planned.
   */
  private walkOver(newcomer: string, dry: boolean): Visited {
    const state = this.world.state;
    const r = residentById(state, newcomer);
    if (!r) return { ok: false, code: "gone" };
    const here = plotOf(state.config, r.x, r.y);
    const c = commonsPlot(state.config);
    if (here.px !== c.px || here.py !== c.py) return { ok: false, code: "away" };
    const target = { x: r.x, y: r.y };
    const candidates = this.visitors(newcomer, spawnTile(state.config)).slice(0, GREET.tries);
    if (candidates.length === 0) return { ok: false, code: "nobody" };
    let code = "nobody";
    for (const by of candidates) {
      const view = asJoined(this.world.state, by);
      const me = residentById(view, by);
      if (!me) continue;
      const hearth = me.hearth;
      const goHome = hearth !== null && chebyshev(hearth, target) < chebyshev(me, target);
      const from = goHome ? hearth : { x: me.x, y: me.y };
      const steps = route(worldGround(view), from, target, 1, GREET.radius);
      const end = steps.reduce(
        (t, dir) => ({ x: t.x + STEP[dir][0], y: t.y + STEP[dir][1] }),
        from,
      );
      if (chebyshev(end, target) > 1) {
        code = "no_way";
        continue;
      }
      if (dry) return { ok: true, by };
      if (!this.world.arrive(by, "move").ok) continue;
      if (goHome) {
        const home = this.world.act(by, { type: "home" });
        if (!home.ok) return { ok: false, code: home.error.code };
      }
      for (const dir of steps) {
        const moved = this.world.act(by, { type: "move", dir });
        if (!moved.ok) return { ok: false, code: moved.error.code };
      }
      return { ok: true, by };
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

  private finishGreeting(id: string, row: { by?: string; outcome: string }) {
    this.sql.exec(
      `UPDATE townsfolk_greetings SET done_at = ?, mode = ?, greeter = ?, outcome = ?
        WHERE resident_id = ?`,
      this.now(),
      this.mode,
      row.by ?? "",
      row.outcome,
      id,
    );
  }

  /** One resident's greeting, for tests and staff: when it came due, who went, and what happened. */
  greetingFor(
    residentId: string,
  ): { dueAt: number; done: boolean; by: string; outcome: string } | undefined {
    const row = [
      ...this.sql.exec(
        "SELECT due_at, done_at, greeter, outcome FROM townsfolk_greetings WHERE resident_id = ?",
        residentId,
      ),
    ][0];
    if (!row) return undefined;
    return {
      dueAt: Number(row.due_at),
      done: row.done_at !== null,
      by: String(row.greeter),
      outcome: String(row.outcome),
    };
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
