import {
  type AwayLine,
  ERROR_CODES,
  type ErrorCode,
  ROUTINE_LIMITS,
  ROUTINE_RULES,
  type RoutinesResponse,
} from "@terrakin/protocol";
import {
  chebyshev,
  clockHour,
  isRoutineKind,
  planStroll,
  residentById,
  routineOf,
  routineRanToday,
  routinesOf,
  type StepRoutine,
  strollBack,
  type Tile,
  withinEarshot,
} from "@terrakin/sim";
import type { AwayLog, AwayRow } from "./away-log";
import type { SocialService } from "./social-service";
import { report } from "./telemetry";
import type { WorldService } from "./world-service";

const MINUTE_MS = 60_000;

/** What one run of the runner did. Counts only. */
export interface RoutinesRun {
  /** Steps the world took. */
  steps: number;
  /** Steps the world refused (each written to the away log, `already_home` aside). */
  refused: number;
  /** Residents whose routines are paused for want of a call. */
  paused: number;
}

/**
 * The fixed sentence a resident reads for each refusal (RFC 0009): from the routine and the code,
 * never from anyone's words, so nothing a resident writes reaches the away log or a check-in's
 * `todo`. A code with no sentence of its own gets `FALLBACK`.
 */
const REASONS: Record<string, string> = {
  "walk_home no_hearth":
    "You have no hearth to walk home to. Build a home with build_starter_home, or set one with set_hearth.",
  "stroll not_your_plot":
    "You weren't on your own plot when your stroll was due. Turn on walk_home for an earlier hour, so you're home by then.",
  "stroll nowhere_to_go":
    "There was nowhere open to stroll from where you stood. Leave a path clear on your plot.",
  "stroll blocked":
    "Your stroll path is built over. Leave a path on your plot, or change the stroll.",
};
const FALLBACK = "It couldn't run this time. It will try again tomorrow.";
const PAUSED = `Your routines paused: this resident made no call for ${ROUTINE_LIMITS.pauseAfterDays} days. Your next call starts them again.`;

/** The words for a refused or paused line, written from its routine and code alone. */
export function awayReason(row: Pick<AwayRow, "routine" | "result" | "code">): string | undefined {
  if (row.result === "paused") return PAUSED;
  if (row.result !== "refused") return undefined;
  return REASONS[`${row.routine} ${row.code}`] ?? FALLBACK;
}

/**
 * One away log line as the API shows it, or undefined when the resident it names is hidden from
 * `viewer`: like gestures in a check-in, nobody blocked either way and nobody suspended now. The
 * words come from `awayReason`; a name appears only as `to`, a resident's own name, like any.
 */
export function awayLine(
  social: SocialService,
  viewer: string,
  row: AwayRow,
): AwayLine | undefined {
  let to: AwayLine["to"];
  if (row.recipient) {
    if (social.blockedEither(viewer, row.recipient)) return undefined;
    if (social.safety.suspendedUntil(row.recipient) !== undefined) return undefined;
    to = social.authorView(row.recipient);
    if (!to) return undefined;
  }
  const reason = awayReason(row);
  return {
    id: `a_${row.n}`,
    at: new Date(row.at).toISOString(),
    ...(isRoutineKind(row.routine) ? { routine: row.routine } : {}),
    result: row.result,
    ...(row.result === "refused" && isErrorCode(row.code) ? { code: row.code } : {}),
    ...(reason ? { reason } : {}),
    ...(row.seq > 0 ? { seq: row.seq } : {}),
    ...(to ? { to } : {}),
    ...(row.days > 1 ? { days: row.days } : {}),
  };
}

const isErrorCode = (code: string): code is ErrorCode =>
  (ERROR_CODES as readonly string[]).includes(code);

/** How a routine reads in a sentence. */
export const ROUTINE_WORDS: Record<string, string> = {
  walk_home: "walk home",
  stroll: "stroll",
  greet: "wave",
};

/**
 * Offline routines' runner (RFC 0009). The minute sweep calls `run`: for each away resident with a
 * routine due (its UTC hour has come and it hasn't run today), it plans the step and logs it
 * through `WorldService.routineStep`, which the sim checks like any input. A stroll walks out at
 * once and back `ROUTINE_LIMITS.strollPauseMinutes` later. Every try writes one away log line,
 * done or refused, except a walk home for someone already home. `greetFor` runs when a resident
 * here walks: away neighbors with `greet` on whose hearth is within earshot wave at them.
 *
 * Routines skip residents who are suspended, and pause after `ROUTINE_LIMITS.pauseAfterDays` days
 * with no call from their resident, which the away log says once. A routine that was refused
 * isn't tried again that day.
 */
export class Routines {
  private readonly world: WorldService;
  private readonly social: SocialService;
  private readonly now: () => number;
  /** Routines tried today, as `resident routine`, so a refusal isn't tried again every minute. */
  private tried = { day: Number.NaN, keys: new Set<string>() };
  /**
   * Strolls out on their walk, waiting to walk back: where each started, where the walk out ended,
   * and when it set out.
   */
  private readonly strolls = new Map<string, { from: Tile; to: Tile; at: number; day: number }>();
  /**
   * Today's wave pairs tried (`greeter recipient`), so each walker's steps ask about a neighbor
   * once. The caps themselves are the gesture table's (`TogetherService.checkGesture`).
   */
  private waves = { day: Number.NaN, tried: new Set<string>() };
  /** Pauses already in the away log, as `resident lastCallDay`, so it's asked once per pause. */
  private readonly saidPaused = new Set<string>();

  constructor(options: { world: WorldService; social: SocialService; now?: () => number }) {
    this.world = options.world;
    this.social = options.social;
    this.now = options.now ?? options.world.now;
  }

  private get away(): AwayLog {
    return this.social.away;
  }

  private suspended(id: string): boolean {
    return this.social.safety.suspendedUntil(id) !== undefined;
  }

  /**
   * Whether a resident's routines are paused for want of a call, and if so, the away log says so
   * once since their last call. Their last call is the later of the away log's and their last
   * action in the world, since acting over a socket opened days ago makes no new call.
   */
  private paused(id: string, day: number): boolean {
    const call = this.away.lastCall(id);
    const acted = this.world.state.lastActiveDay?.[id];
    const last = call === undefined ? acted : acted === undefined ? call : Math.max(call, acted);
    if (last === undefined || day - last < ROUTINE_LIMITS.pauseAfterDays) return false;
    const said = `${id} ${last}`;
    if (!this.saidPaused.has(said)) {
      if (!this.away.pausedSince(id, last)) this.away.paused(id);
      this.saidPaused.add(said);
    }
    return true;
  }

  /** Take every routine step that's due. Call it about once a minute. */
  run(): RoutinesRun {
    const out: RoutinesRun = { steps: 0, refused: 0, paused: 0 };
    const now = this.now();
    const { day, hour } = clockHour(now);
    const state = this.world.state;
    // The world's day has to be today's first: `tick` logs it.
    if (state.day !== day) return out;
    if (this.tried.day !== day) {
      this.tried = { day, keys: this.away.triedOn(day) };
      this.away.prune();
    }
    this.walkBack(now, day, out);
    for (const id of Object.keys(state.routines ?? {}).sort()) {
      const r = residentById(state, id);
      if (!r || r.online) continue;
      // What's due first, from memory; the pause and suspension only for someone with something due.
      const due = routinesOf(state, id).flatMap((routine) =>
        routine.kind === "greet" ||
        hour < routine.hour ||
        this.tried.keys.has(`${id} ${routine.kind}`) ||
        routineRanToday(state, id, routine.kind)
          ? []
          : [routine.kind],
      );
      if (due.length === 0) continue;
      if (this.paused(id, day)) {
        out.paused++;
        continue;
      }
      if (this.suspended(id)) continue;
      for (const kind of due) {
        this.tried.keys.add(`${id} ${kind}`);
        this.take(id, kind, now, day, out);
      }
    }
    return out;
  }

  private take(id: string, routine: StepRoutine, now: number, day: number, out: RoutinesRun) {
    const me = residentById(this.world.state, id);
    if (!me) return;
    const from = { x: me.x, y: me.y };
    const result =
      routine === "walk_home"
        ? this.world.routineStep(id, routine, { type: "home" })
        : this.world.routineStep(id, routine, {
            type: "putter",
            steps: planStroll(this.world.state, id),
          });
    if (result.ok) {
      out.steps++;
      this.away.done(id, routine, { seq: result.seq });
      const to = residentById(this.world.state, id);
      if (routine === "stroll" && to) {
        this.strolls.set(id, { from, to: { x: to.x, y: to.y }, at: now, day });
      }
      return;
    }
    // Already home needed no walk: nothing to tell.
    if (result.error.code === "already_home") return;
    out.refused++;
    this.away.refused(id, routine, result.error.code);
  }

  /**
   * Strolls that set out `strollPauseMinutes` ago walk back to where they started, if the way is
   * open and their resident is still away where the walk out left them. The walk back writes no
   * line of its own: the stroll's line said it went. A day's end, or the resident coming back and
   * walking somewhere, forgets it.
   */
  private walkBack(now: number, day: number, out: RoutinesRun) {
    for (const [id, stroll] of [...this.strolls]) {
      if (stroll.day === day && now - stroll.at < ROUTINE_LIMITS.strollPauseMinutes * MINUTE_MS) {
        continue;
      }
      this.strolls.delete(id);
      const me = residentById(this.world.state, id);
      if (stroll.day !== day || !me || me.online) continue;
      if (me.x !== stroll.to.x || me.y !== stroll.to.y) continue;
      const steps = strollBack(this.world.state, id, stroll.from);
      if (steps.length === 0) continue;
      const result = this.world.routineStep(id, "stroll", { type: "putter", steps });
      if (result.ok) out.steps++;
    }
  }

  /**
   * A resident here walked: away neighbors with `greet` on, whose hearth is within earshot of
   * where they stand, wave at them, nearest first. Each greeter waves at most `max` residents a
   * UTC day and each one once; blocks either way stop it, and so does the recipient's daily limit
   * (`TogetherService.checkGesture`). Returns who waved.
   */
  greetFor(walker: string): string[] {
    const state = this.world.state;
    const me = residentById(state, walker);
    if (!me?.online || !state.routines) return [];
    const now = this.now();
    const { day } = clockHour(now);
    if (this.waves.day !== day) this.waves = { day, tried: new Set() };
    const greeters = Object.keys(state.routines)
      .flatMap((id) => {
        const g = residentById(state, id);
        const greet = routineOf(state, id, "greet");
        if (!g?.hearth || g.online || id === walker || !greet) return [];
        if (!withinEarshot(g.hearth, me)) return [];
        return [{ id, hearth: g.hearth, max: greet.max }];
      })
      .sort((a, b) => chebyshev(a.hearth, me) - chebyshev(b.hearth, me) || (a.id < b.id ? -1 : 1));
    const waved: string[] = [];
    for (const g of greeters) {
      const pair = `${g.id} ${walker}`;
      if (this.waves.tried.has(pair)) continue;
      if (this.suspended(g.id) || this.paused(g.id, day)) continue;
      this.waves.tried.add(pair);
      const together = this.social.together;
      const sent = together.sendGesture(
        g.id,
        walker,
        { kind: "wave" },
        { routine: { max: g.max } },
      );
      if (!sent.ok) continue;
      this.away.done(g.id, "greet", { recipient: walker });
      this.world.notify(walker, together.liveGesture(sent.value.gesture, sent.value.streak));
      waved.push(g.id);
    }
    return waved;
  }

  /** `GET /v1/routines`: what's on, whether it's held, and a page of the away log. */
  view(viewer: string, before: number | undefined): RoutinesResponse {
    const rows = this.away.page(viewer, before, ROUTINE_LIMITS.pageLines);
    const items = rows.flatMap((row) => awayLine(this.social, viewer, row) ?? []);
    const last = rows.at(-1);
    const more = last !== undefined && this.away.page(viewer, last.n, 1).length > 0;
    return {
      routines: routinesOf(this.world.state, viewer).map((r) => ({ ...r })),
      paused: this.suspended(viewer),
      rules: { ...ROUTINE_RULES },
      away: { items, next: more && last ? `a_${last.n}` : null },
    };
  }
}

/** Report a runner failure and carry on: routines are never worth taking the sweep down. */
export function runRoutines(routines: Routines | undefined): RoutinesRun | undefined {
  if (!routines) return undefined;
  try {
    return routines.run();
  } catch (err) {
    report(err, "routines.run");
    return undefined;
  }
}
