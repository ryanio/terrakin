import { isWhole, refuse } from "./check";
import { floorField, floorGround, setFloor, standingFloor } from "./floors";
import { canonicalJson, fnv1a } from "./hash";
import { tileKey } from "./keys";
import { own, residentById } from "./own";
import { PUTTER_MAX_STEPS } from "./putter";
import type {
  Command,
  Direction,
  Plot,
  Rejection,
  ResidentId,
  Routine,
  RoutineKind,
  RoutineRuns,
  StepRoutine,
  Tile,
  WorldEvent,
  WorldState,
} from "./types";
import { ROUTINE_KINDS, STEP_ROUTINES } from "./types";
import { type Ground, walkPath, walkSteps, walkTree } from "./walk";
import { canBuildOn, plotAtTile, plotOf } from "./world";

/**
 * Offline routines (RFC 0009). A resident turns a few on from a fixed menu with `set_routines`,
 * and the server's runner takes their steps while they're away: it decides when (an hour on the
 * UTC clock) and where (a stroll's path), and logs each step as `routine_step` from `TOWN_ACTOR`.
 * Replay applies those steps and never runs the runner.
 *
 * The sim still checks everything it can from its own state, so a runner bug can't put a step in
 * the log the resident didn't choose: they turned that routine on, they're offline, it hasn't used
 * up today, and the step passes the checks their own command would. A step runs as them with three
 * differences: it works while they're offline, it never pays the allowance or the pantry, and it
 * doesn't count as their activity (`lastActiveDay`), since it comes from the town, not them.
 */

export const ROUTINES = {
  /** `walk_home`'s hour when none is given, UTC. */
  walkHomeHour: 18,
  /** `stroll`'s hour when none is given, UTC: an hour after walking home. */
  strollHour: 19,
  /** How many residents `greet` waves at a day when no `max` is given. */
  greetMax: 3,
  /** The most `greet`'s `max` can be. */
  greetMostMax: 5,
  /** The most tiles a stroll walks in a day, out and back together. Replay checks logged steps against it. */
  strollTiles: 8,
  /** How far the stroll planner walks out before it turns back. */
  strollOut: 4,
} as const;

type Mutation = () => WorldEvent[];
export type RoutinesChecked = Mutation | Rejection;

export const isRoutineKind = (k: unknown): k is RoutineKind =>
  typeof k === "string" && (ROUTINE_KINDS as readonly string[]).includes(k);
const isStepRoutine = (k: unknown): k is StepRoutine =>
  typeof k === "string" && (STEP_ROUTINES as readonly string[]).includes(k);

/** The routines a resident has turned on, in `ROUTINE_KINDS` order. */
export const routinesOf = (state: WorldState, residentId: ResidentId): readonly Routine[] =>
  own(state.routines, residentId) ?? [];

/** One of a resident's routines, if they turned it on. */
export function routineOf<K extends RoutineKind>(
  state: WorldState,
  residentId: ResidentId,
  kind: K,
): Extract<Routine, { kind: K }> | undefined {
  return routinesOf(state, residentId).find(
    (r): r is Extract<Routine, { kind: K }> => r.kind === kind,
  );
}

/** What a resident's routines did today, as far as the world has counted. */
function runsToday(state: WorldState, residentId: ResidentId): RoutineRuns | undefined {
  const runs = own(state.routineRuns, residentId);
  return runs && runs.day === state.day ? runs : undefined;
}

/** Whether a routine took a step today: `walk_home` went home, or the stroll walked a tile. */
export function routineRanToday(
  state: WorldState,
  residentId: ResidentId,
  kind: StepRoutine,
): boolean {
  const runs = runsToday(state, residentId);
  return kind === "walk_home" ? runs?.walk_home === true : (runs?.stroll ?? 0) > 0;
}

// ---------- set_routines ----------

const MENU = "Routines are walk_home, stroll, and greet, each at most once.";

/** One routine from a logged list, kept to its own fields, or why it doesn't fit the menu. */
function readRoutine(value: unknown): Routine | Rejection {
  const r = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const { kind } = r;
  if (!isRoutineKind(kind)) return refuse("invalid_routine", MENU);
  if (kind === "greet") {
    const { max } = r;
    if (!isWhole(max) || max < 1 || max > ROUTINES.greetMostMax) {
      return refuse(
        "invalid_routine",
        `greet waves at 1 to ${ROUTINES.greetMostMax} residents a day: set max to one of those.`,
      );
    }
    return { kind, max };
  }
  const { hour } = r;
  if (!isWhole(hour) || hour < 0 || hour > 23) {
    return refuse("invalid_routine", "An hour is a whole number from 0 to 23, on the UTC clock.");
  }
  return { kind, hour };
}

/**
 * `set_routines {routines}`: the whole list a resident wants on, `[]` for none. Stored one of each
 * kind at most, in `ROUTINE_KINDS` order, so the same choice always looks the same. Sending the
 * list they already have is refused, since it would cost a log line and change nothing.
 */
export function checkSetRoutines(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "set_routines" }>,
): RoutinesChecked {
  const list: unknown = command.routines;
  if (!Array.isArray(list) || list.length > ROUTINE_KINDS.length) {
    return refuse("invalid_routine", MENU);
  }
  const chosen = new Map<RoutineKind, Routine>();
  for (const value of list) {
    const routine = readRoutine(value);
    if ("code" in routine) return routine;
    if (chosen.has(routine.kind)) return refuse("invalid_routine", MENU);
    chosen.set(routine.kind, routine);
  }
  const next = ROUTINE_KINDS.flatMap((kind) => chosen.get(kind) ?? []);
  if (canonicalJson(next) === canonicalJson(routinesOf(state, actor))) {
    return refuse(
      "already_set",
      next.length > 0
        ? "Your routines are already set that way."
        : "Your routines are already off.",
    );
  }
  return () => {
    const all = { ...(state.routines ?? {}) };
    if (next.length > 0) all[actor] = next;
    else delete all[actor];
    if (Object.keys(all).length > 0) state.routines = all;
    else delete state.routines;
    return [{ type: "routines_set", residentId: actor, routines: next.map((r) => ({ ...r })) }];
  };
}

// ---------- routine_step ----------

/**
 * `routine_step {resident, routine, step}`, which only TOWN_ACTOR sends: one step of an offline
 * resident's routine. Refused unless they turned it on (`not_set`), the world counts days, they're
 * offline (`awake`), and it hasn't used up today (`ran_today`): `walk_home` goes once a day, and a
 * stroll walks at most `ROUTINES.strollTiles` tiles a day over its legs. Then the step meets the
 * checks the resident's own command would, and a stroll keeps to plots they can build on.
 */
export function checkRoutineStep(
  state: WorldState,
  command: Extract<Command, { type: "routine_step" }>,
): RoutinesChecked {
  const { resident, routine, step } = command;
  const me = residentById(state, resident);
  if (!me) return refuse("unknown_resident", "A routine step names a resident in the world.");
  const shape: unknown = step;
  const type =
    shape !== null && typeof shape === "object" ? (shape as { type?: unknown }).type : undefined;
  if (
    !isStepRoutine(routine) ||
    (routine === "walk_home" && type !== "home") ||
    (routine === "stroll" &&
      (type !== "putter" || !Array.isArray((shape as { steps?: unknown }).steps)))
  ) {
    return refuse(
      "invalid_routine",
      "walk_home steps home, and a stroll walks a putter's steps. greet takes no steps.",
    );
  }
  if (!routineOf(state, resident, routine)) {
    return refuse("not_set", `That resident hasn't turned on ${routine}.`);
  }
  const day = state.day;
  if (day === undefined) return refuse("not_due", "Routines run once the world counts days.");
  if (me.online) {
    return refuse("awake", "That resident is in the world. Routines run only while they're away.");
  }
  const today = runsToday(state, resident);
  const ran = (runs: RoutineRuns): RoutineRuns => {
    const all = { ...(state.routineRuns ?? {}) };
    all[resident] = runs;
    state.routineRuns = all;
    return runs;
  };

  if (routine === "walk_home") {
    if (today?.walk_home) return refuse("ran_today", "walk_home already ran today.");
    const hearth = me.hearth;
    if (!hearth) return refuse("no_hearth", "There's no hearth to walk home to.");
    if (me.x === hearth.x && me.y === hearth.y && standingFloor(me) === 0) {
      // Never accepted to collect anything: a routine pays no allowance and no pantry.
      return refuse("already_home", "They're already home.");
    }
    // A jump, so it lands on the ground floor (RFC 0028).
    return () => {
      me.x = hearth.x;
      me.y = hearth.y;
      setFloor(me, 0);
      ran({ day, walk_home: true, ...(today?.stroll ? { stroll: today.stroll } : {}) });
      return [{ type: "moved", residentId: resident, x: hearth.x, y: hearth.y, routine }];
    };
  }

  const steps = (step as Extract<typeof step, { type: "putter" }>).steps;
  const walked = today?.stroll ?? 0;
  if (walked + steps.length > ROUTINES.strollTiles) {
    return refuse(
      "ran_today",
      `A stroll walks at most ${ROUTINES.strollTiles} tiles a day, out and back.`,
    );
  }
  if (!canBuildOn(plotAtTile(state, me.x, me.y), resident)) {
    return refuse("not_your_plot", "A stroll starts on its resident's own plot.");
  }
  if (steps.length === 0) return refuse("nowhere_to_go", "There's nowhere to stroll from here.");
  if (steps.length > PUTTER_MAX_STEPS) {
    return refuse("out_of_reach", `A walk takes at most ${PUTTER_MAX_STEPS} steps at a time.`);
  }
  // A stroll keeps to the floor its resident stands on.
  const floor = standingFloor(me);
  const path = walkSteps(floorGround(state, floor), me, steps);
  if (!path.ok) return refuse(path.code, path.message);
  if (path.path.some((t) => !canBuildOn(plotAtTile(state, t.x, t.y), resident))) {
    return refuse("not_your_plot", "A stroll keeps to plots its resident can build on.");
  }
  return () => {
    ran({
      day,
      ...(today?.walk_home ? { walk_home: true as const } : {}),
      stroll: walked + steps.length,
    });
    return path.path.map(({ x, y }) => {
      me.x = x;
      me.y = y;
      return { type: "moved", residentId: resident, x, y, ...floorField(floor), routine };
    });
  };
}

// ---------- the stroll planner (the server's, never replay's) ----------

/**
 * The ground a stroll walks on: the plot `plot` on `floor`, with everything off it in the way.
 */
function plotGround(state: WorldState, plot: Plot, floor: number): Ground {
  const ground = floorGround(state, floor);
  return {
    config: state.config,
    obstacle: (x, y) => {
      const p = plotOf(state.config, x, y);
      return p.px === plot.px && p.py === plot.py ? ground.obstacle(x, y) : "block";
    },
  };
}

/**
 * The plot a resident stands on, when they can build on it and stand where they are: not inside a
 * block, and upstairs on flooring.
 */
function strollPlot(state: WorldState, residentId: ResidentId): Plot | undefined {
  const me = residentById(state, residentId);
  if (!me) return undefined;
  const plot = plotAtTile(state, me.x, me.y);
  const open = !floorGround(state, standingFloor(me)).obstacle(me.x, me.y);
  return plot && canBuildOn(plot, residentId) && open ? plot : undefined;
}

/**
 * Where a stroll walks out to: up to `ROUTINES.strollOut` tiles across the plot the resident stands
 * on, as far as it goes, and never ending where an online resident stands. Where there's a choice,
 * a hash of the resident and the day picks, so it changes from day to day. Empty when they aren't
 * on a plot they can build on, or there's nowhere open; the sim turns that down with a code the
 * away log can explain. The server calls it and logs the steps, so tuning it never changes how old
 * logs replay.
 */
export function planStroll(state: WorldState, residentId: ResidentId): Direction[] {
  const me = residentById(state, residentId);
  const plot = strollPlot(state, residentId);
  if (!me || !plot) return [];
  const floor = standingFloor(me);
  const standing = new Set(
    Object.values(state.residents)
      .filter((r) => r.online && r.id !== residentId && standingFloor(r) === floor)
      .map((r) => tileKey(r.x, r.y)),
  );
  const nodes = walkTree(plotGround(state, plot, floor), me, ROUTINES.strollOut);
  const ends = nodes.flatMap((n, i) =>
    i > 0 && n.steps <= ROUTINES.strollOut && !standing.has(tileKey(n.x, n.y)) ? [i] : [],
  );
  const far = Math.max(0, ...ends.map((i) => nodes[i]?.steps ?? 0));
  const farthest = ends.filter((i) => nodes[i]?.steps === far);
  if (farthest.length === 0) return [];
  const pick = Number.parseInt(fnv1a(`stroll:${residentId}:${state.day ?? 0}`), 16);
  const end = farthest[pick % farthest.length] as number;
  return walkPath(nodes, end).map((i) => nodes[i]?.dir as Direction);
}

/**
 * The way back to `to` after a stroll's walk out: the fewest steps across the plot the resident
 * stands on. Empty when they're already there, or no way back is open.
 */
export function strollBack(state: WorldState, residentId: ResidentId, to: Tile): Direction[] {
  const me = residentById(state, residentId);
  const plot = strollPlot(state, residentId);
  if (!me || !plot) return [];
  const nodes = walkTree(plotGround(state, plot, standingFloor(me)), me, ROUTINES.strollTiles);
  const end = nodes.findIndex((n) => n.x === to.x && n.y === to.y);
  if (end <= 0) return [];
  return walkPath(nodes, end).map((i) => nodes[i]?.dir as Direction);
}
