import { coinCount, isWhole, refuse } from "./check";
import { allowanceDue, movePurse, moveTreasury, treasuryShareOf } from "./economy";
import type { GroundKind } from "./ground";
import { plotKey, tileKey } from "./keys";
import { own } from "./own";
import type {
  BlockKind,
  Climb,
  Command,
  FloorLayer,
  Plot,
  Rejection,
  Resident,
  ResidentId,
  WorldConfig,
  WorldEvent,
  WorldState,
} from "./types";
import { type Ground, worldGround } from "./walk";
import { blocksWalkers, canBuildOn, inBounds, isCommons, plotInBounds, plotOf } from "./world";

/**
 * Homes with an upstairs (RFC 0028). The ground floor is floor 0 and stays where it always was, in
 * `state.blocks` and `state.ground`. Each floor above it is a layer of its own in
 * `state.floors`, keyed by its number, absent until a plot first adds it, so every world from
 * before homes had one hashes as it did. A plot's `floors` says how many it added.
 *
 * Readers that mean "the ground floor" keep reading `state.blocks`. Readers that mean "any floor"
 * go through `blocksOn` and `groundOn`, so nothing else reaches into `state.floors` by hand. A
 * floor from an input is checked as a whole number in range (`floorOf`) before it becomes a key.
 *
 * Stairs stand on the floor you climb from, and the tile right above them, the stairwell, stays
 * open. A resident's `floor` is absent on the ground floor.
 */

/**
 * Every number about floors in one place, tuned with `scripts/economy-sim.ts` (decision 0242).
 * `floors.test.ts` pins them, so a change is deliberate.
 */
export const FLOORS = {
  /** Floors a plot may add above its ground floor. May go up later, never down. */
  max: 1,
  /**
   * Coins `add_floor` takes, split like a shop purchase: the treasury's share, the rest burned.
   * A regular who saves for it holds it about 9 days after arriving, and never in their first 5.
   */
  price: 200,
  /** How far (in tiles, Chebyshev) a wall below holds up flooring above it, on the same plot. */
  span: 2,
  /** Wood a staircase takes, given back to whoever takes it up. */
  stairsWood: 4,
} as const;

/** The blocks that hold up what's above them: walls and windows. A hedge holds nothing up. */
const HOLDING_BLOCKS: readonly BlockKind[] = ["wood", "stone", "glass"];

/**
 * Blocks that stay on the ground floor, because other state is keyed by their tile alone: crops
 * in a planter, crafting at a station, a thing on display, fishing beside a pond, and a candy
 * bowl's candy. With their names, for the refusal.
 */
const GROUND_FLOOR_ONLY: Readonly<Partial<Record<BlockKind, string>>> = {
  planter: "Planters",
  kitchen: "Kitchens",
  workbench: "Workbenches",
  pedestal: "Pedestals",
  frame: "Frames",
  pond: "Ponds",
  candy_bowl: "Candy bowls",
};

const NO_BLOCKS: Readonly<Record<string, BlockKind>> = Object.freeze({});
const NO_GROUND: Readonly<Record<string, GroundKind>> = Object.freeze({});

/** A floor's layer, for floor 1 and up, once some plot added it. */
const layerOf = (state: WorldState, floor: number): FloorLayer | undefined =>
  own(state.floors, String(floor));

/** The blocks on one floor, keyed by tileKey(x, y): the ground floor's for 0. */
export function blocksOn(state: WorldState, floor: number): Readonly<Record<string, BlockKind>> {
  if (floor === 0) return state.blocks;
  return layerOf(state, floor)?.blocks ?? NO_BLOCKS;
}

/** The paths and flooring on one floor, keyed by tileKey(x, y): the ground floor's for 0. */
export function groundOn(state: WorldState, floor: number): Readonly<Record<string, GroundKind>> {
  if (floor === 0) return state.ground ?? NO_GROUND;
  return layerOf(state, floor)?.ground ?? NO_GROUND;
}

/** Whether a block stands in the way on a tile of a floor. Stairs are the one block you walk onto. */
export function solidAt(state: WorldState, x: number, y: number, floor: number): boolean {
  return blocksWalkers(blocksOn(state, floor)[tileKey(x, y)]);
}

/** The floor a resident stands on. */
export const standingFloor = (r: Pick<Resident, "floor">): number => r.floor ?? 0;

/** Put a resident on a floor: `floor` is absent on the ground floor. */
export function setFloor(r: Resident, floor: number) {
  if (floor === 0) delete r.floor;
  else r.floor = floor;
}

/**
 * The ground a walk on `floor` reads. The ground floor's is the world's (`worldGround`). Upstairs,
 * a tile with no flooring is in the way (`no_flooring`), except a stairwell, and so is any block but
 * stairs, so nobody walks off the flooring's edge or past a corner of it.
 */
export function floorGround(state: WorldState, floor: number): Ground {
  if (floor === 0) return worldGround(state);
  const blocks = blocksOn(state, floor);
  const flooring = groundOn(state, floor);
  const below = blocksOn(state, floor - 1);
  return upstairsGroundOf({
    config: state.config,
    block: (key) => blocks[key],
    flooring: (key) => flooring[key] !== undefined,
    below: (key) => below[key],
  });
}

/**
 * The ground of a floor above the ground floor from plain facts, keyed by tileKey: what stands
 * on each tile, whether it has flooring, and what stands right under it. The client builds the same
 * one from its mirror as the sim builds from the world (`floorGround`).
 */
export function upstairsGroundOf(facts: {
  config: WorldConfig;
  block: (key: string) => BlockKind | undefined;
  flooring: (key: string) => boolean;
  below: (key: string) => BlockKind | undefined;
}): Ground {
  const { config, block, flooring, below } = facts;
  return {
    config,
    obstacle: (x, y) => {
      const key = tileKey(x, y);
      if (blocksWalkers(block(key))) return "block";
      if (!flooring(key) && below(key) !== "stairs") return "no_flooring";
      return undefined;
    },
  };
}

/** Online residents standing on (x, y) on `floor`. */
const someoneOn = (state: WorldState, x: number, y: number, floor: number) =>
  Object.values(state.residents).some(
    (r) => r.online && r.x === x && r.y === y && standingFloor(r) === floor,
  );

/** The layer a commit writes to on a floor above the ground. Its plot added it, so it's there. */
export function layerFor(state: WorldState, floor: number): FloorLayer {
  const layer = layerOf(state, floor);
  if (!layer) throw new Error(`floor ${floor} has no layer`);
  return layer;
}

/** `floor` on an event, only above the ground floor, so ground-floor events read as they did. */
export const floorField = (floor: number): { floor?: number } => (floor === 0 ? {} : { floor });

const TOO_HIGH =
  FLOORS.max === 1
    ? "A home has a ground floor and one upstairs, and goes no higher."
    : `Homes go up ${FLOORS.max} floors above the ground floor.`;

const noFloor = () =>
  `This plot has no upstairs yet. add_floor adds it for ${coinCount(FLOORS.price)}.`;

/**
 * The floor an input names, as a number, or why it can't be built on at `plot`: not a whole
 * number from 0 up (`out_of_bounds`), past `FLOORS.max` (`too_high`), or one the plot hasn't
 * added (`no_floor`). Absent is the ground floor, which is always there.
 */
export function floorOf(plot: Plot | undefined, floor: unknown): number | Rejection {
  if (floor === undefined || floor === 0) return 0;
  if (!isWhole(floor) || floor < 0) {
    return refuse("out_of_bounds", "A floor is 0 for the ground floor, or 1 for upstairs.");
  }
  if (floor > FLOORS.max) return refuse("too_high", TOO_HIGH);
  if ((plot?.floors ?? 0) < floor) return refuse("no_floor", noFloor());
  return floor;
}

const holds = (block: BlockKind | undefined) =>
  block !== undefined && HOLDING_BLOCKS.includes(block);

/**
 * What stands and lies on each floor, as a support check reads it: the world as it is
 * (`worldView`), or a build plan's running view of it, with what the plan did so far.
 */
export interface FloorView {
  block(floor: number, key: string): BlockKind | undefined;
  ground(floor: number, key: string): GroundKind | undefined;
}

/** The world's floors as they are. */
const worldView = (state: WorldState): FloorView => ({
  block: (floor, key) => blocksOn(state, floor)[key],
  ground: (floor, key) => groundOn(state, floor)[key],
});

/**
 * Whether flooring at (x, y) on `floor` (1 and up) is held up: a wall or window on the floor
 * below, within `FLOORS.span` tiles, on the same plot. `without` is a tile on the floor below
 * about to lose its block.
 */
function flooringHeld(
  state: WorldState,
  view: FloorView,
  x: number,
  y: number,
  floor: number,
  without?: string,
) {
  const { config } = state;
  const home = plotOf(config, x, y);
  const { span } = FLOORS;
  for (let ty = y - span; ty <= y + span; ty++) {
    for (let tx = x - span; tx <= x + span; tx++) {
      if (!inBounds(config, tx, ty)) continue;
      const p = plotOf(config, tx, ty);
      if (p.px !== home.px || p.py !== home.py) continue;
      const key = tileKey(tx, ty);
      if (key !== without && holds(view.block(floor - 1, key))) return true;
    }
  }
  return false;
}

/** Why flooring can't go on (x, y) on `floor`, or null. The ground floor holds any flooring. */
export function flooringProblem(
  state: WorldState,
  x: number,
  y: number,
  floor: number,
  view: FloorView = worldView(state),
): Rejection | null {
  if (floor === 0 || flooringHeld(state, view, x, y, floor)) return null;
  return refuse(
    "nothing_under",
    `Nothing holds that flooring up. Build walls under it first, within ${FLOORS.span} tiles.`,
  );
}

/**
 * Why nothing can go on (x, y) on `floor` because stairs come up there, or null. That tile, the
 * stairwell, is the open one right above a staircase.
 */
export function stairwellProblem(
  state: WorldState,
  x: number,
  y: number,
  floor: number,
  view: FloorView = worldView(state),
): Rejection | null {
  if (floor === 0 || view.block(floor - 1, tileKey(x, y)) !== "stairs") return null;
  return refuse("tile_occupied", "Stairs come up here. Keep it clear.");
}

/**
 * Why `block` can never go on `floor` of `plot`, whatever is there, or null: it stays on the
 * ground floor, or it's stairs with no floor above them on the plot.
 */
export function blockKindProblem(
  plot: Plot | undefined,
  floor: number,
  block: BlockKind,
): Rejection | null {
  if (block === "stairs") {
    const above = floor + 1;
    if (above > FLOORS.max) {
      return refuse("too_high", `Stairs go up a floor, and this is the top one. ${TOO_HIGH}`);
    }
    if ((plot?.floors ?? 0) < above) return refuse("no_floor", noFloor());
    return null;
  }
  if (floor === 0) return null;
  const only = GROUND_FLOOR_ONLY[block];
  if (only) return refuse("ground_floor_only", `${only} stay on the ground floor.`);
  return null;
}

/**
 * Why `block` can't go on (x, y) on `floor` as things stand, or null: nothing holds it up (flooring
 * on its own tile, or a wall or window right under it), or, for stairs, something is on the
 * tile above them, which they come up through (`tile_occupied`). Stairs upstairs stand on flooring.
 */
export function blockSupportProblem(
  state: WorldState,
  x: number,
  y: number,
  floor: number,
  block: BlockKind,
  view: FloorView = worldView(state),
): Rejection | null {
  const key = tileKey(x, y);
  if (block === "stairs") {
    const above = floor + 1;
    if (view.block(above, key) !== undefined || view.ground(above, key) !== undefined) {
      return refuse(
        "tile_occupied",
        "Stairs come up through the tile above them, and something is there. Clear it first.",
      );
    }
    if (floor > 0 && view.ground(floor, key) === undefined) {
      return refuse("nothing_under", "Stairs upstairs stand on flooring. Lay some there first.");
    }
    return null;
  }
  if (floor === 0) return null;
  if (view.ground(floor, key) !== undefined) return null;
  if (holds(view.block(floor - 1, key))) return null;
  return refuse(
    "nothing_under",
    "Nothing holds that up. Lay flooring there first, or build a wall right under it.",
  );
}

/** Why `block` can't go on (x, y) on `floor` of `plot`, or null: its kind, then what holds it up. */
export function blockProblem(
  state: WorldState,
  plot: Plot | undefined,
  x: number,
  y: number,
  floor: number,
  block: BlockKind,
): Rejection | null {
  return blockKindProblem(plot, floor, block) ?? blockSupportProblem(state, x, y, floor, block);
}

/**
 * Why the block at (x, y) on `floor` can't be taken away, or null: stairs someone is on, at the
 * foot or at the top, or a wall that is all that holds up a block right above it with no flooring of
 * its own, or the last wall within reach of flooring above.
 */
export function removeProblem(
  state: WorldState,
  x: number,
  y: number,
  floor: number,
  view: FloorView = worldView(state),
): Rejection | null {
  const key = tileKey(x, y);
  const above = floor + 1;
  const block = view.block(floor, key);
  if (block === "stairs" && (someoneOn(state, x, y, floor) || someoneOn(state, x, y, above))) {
    return refuse("holds_up", "Someone is on those stairs. Wait until they step off.");
  }
  if (above > FLOORS.max || !holds(block)) return null;
  if (view.block(above, key) !== undefined && view.ground(above, key) === undefined) {
    return refuse("holds_up", "That wall holds up the block above it. Take that away first.");
  }
  const { config } = state;
  const home = plotOf(config, x, y);
  const { span } = FLOORS;
  for (let ty = y - span; ty <= y + span; ty++) {
    for (let tx = x - span; tx <= x + span; tx++) {
      if (!inBounds(config, tx, ty)) continue;
      const p = plotOf(config, tx, ty);
      if (p.px !== home.px || p.py !== home.py) continue;
      if (view.ground(above, tileKey(tx, ty)) === undefined) continue;
      if (!flooringHeld(state, view, tx, ty, above, key)) {
        return refuse(
          "holds_up",
          `That wall holds up the flooring above at x ${tx}, y ${ty}. Lift the flooring first.`,
        );
      }
    }
  }
  return null;
}

/**
 * Why the flooring at (x, y) on `floor` can't be lifted, or null: someone stands on it, stairs stand
 * on it, or a block stands on it with no wall right under it. Flooring on the ground floor holds
 * nothing up.
 */
export function liftProblem(
  state: WorldState,
  x: number,
  y: number,
  floor: number,
  view: FloorView = worldView(state),
): Rejection | null {
  if (floor === 0) return null;
  const key = tileKey(x, y);
  if (someoneOn(state, x, y, floor)) {
    return refuse("holds_up", "Someone is standing on that flooring. Wait until they step off.");
  }
  const block = view.block(floor, key);
  if (block !== undefined && (block === "stairs" || !holds(view.block(floor - 1, key)))) {
    return refuse("holds_up", "That flooring holds up the block on it. Take the block away first.");
  }
  return null;
}

/** Whether anything stands or lies on any floor of a plot. `release` and `merge` read it. */
export function plotHasAnything(state: WorldState, px: number, py: number): boolean {
  const { plotSize } = state.config;
  const floors = [0, ...Object.keys(state.floors ?? {}).map(Number)];
  for (const floor of floors) {
    const blocks = blocksOn(state, floor);
    const ground = groundOn(state, floor);
    for (let y = py * plotSize; y < (py + 1) * plotSize; y++) {
      for (let x = px * plotSize; x < (px + 1) * plotSize; x++) {
        const key = tileKey(x, y);
        if (blocks[key] !== undefined || ground[key] !== undefined) return true;
      }
    }
  }
  return false;
}

type Mutation = () => WorldEvent[];

/**
 * `move up` from stairs to the stairwell one floor up, and `move down` from a stairwell onto the
 * stairs below. One step each, paced like any move. Anything else is `no_stairs`.
 */
export function checkClimb(state: WorldState, me: Resident, dir: Climb): Mutation | Rejection {
  const from = standingFloor(me);
  const to = dir === "up" ? from + 1 : from - 1;
  const block = (floor: number, key: string) => blocksOn(state, floor)[key];
  if (!climbsAt(block, me.x, me.y, from).includes(dir)) {
    return refuse(
      "no_stairs",
      dir === "up" ? "Stand on stairs to go up." : "Stand at the top of the stairs to go down.",
    );
  }
  return () => {
    setFloor(me, to);
    return [{ type: "moved", residentId: me.id, x: me.x, y: me.y, ...floorField(to) }];
  };
}

/**
 * The ways someone on (x, y) on `floor` can climb, from what stands on each floor: `up` from
 * stairs, `down` from the top of stairs on the floor below. The client reads it from its mirror to
 * offer Go up and Go down.
 */
export function climbsAt(
  block: (floor: number, key: string) => BlockKind | undefined,
  x: number,
  y: number,
  floor: number,
): Climb[] {
  const key = tileKey(x, y);
  const ways: Climb[] = [];
  if (block(floor, key) === "stairs") ways.push("up");
  if (floor > 0 && block(floor - 1, key) === "stairs") ways.push("down");
  return ways;
}

/** Why `me` can't do `what` from where they stand: it happens on the ground floor. */
export function upstairsProblem(me: Pick<Resident, "floor">, what: string): Rejection | null {
  if (standingFloor(me) === 0) return null;
  return refuse("ground_floor_only", `Go down to the ground floor to ${what}.`);
}

/**
 * `add_floor {px, py}`: from anywhere, on a plot you own or share, never the Commons, with coins
 * open. It takes `FLOORS.price` like a shop purchase (the treasury's share in, the rest burned)
 * and opens the next floor, empty until flooring goes down. A floor is never taken away or paid
 * back.
 */
export function checkAddFloor(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "add_floor" }>,
): Mutation | Rejection {
  const { config } = state;
  const { px, py } = command;
  if (!plotInBounds(config, px, py))
    return refuse("out_of_bounds", "That plot is outside the world.");
  if (isCommons(config, px, py)) {
    return refuse(
      "plot_is_commons",
      "The Commons stays on the ground. Add an upstairs to your own plot.",
    );
  }
  const plot = state.plots[plotKey(px, py)];
  if (!plot || !canBuildOn(plot, actor)) {
    return refuse("not_your_plot", "You can add an upstairs only to a plot you own or share.");
  }
  const econ = state.economy;
  const day = state.day;
  if (!econ || day === undefined) {
    return refuse("economy_closed", "An upstairs costs coins, and coins aren't open yet.");
  }
  const has = plot.floors ?? 0;
  if (has >= FLOORS.max) return refuse("too_high", TOO_HIGH);
  const price = FLOORS.price;
  const purse = econ.coins[actor] ?? 0;
  if (purse < price) {
    const tip = allowanceDue(state, actor)
      ? "Today's allowance is waiting: send home first."
      : "Come home each day for your allowance.";
    return refuse(
      "not_enough_coins",
      `An upstairs is ${coinCount(price)}, and you have ${coinCount(purse)}. ${tip}`,
    );
  }
  const floor = has + 1;
  const at = { seq: state.seq + 1, day };
  const toTreasury = Math.floor((price * treasuryShareOf(state)) / 100);
  return () => {
    plot.floors = floor;
    state.floors ??= {};
    state.floors[String(floor)] ??= { blocks: {}, ground: {} };
    const events: WorldEvent[] = [
      { type: "floor_added", px, py, floor, by: actor },
      movePurse(econ, actor, -price, "floor", at),
    ];
    // The treasury's history is public, so its share is a line that doesn't say who paid.
    if (toTreasury > 0) events.push(moveTreasury(econ, toTreasury, "floor", at));
    econ.burned += price - toTreasury;
    return events;
  };
}
