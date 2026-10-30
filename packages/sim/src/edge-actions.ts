import { refuse } from "./check";
import {
  edgeKey,
  edgeOf,
  edgePlaceProblem,
  edgesFor,
  edgesOn,
  edgeWhereProblem,
  tidyEdges,
} from "./edges";
import { edgeRemoveProblem, floorField, groundOn } from "./floors";
import { gradeAt, gradeField, gradeFor, setGrade } from "./grades";
import { blockPlaceProblem, blockRemoveProblem, moveBlockCost } from "./items";
import { tileKey } from "./keys";
import { isSide, releaseHungOnEdge } from "./surfaces";
import type { Command, Rejection, ResidentId, Side, WorldEvent, WorldState } from "./types";

type Mutation = () => WorldEvent[];

/**
 * `place` and `remove` with a `side` (RFC 0050): a wall, a window, a hedge or a door on the line on
 * that side of the tile, after `apply`'s checks for where (in the world, within reach, a plot you
 * can build on, not listed, the floor). It costs what a block of its kind costs and gives it back
 * when it comes down, with what hung on either face of it.
 */
export function checkEdge(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "place" | "remove" }>,
  floor: number,
): Mutation | Rejection {
  const { x, y, side } = command;
  if (!isSide(side)) {
    return refuse("out_of_bounds", "side is n, e, s or w: the line on that side of the tile.");
  }
  if (command.type === "remove") return checkEdgeRemove(state, actor, x, y, side, floor, actor);
  const e = edgeOf(x, y, side);
  const key = edgeKey(x, y, side);
  if (command.item !== undefined || command.flower !== undefined) {
    return refuse("unknown_item", "A wall between tiles takes no item. Leave out item and flower.");
  }
  const { block } = command;
  const flooring = groundOn(state, floor);
  const where = edgePlaceProblem(
    state,
    actor,
    x,
    y,
    side,
    floor,
    block,
    (tx, ty) => flooring[tileKey(tx, ty)] !== undefined,
  );
  if (where) return where;
  // A made material may come at a grade (RFC 0051), kept on the line by its edge key.
  const grade = gradeFor(state, block, command.type === "place" ? command.grade : undefined);
  if (typeof grade !== "string") return grade;
  const cost = blockPlaceProblem(state, actor, block, grade);
  if (cost) return cost;
  return () => {
    edgesFor(state, floor)[key] = block;
    setGrade(state, floor, key, grade);
    return [
      {
        type: "edge_placed",
        x: e.x,
        y: e.y,
        side: e.side,
        ...floorField(floor),
        block,
        ...gradeField(grade),
        by: actor,
      },
      ...moveBlockCost(state, actor, block, -1, grade),
    ];
  };
}

/**
 * Taking down the line on `side` of (x, y) on `floor` as `owner` would: a wall stands there, it's
 * on plots `owner` can build on and not listed, it holds up no flooring above, and `owner` has
 * room for what it gives back. Its cost goes back to `owner`, and what hung on either face to
 * whoever hung it. `by` is who the events name: the owner on their own `remove`, the town on a
 * staff `clear_block` with a side.
 */
export function checkEdgeRemove(
  state: WorldState,
  owner: ResidentId,
  x: number,
  y: number,
  side: Side,
  floor: number,
  by: ResidentId,
): Mutation | Rejection {
  const e = edgeOf(x, y, side);
  const key = edgeKey(x, y, side);
  const taken = edgesOn(state, floor)[key];
  if (taken === undefined) return refuse("no_block", "No wall stands on that line.");
  const where = edgeWhereProblem(state, owner, x, y, side);
  if (where) return where;
  const holding = edgeRemoveProblem(state, x, y, side, floor);
  if (holding) return holding;
  const full = blockRemoveProblem(state, owner, taken);
  if (full) return full;
  // What comes back is the grade that stood there (RFC 0051).
  const was = gradeAt(state, key, floor);
  return () => {
    delete edgesFor(state, floor)[key];
    tidyEdges(state, floor);
    setGrade(state, floor, key, "plain");
    return [
      { type: "edge_removed", x: e.x, y: e.y, side: e.side, ...floorField(floor), by },
      ...moveBlockCost(state, owner, taken, 1, was),
      ...releaseHungOnEdge(state, e.x, e.y, e.side, floor, by),
    ];
  };
}
