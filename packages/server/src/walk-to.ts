import { type ErrorCode, WALK_TO_MAX_STEPS } from "@terrakin/protocol";
import {
  asJoined,
  blocksOn,
  type Climb,
  chebyshev,
  climbsAt,
  DIRECTIONS,
  type Direction,
  FLOORS,
  floorGround,
  type Ground,
  inBounds,
  STEP,
  standingFloor,
  stepFrom,
  type Tile,
  type WorldState,
} from "@terrakin/sim";
import type { ActResult, WalkStop } from "./world-service";

type Acted = Extract<ActResult, { ok: true }>;

/** One step of a walk: a tile in one of eight directions, or a climb up or down a staircase. */
export type WalkDir = Direction | Climb;

/** Where a walk stands: a tile on a floor. */
interface Spot extends Tile {
  floor: number;
}

const spotKey = (s: Spot) => `${s.floor}:${s.x},${s.y}`;

/**
 * Where a `walk_to` goes (decisions 0405 and 0408): the fewest steps from where the walker stands,
 * or would stand once back online, to (x, y) on `to.floor` (the ground floor when absent), or
 * within `near` tiles of it on that floor. A step is a tile in one direction or a climb `up` or
 * `down` a staircase, each one `move`. The walk comes as legs of one direction each, and a climb
 * is always a leg of its own, one floor. Or why not, in words for the walker.
 */
export function planWalkTo(
  world: WorldState,
  residentId: string,
  to: { x: number; y: number; floor?: number | undefined },
  near = 0,
): { legs: [WalkDir, number][] } | { code: ErrorCode; message: string } {
  const state = asJoined(world, residentId);
  const me = state.residents[residentId];
  if (!me) return { code: "not_joined", message: "Join the world first." };
  if (!inBounds(state.config, to.x, to.y)) {
    return { code: "out_of_bounds", message: "That's outside the world." };
  }
  const goal = { x: to.x, y: to.y, floor: to.floor ?? 0 };
  const from = { x: me.x, y: me.y, floor: standingFloor(me) };
  if (from.floor === goal.floor && chebyshev(from, goal) <= near) {
    return { code: "already_there", message: "You're already there." };
  }
  const steps = walkAcross(state, from, goal, near);
  if (!steps) {
    const beside =
      near === 0 ? ' If something stands on that tile, send "near": 1 to stop beside it.' : "";
    return {
      code: "blocked",
      message: `No walk from where you stand reaches x ${to.x}, y ${to.y} ${onFloor(goal.floor)}.${beside}`,
    };
  }
  const legs: [WalkDir, number][] = [];
  for (const dir of steps) {
    const last = legs[legs.length - 1];
    if (last && last[0] === dir && !isClimb(dir)) last[1]++;
    else legs.push([dir, 1]);
  }
  return { legs };
}

const isClimb = (dir: WalkDir): dir is Climb => dir === "up" || dir === "down";

/** A floor as the end of a sentence: "on the ground floor", "upstairs", "on floor 2". */
function onFloor(floor: number): string {
  if (floor === 0) return "on the ground floor";
  return floor === 1 && FLOORS.max === 1 ? "upstairs" : `on floor ${floor}`;
}

/**
 * The fewest steps from `from` to stand on `to.floor` within `near` tiles of `to`, breadth first
 * over every floor, joined where the sim lets someone climb (`climbsAt`): `up` from stairs, `down`
 * from the stairwell above them. A tile's step is the sim's own `stepFrom` on that floor's ground,
 * so every step planned is a `move` the sim takes. Like `walkLegsTo`, it looks near first and only
 * then across the whole world. Undefined when no walk gets there.
 */
function walkAcross(state: WorldState, from: Spot, to: Spot, near: number): WalkDir[] | undefined {
  const world = Math.max(state.config.width, state.config.height);
  const grounds = new Map<number, Ground>();
  const groundOn = (floor: number) => {
    let ground = grounds.get(floor);
    if (!ground) {
      ground = floorGround(state, floor);
      grounds.set(floor, ground);
    }
    return ground;
  };
  const block = (floor: number, key: string) => blocksOn(state, floor)[key];
  for (const radius of [Math.min(world, chebyshev(from, to) + near + 8), world]) {
    const nodes: { spot: Spot; prev: number; dir: WalkDir | null }[] = [
      { spot: from, prev: -1, dir: null },
    ];
    const seen = new Set([spotKey(from)]);
    const reach = (prev: number, dir: WalkDir, spot: Spot) => {
      const key = spotKey(spot);
      if (seen.has(key)) return;
      seen.add(key);
      nodes.push({ spot, prev, dir });
    };
    for (let i = 0; i < nodes.length; i++) {
      const { spot } = nodes[i] as (typeof nodes)[number];
      if (spot.floor === to.floor && chebyshev(spot, to) <= near) {
        const steps: WalkDir[] = [];
        for (let at = i; at > 0; at = nodes[at]?.prev ?? 0) steps.push(nodes[at]?.dir as WalkDir);
        return steps.reverse();
      }
      for (const dir of DIRECTIONS) {
        const [dx, dy] = STEP[dir];
        const x = spot.x + dx;
        const y = spot.y + dy;
        if (Math.abs(x - from.x) > radius || Math.abs(y - from.y) > radius) continue;
        if (!stepFrom(groundOn(spot.floor), spot, dir).ok) continue;
        reach(i, dir, { x, y, floor: spot.floor });
      }
      for (const climb of climbsAt(block, spot.x, spot.y, spot.floor)) {
        reach(i, climb, { x: spot.x, y: spot.y, floor: spot.floor + (climb === "up" ? 1 : -1) });
      }
    }
    if (radius === world) break;
  }
  return undefined;
}

/**
 * Walk planned `legs` a step at a time with `step`, which sends one `move` (a tile or a climb) and
 * pays for it, up to `WALK_TO_MAX_STEPS` steps, a climb counting as one. Stops at the first
 * refusal: `refused` when nothing moved at all, else `stopped`. `arrived` when every step was taken.
 */
export function walkLegs(
  legs: readonly [WalkDir, number][],
  step: (dir: WalkDir, index: number) => ActResult,
):
  | { refused: Extract<ActResult, { ok: false }> }
  | { last: Acted; events: Acted["events"]; walked: number; arrived: boolean; stopped?: WalkStop } {
  const dirs = legs.flatMap(([dir, n]) => Array.from({ length: n }, () => dir));
  const events: Acted["events"] = [];
  let last: Acted | undefined;
  let walked = 0;
  let stopped: WalkStop | undefined;
  for (const dir of dirs.slice(0, WALK_TO_MAX_STEPS)) {
    const result = step(dir, walked);
    if (!result.ok) {
      if (!last) return { refused: result };
      stopped = { code: result.error.code, message: result.error.message };
      break;
    }
    events.push(...result.events);
    last = result;
    walked++;
  }
  if (!last)
    return {
      refused: { ok: false, error: { code: "blocked", message: "Something is in the way." } },
    };
  return {
    last,
    events,
    walked,
    arrived: walked === dirs.length,
    ...(stopped ? { stopped } : {}),
  };
}
