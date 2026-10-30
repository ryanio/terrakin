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
import { blockPlaceProblem, blockRemoveProblem, moveBlockCost } from "./items";
import { tileKey } from "./keys";
import { isSide, releaseHungOnEdge } from "./surfaces";
import type { Command, Rejection, ResidentId, WorldEvent, WorldState } from "./types";

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
  const e = edgeOf(x, y, side);
  const key = edgeKey(x, y, side);
  if (command.type === "remove") {
    const taken = edgesOn(state, floor)[key];
    if (taken === undefined) return refuse("no_block", "No wall stands on that line.");
    const where = edgeWhereProblem(state, actor, x, y, side);
    if (where) return where;
    const holding = edgeRemoveProblem(state, x, y, side, floor);
    if (holding) return holding;
    const full = blockRemoveProblem(state, actor, taken);
    if (full) return full;
    return () => {
      delete edgesFor(state, floor)[key];
      tidyEdges(state, floor);
      return [
        { type: "edge_removed", x: e.x, y: e.y, side: e.side, ...floorField(floor), by: actor },
        ...moveBlockCost(state, actor, taken, 1),
        ...releaseHungOnEdge(state, e.x, e.y, e.side, floor, actor),
      ];
    };
  }
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
  const cost = blockPlaceProblem(state, actor, block);
  if (cost) return cost;
  return () => {
    edgesFor(state, floor)[key] = block;
    return [
      { type: "edge_placed", x: e.x, y: e.y, side: e.side, ...floorField(floor), block, by: actor },
      ...moveBlockCost(state, actor, block, -1),
    ];
  };
}
