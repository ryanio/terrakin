import { coinCount, isWhole, refuse } from "./check";
import { allowanceDue, movePurse, moveTreasury, treasuryShareOf } from "./economy";
import type { GroundKind } from "./ground";
import { plotKey, tileKey } from "./keys";
import { own } from "./own";
import type {
  BlockKind,
  Climb,
  Command,
  Plot,
  Rejection,
  Resident,
  ResidentId,
  StoreyLayer,
  WorldConfig,
  WorldEvent,
  WorldState,
} from "./types";
import { type Ground, worldGround } from "./walk";
import { blocksWalkers, canBuildOn, inBounds, isCommons, plotInBounds, plotOf } from "./world";

/**
 * Homes with storeys (RFC 0028). The ground floor is storey 0 and stays where it always was, in
 * `state.blocks` and `state.ground`. Each storey above it is a layer of its own in
 * `state.storeys`, keyed by its number, absent until a plot first adds it, so every world from
 * before storeys hashes as it did. A plot's `storeys` says how many it added.
 *
 * Readers that mean "the ground floor" keep reading `state.blocks`. Readers that mean "any storey"
 * go through `blocksOn` and `groundOn`, so nothing else reaches into `state.storeys` by hand. A
 * storey from an input is checked as a whole number in range (`storeyOf`) before it becomes a key.
 *
 * Stairs stand on the storey you climb from, and the tile right above them, the stairwell, stays
 * open. A resident's `storey` is absent on the ground floor.
 */

/**
 * Every number about storeys in one place, tuned with `scripts/economy-sim.ts` (decision 0242).
 * `storeys.test.ts` pins them, so a change is deliberate.
 */
export const STOREYS = {
  /** Storeys a plot may add above its ground floor. May go up later, never down. */
  max: 1,
  /**
   * Coins `add_storey` takes, split like a shop purchase: the treasury's share, the rest burned.
   * A regular who saves for it holds it about 9 days after arriving, and never in their first 5.
   */
  price: 200,
  /** How far (in tiles, Chebyshev) a wall below holds up a floor above it, on the same plot. */
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

/** A storey's layer, for storey 1 and up, once some plot added it. */
const layerOf = (state: WorldState, storey: number): StoreyLayer | undefined =>
  own(state.storeys, String(storey));

/** The blocks on one storey, keyed by tileKey(x, y): the ground floor's for 0. */
export function blocksOn(state: WorldState, storey: number): Readonly<Record<string, BlockKind>> {
  if (storey === 0) return state.blocks;
  return layerOf(state, storey)?.blocks ?? NO_BLOCKS;
}

/** The paths and floors on one storey, keyed by tileKey(x, y): the ground floor's for 0. */
export function groundOn(state: WorldState, storey: number): Readonly<Record<string, GroundKind>> {
  if (storey === 0) return state.ground ?? NO_GROUND;
  return layerOf(state, storey)?.ground ?? NO_GROUND;
}

/** Whether a block stands in the way on a tile of a storey. Stairs are the one block you walk onto. */
export function solidAt(state: WorldState, x: number, y: number, storey: number): boolean {
  return blocksWalkers(blocksOn(state, storey)[tileKey(x, y)]);
}

/** The storey a resident stands on. */
export const standingStorey = (r: Pick<Resident, "storey">): number => r.storey ?? 0;

/** Put a resident on a storey: `storey` is absent on the ground floor. */
export function setStorey(r: Resident, storey: number) {
  if (storey === 0) delete r.storey;
  else r.storey = storey;
}

/**
 * The ground a walk on `storey` reads. The ground floor's is the world's (`worldGround`). Upstairs,
 * a tile with no floor is in the way (`no_floor`), except a stairwell, and so is any block but
 * stairs, so nobody walks off a floor's edge or past a corner of one.
 */
export function storeyGround(state: WorldState, storey: number): Ground {
  if (storey === 0) return worldGround(state);
  const blocks = blocksOn(state, storey);
  const floors = groundOn(state, storey);
  const below = blocksOn(state, storey - 1);
  return upstairsGroundOf({
    config: state.config,
    block: (key) => blocks[key],
    floor: (key) => floors[key] !== undefined,
    below: (key) => below[key],
  });
}

/**
 * The ground of a storey above the ground floor from plain facts, keyed by tileKey: what stands
 * on each tile, whether it has a floor, and what stands right under it. The client builds the same
 * one from its mirror as the sim builds from the world (`storeyGround`).
 */
export function upstairsGroundOf(facts: {
  config: WorldConfig;
  block: (key: string) => BlockKind | undefined;
  floor: (key: string) => boolean;
  below: (key: string) => BlockKind | undefined;
}): Ground {
  const { config, block, floor, below } = facts;
  return {
    config,
    obstacle: (x, y) => {
      const key = tileKey(x, y);
      if (blocksWalkers(block(key))) return "block";
      if (!floor(key) && below(key) !== "stairs") return "no_floor";
      return undefined;
    },
  };
}

/** Online residents standing on (x, y) on `storey`. */
const someoneOn = (state: WorldState, x: number, y: number, storey: number) =>
  Object.values(state.residents).some(
    (r) => r.online && r.x === x && r.y === y && standingStorey(r) === storey,
  );

/** The layer a commit writes to on a storey above the ground. Its plot added it, so it's there. */
export function layerFor(state: WorldState, storey: number): StoreyLayer {
  const layer = layerOf(state, storey);
  if (!layer) throw new Error(`storey ${storey} has no layer`);
  return layer;
}

/** `storey` on an event, only above the ground floor, so ground-floor events read as they did. */
export const storeyField = (storey: number): { storey?: number } =>
  storey === 0 ? {} : { storey };

const TOO_HIGH =
  STOREYS.max === 1
    ? "Homes go up one storey above the ground floor."
    : `Homes go up ${STOREYS.max} storeys above the ground floor.`;

const noStorey = () =>
  `This plot has no upstairs yet. add_storey adds it for ${coinCount(STOREYS.price)}.`;

/**
 * The storey an input names, as a number, or why it can't be built on at `plot`: not a whole
 * number from 0 up (`out_of_bounds`), past `STOREYS.max` (`too_high`), or one the plot hasn't
 * added (`no_storey`). Absent is the ground floor, which is always there.
 */
export function storeyOf(plot: Plot | undefined, storey: unknown): number | Rejection {
  if (storey === undefined || storey === 0) return 0;
  if (!isWhole(storey) || storey < 0) {
    return refuse("out_of_bounds", "A storey is 0 for the ground floor, or 1 for upstairs.");
  }
  if (storey > STOREYS.max) return refuse("too_high", TOO_HIGH);
  if ((plot?.storeys ?? 0) < storey) return refuse("no_storey", noStorey());
  return storey;
}

const holds = (block: BlockKind | undefined) =>
  block !== undefined && HOLDING_BLOCKS.includes(block);

/**
 * What stands and lies on each storey, as a support check reads it: the world as it is
 * (`worldView`), or a build plan's running view of it, with what the plan did so far.
 */
export interface StoreyView {
  block(storey: number, key: string): BlockKind | undefined;
  ground(storey: number, key: string): GroundKind | undefined;
}

/** The world's storeys as they are. */
const worldView = (state: WorldState): StoreyView => ({
  block: (storey, key) => blocksOn(state, storey)[key],
  ground: (storey, key) => groundOn(state, storey)[key],
});

/**
 * Whether a floor at (x, y) on `storey` (1 and up) is held up: a wall or window on the storey
 * below, within `STOREYS.span` tiles, on the same plot. `without` is a tile on the storey below
 * about to lose its block.
 */
function floorHeld(
  state: WorldState,
  view: StoreyView,
  x: number,
  y: number,
  storey: number,
  without?: string,
) {
  const { config } = state;
  const home = plotOf(config, x, y);
  const { span } = STOREYS;
  for (let ty = y - span; ty <= y + span; ty++) {
    for (let tx = x - span; tx <= x + span; tx++) {
      if (!inBounds(config, tx, ty)) continue;
      const p = plotOf(config, tx, ty);
      if (p.px !== home.px || p.py !== home.py) continue;
      const key = tileKey(tx, ty);
      if (key !== without && holds(view.block(storey - 1, key))) return true;
    }
  }
  return false;
}

/** Why a floor can't go on (x, y) on `storey`, or null. The ground floor holds any floor. */
export function floorProblem(
  state: WorldState,
  x: number,
  y: number,
  storey: number,
  view: StoreyView = worldView(state),
): Rejection | null {
  if (storey === 0 || floorHeld(state, view, x, y, storey)) return null;
  return refuse(
    "nothing_under",
    `Nothing holds that floor up. Build walls under it first, within ${STOREYS.span} tiles.`,
  );
}

/**
 * Why nothing can go on (x, y) on `storey` because stairs come up there, or null. That tile, the
 * stairwell, is the open one right above a staircase.
 */
export function stairwellProblem(
  state: WorldState,
  x: number,
  y: number,
  storey: number,
  view: StoreyView = worldView(state),
): Rejection | null {
  if (storey === 0 || view.block(storey - 1, tileKey(x, y)) !== "stairs") return null;
  return refuse("tile_occupied", "Stairs come up here. Keep it clear.");
}

/**
 * Why `block` can never go on `storey` of `plot`, whatever is there, or null: it stays on the
 * ground floor, or it's stairs with no storey above them on the plot.
 */
export function blockKindProblem(
  plot: Plot | undefined,
  storey: number,
  block: BlockKind,
): Rejection | null {
  if (block === "stairs") {
    const above = storey + 1;
    if (above > STOREYS.max) {
      return refuse("too_high", `Stairs go up a storey, and this is the top one. ${TOO_HIGH}`);
    }
    if ((plot?.storeys ?? 0) < above) return refuse("no_storey", noStorey());
    return null;
  }
  if (storey === 0) return null;
  const only = GROUND_FLOOR_ONLY[block];
  if (only) return refuse("ground_floor_only", `${only} stay on the ground floor.`);
  return null;
}

/**
 * Why `block` can't go on (x, y) on `storey` as things stand, or null: nothing holds it up (a
 * floor on its own tile, or a wall or window right under it), or, for stairs, something is on the
 * tile above them, which they come up through (`tile_occupied`). Stairs upstairs stand on a floor.
 */
export function blockSupportProblem(
  state: WorldState,
  x: number,
  y: number,
  storey: number,
  block: BlockKind,
  view: StoreyView = worldView(state),
): Rejection | null {
  const key = tileKey(x, y);
  if (block === "stairs") {
    const above = storey + 1;
    if (view.block(above, key) !== undefined || view.ground(above, key) !== undefined) {
      return refuse(
        "tile_occupied",
        "Stairs come up through the tile above them, and something is there. Clear it first.",
      );
    }
    if (storey > 0 && view.ground(storey, key) === undefined) {
      return refuse("nothing_under", "Stairs upstairs stand on a floor. Lay one there first.");
    }
    return null;
  }
  if (storey === 0) return null;
  if (view.ground(storey, key) !== undefined) return null;
  if (holds(view.block(storey - 1, key))) return null;
  return refuse(
    "nothing_under",
    "Nothing holds that up. Lay a floor there first, or build a wall right under it.",
  );
}

/** Why `block` can't go on (x, y) on `storey` of `plot`, or null: its kind, then what holds it up. */
export function blockProblem(
  state: WorldState,
  plot: Plot | undefined,
  x: number,
  y: number,
  storey: number,
  block: BlockKind,
): Rejection | null {
  return blockKindProblem(plot, storey, block) ?? blockSupportProblem(state, x, y, storey, block);
}

/**
 * Why the block at (x, y) on `storey` can't be taken away, or null: stairs someone is on, at the
 * foot or at the top, or a wall that is all that holds up a block right above it with no floor of
 * its own, or the last wall within reach of a floor above.
 */
export function removeProblem(
  state: WorldState,
  x: number,
  y: number,
  storey: number,
  view: StoreyView = worldView(state),
): Rejection | null {
  const key = tileKey(x, y);
  const above = storey + 1;
  const block = view.block(storey, key);
  if (block === "stairs" && (someoneOn(state, x, y, storey) || someoneOn(state, x, y, above))) {
    return refuse("holds_up", "Someone is on those stairs. Wait until they step off.");
  }
  if (above > STOREYS.max || !holds(block)) return null;
  if (view.block(above, key) !== undefined && view.ground(above, key) === undefined) {
    return refuse("holds_up", "That wall holds up the block above it. Take that away first.");
  }
  const { config } = state;
  const home = plotOf(config, x, y);
  const { span } = STOREYS;
  for (let ty = y - span; ty <= y + span; ty++) {
    for (let tx = x - span; tx <= x + span; tx++) {
      if (!inBounds(config, tx, ty)) continue;
      const p = plotOf(config, tx, ty);
      if (p.px !== home.px || p.py !== home.py) continue;
      if (view.ground(above, tileKey(tx, ty)) === undefined) continue;
      if (!floorHeld(state, view, tx, ty, above, key)) {
        return refuse(
          "holds_up",
          `That wall holds up the floor above at x ${tx}, y ${ty}. Lift the floor first.`,
        );
      }
    }
  }
  return null;
}

/**
 * Why the floor at (x, y) on `storey` can't be lifted, or null: someone stands on it, stairs stand
 * on it, or a block stands on it with no wall right under it. Floors on the ground floor hold
 * nothing up.
 */
export function liftProblem(
  state: WorldState,
  x: number,
  y: number,
  storey: number,
  view: StoreyView = worldView(state),
): Rejection | null {
  if (storey === 0) return null;
  const key = tileKey(x, y);
  if (someoneOn(state, x, y, storey)) {
    return refuse("holds_up", "Someone is standing on that floor. Wait until they step off.");
  }
  const block = view.block(storey, key);
  if (block !== undefined && (block === "stairs" || !holds(view.block(storey - 1, key)))) {
    return refuse("holds_up", "That floor holds up the block on it. Take the block away first.");
  }
  return null;
}

/** Whether anything stands or lies on any storey of a plot. `release` and `merge` read it. */
export function plotHasAnything(state: WorldState, px: number, py: number): boolean {
  const { plotSize } = state.config;
  const storeys = [0, ...Object.keys(state.storeys ?? {}).map(Number)];
  for (const storey of storeys) {
    const blocks = blocksOn(state, storey);
    const ground = groundOn(state, storey);
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
 * `move up` from stairs to the stairwell one storey up, and `move down` from a stairwell onto the
 * stairs below. One step each, paced like any move. Anything else is `no_stairs`.
 */
export function checkClimb(state: WorldState, me: Resident, dir: Climb): Mutation | Rejection {
  const from = standingStorey(me);
  const to = dir === "up" ? from + 1 : from - 1;
  const block = (storey: number, key: string) => blocksOn(state, storey)[key];
  if (!climbsAt(block, me.x, me.y, from).includes(dir)) {
    return refuse(
      "no_stairs",
      dir === "up" ? "Stand on stairs to go up." : "Stand at the top of the stairs to go down.",
    );
  }
  return () => {
    setStorey(me, to);
    return [{ type: "moved", residentId: me.id, x: me.x, y: me.y, ...storeyField(to) }];
  };
}

/**
 * The ways someone on (x, y) on `storey` can climb, from what stands on each storey: `up` from
 * stairs, `down` from the top of stairs on the storey below. The client reads it from its mirror to
 * offer Go up and Go down.
 */
export function climbsAt(
  block: (storey: number, key: string) => BlockKind | undefined,
  x: number,
  y: number,
  storey: number,
): Climb[] {
  const key = tileKey(x, y);
  const ways: Climb[] = [];
  if (block(storey, key) === "stairs") ways.push("up");
  if (storey > 0 && block(storey - 1, key) === "stairs") ways.push("down");
  return ways;
}

/** Why `me` can't do `what` from where they stand: it happens on the ground floor. */
export function upstairsProblem(me: Pick<Resident, "storey">, what: string): Rejection | null {
  if (standingStorey(me) === 0) return null;
  return refuse("ground_floor_only", `Go down to the ground floor to ${what}.`);
}

/**
 * `add_storey {px, py}`: from anywhere, on a plot you own or share, never the Commons, with coins
 * open. It takes `STOREYS.price` like a shop purchase (the treasury's share in, the rest burned)
 * and opens the next storey, empty until a floor goes down. A storey is never taken away or paid
 * back.
 */
export function checkAddStorey(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "add_storey" }>,
): Mutation | Rejection {
  const { config } = state;
  const { px, py } = command;
  if (!plotInBounds(config, px, py))
    return refuse("out_of_bounds", "That plot is outside the world.");
  if (isCommons(config, px, py)) {
    return refuse(
      "plot_is_commons",
      "The Commons stays on the ground. Add a storey to your own plot.",
    );
  }
  const plot = state.plots[plotKey(px, py)];
  if (!plot || !canBuildOn(plot, actor)) {
    return refuse("not_your_plot", "You can add a storey only to a plot you own or share.");
  }
  const econ = state.economy;
  const day = state.day;
  if (!econ || day === undefined) {
    return refuse("economy_closed", "A storey costs coins, and coins aren't open yet.");
  }
  const has = plot.storeys ?? 0;
  if (has >= STOREYS.max) return refuse("too_high", TOO_HIGH);
  const price = STOREYS.price;
  const purse = econ.coins[actor] ?? 0;
  if (purse < price) {
    const tip = allowanceDue(state, actor)
      ? "Today's allowance is waiting: send home first."
      : "Come home each day for your allowance.";
    return refuse(
      "not_enough_coins",
      `A storey is ${coinCount(price)}, and you have ${coinCount(purse)}. ${tip}`,
    );
  }
  const storey = has + 1;
  const at = { seq: state.seq + 1, day };
  const toTreasury = Math.floor((price * treasuryShareOf(state)) / 100);
  return () => {
    plot.storeys = storey;
    state.storeys ??= {};
    state.storeys[String(storey)] ??= { blocks: {}, ground: {} };
    const events: WorldEvent[] = [
      { type: "storey_added", px, py, storey, by: actor },
      movePurse(econ, actor, -price, "storey", at),
    ];
    // The treasury's history is public, so its share is a line that doesn't say who paid.
    if (toTreasury > 0) events.push(moveTreasury(econ, toTreasury, "storey", at));
    econ.burned += price - toTreasury;
    return events;
  };
}
