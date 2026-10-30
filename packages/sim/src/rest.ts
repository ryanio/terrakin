import { isWhole, refuse } from "./check";
import { blocksOn, floorField, floorGround, standingFloor } from "./floors";
import { isSeatKind, SEATS, type SeatKind } from "./furniture";
import { tileKey } from "./keys";
import type { Command, Rejection, Resident, Tile, WorldEvent, WorldState } from "./types";
import { directionOf, type Ground, stepFrom, walkWords } from "./walk";
import { chebyshev, inBounds } from "./world";

/**
 * Resting (RFC 0044): `rest {x, y, floor?}` puts you on the seat on that tile, one step away. You
 * sit on a chair, a bench, an armchair, a sofa or a rocking chair, and lie on a bed (`SEATS`).
 * Resting is where you stand, never a field, so any move takes you off and nothing can go stale. It pays nothing.
 */

type Mutation = () => WorldEvent[];

const words = (kind: SeatKind) =>
  ({
    chair: "chair",
    bench: "bench",
    armchair: "armchair",
    sofa: "sofa",
    bed: "bed",
    rocking_chair: "rocking chair",
  })[kind];

/** The floor's own walking ground with one tile counted open: the step onto a solid seat. */
const openingOnto = (ground: Ground, seat: Tile): Ground => ({
  config: ground.config,
  obstacle: (x, y) => (x === seat.x && y === seat.y ? undefined : ground.obstacle(x, y)),
  ...(ground.edge ? { edge: ground.edge } : {}),
});

/** Whether one step takes `from` onto the seat: beside it, with no corner in the way. */
function stepsOnto(ground: Ground, from: Tile, seat: Tile): boolean {
  if (chebyshev(from, seat) !== 1) return false;
  const dir = directionOf(seat.x - from.x, seat.y - from.y);
  return dir !== undefined && stepFrom(openingOnto(ground, seat), from, dir).ok;
}

/**
 * The shortest walk, as `move` calls, to a tile a step onto the seat goes from, or "" when there's
 * none. Each tile beside the seat is tried, since the one nearest may be round a corner.
 */
function walkBeside(state: WorldState, me: Tile, seat: Tile, ground: Ground): string {
  let best = "";
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const from = { x: seat.x + dx, y: seat.y + dy };
      if ((dx === 0 && dy === 0) || !inBounds(state.config, from.x, from.y)) continue;
      if (ground.obstacle(from.x, from.y) || !stepsOnto(ground, from, seat)) continue;
      const walk = walkWords(state, me, from, 0, ground);
      const legs = (w: string) => w.split(", then ").length;
      if (walk && (!best || legs(walk) < legs(best))) best = walk;
    }
  }
  return best;
}

export function checkRest(
  state: WorldState,
  me: Resident,
  command: Extract<Command, { type: "rest" }>,
): Mutation | Rejection {
  const { x, y } = command;
  if (!isWhole(x) || !isWhole(y) || !inBounds(state.config, x, y)) {
    return refuse("out_of_bounds", "That tile isn't in the world.");
  }
  const floor = command.floor ?? 0;
  if (!isWhole(floor) || floor < 0) {
    return refuse("out_of_bounds", "A floor is 0 for the ground floor, or 1 for upstairs.");
  }
  const mine = standingFloor(me);
  if (floor !== mine) {
    return refuse(
      "out_of_reach",
      mine === 0
        ? "That seat is upstairs. Go up the stairs first (move up), then rest."
        : "That seat is on another floor. Climb to it first (move up or move down), then rest.",
    );
  }
  const block = blocksOn(state, floor)[tileKey(x, y)];
  if (block === undefined) return refuse("no_block", "There's nothing there to rest on.");
  if (!isSeatKind(block)) {
    return refuse(
      "not_a_seat",
      `You can't rest on that. Seats are ${(Object.keys(SEATS) as SeatKind[]).map(words).join(", ")}: lie on a bed, and sit on the rest.`,
    );
  }
  if (me.x === x && me.y === y) {
    return refuse("already_there", `You're already on that ${words(block)}.`);
  }
  const taken = Object.values(state.residents).some(
    (r) => r.id !== me.id && r.online && r.x === x && r.y === y && standingFloor(r) === floor,
  );
  if (taken) return refuse("tile_occupied", `Someone's already on that ${words(block)}.`);
  const seat = { x, y };
  const ground = floorGround(state, floor);
  if (!stepsOnto(ground, me, seat)) {
    const walk = walkBeside(state, me, seat, ground);
    return refuse(
      "out_of_reach",
      `Stand beside the ${words(block)}, with nothing in the way of the step onto it, to rest on it.${walk ? ` Walk there: ${walk}, then rest.` : " Nothing walks there from here."}`,
    );
  }
  return () => {
    me.x = x;
    me.y = y;
    return [
      { type: "moved", residentId: me.id, x, y, ...floorField(floor) },
      { type: "rested", residentId: me.id, x, y, ...floorField(floor), block },
    ];
  };
}
