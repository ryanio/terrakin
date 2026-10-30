import { type ErrorCode, WALK_TO_MAX_STEPS } from "@terrakin/protocol";
import {
  asJoined,
  chebyshev,
  type Direction,
  floorGround,
  inBounds,
  type WorldState,
  walkLegsTo,
} from "@terrakin/sim";
import type { ActResult, WalkStop } from "./world-service";

type Acted = Extract<ActResult, { ok: true }>;

/**
 * Where a `walk_to` goes (decision 0405): the fewest steps from where the walker stands, or would
 * stand once back online, to (x, y) or within `near` tiles of it, on their own floor, as legs of
 * one direction each (the sim's `walkLegsTo`, the walk every out-of-reach refusal names). Or why
 * not, in words for the walker.
 */
export function planWalkTo(
  world: WorldState,
  residentId: string,
  to: { x: number; y: number },
  near = 0,
): { legs: [Direction, number][] } | { code: ErrorCode; message: string } {
  const state = asJoined(world, residentId);
  const me = state.residents[residentId];
  if (!me) return { code: "not_joined", message: "Join the world first." };
  if (!inBounds(state.config, to.x, to.y)) {
    return { code: "out_of_bounds", message: "That's outside the world." };
  }
  if (chebyshev(me, to) <= near) return { code: "already_there", message: "You're already there." };
  const legs = walkLegsTo(state, me, to, near, floorGround(state, me.floor ?? 0));
  if (!legs || legs.length === 0) {
    const beside =
      near === 0 ? ' If something stands on that tile, send "near": 1 to stop beside it.' : "";
    return {
      code: "blocked",
      message: `No walk from where you stand reaches x ${to.x}, y ${to.y} on this floor.${beside}`,
    };
  }
  return { legs };
}

/**
 * Walk planned `legs` a step at a time with `step`, which sends one `move` and pays for it, up to
 * `WALK_TO_MAX_STEPS`. Stops at the first refusal: `refused` when nothing moved at all, else
 * `stopped`. `arrived` when every step was taken.
 */
export function walkLegs(
  legs: readonly [Direction, number][],
  step: (dir: Direction, index: number) => ActResult,
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
