import { coinCount, isWhole, refuse } from "./check";
import { allowanceDue, movePurse, moveTreasury } from "./economy";
import type { GroundKind } from "./ground";
import { plotKey, tileKey } from "./keys";
import { own } from "./own";
import { treasuryShareOf } from "./shop";
import type {
  BlockKind,
  Command,
  Plot,
  Rejection,
  ResidentId,
  StoreyLayer,
  WorldEvent,
  WorldState,
} from "./types";
import { canBuildOn, inBounds, isCommons, plotInBounds, plotOf } from "./world";

/**
 * Homes with storeys (RFC 0028). The ground floor is storey 0 and stays where it always was, in
 * `state.blocks` and `state.ground`. Each storey above it is a layer of its own in
 * `state.storeys`, keyed by its number, absent until a plot first adds it, so every world from
 * before storeys hashes as it did. A plot's `storeys` says how many it added.
 *
 * Readers that mean "the ground floor" keep reading `state.blocks`. Readers that mean "any storey"
 * go through `blocksOn` and `groundOn`, so nothing else reaches into `state.storeys` by hand. A
 * storey from an input is checked as a whole number in range (`storeyProblem`) before it becomes a
 * key.
 */

/** Every number about storeys in one place. RFC 0028 has the reasoning. */
export const STOREYS = {
  /** Storeys a plot may add above its ground floor. May go up later, never down. */
  max: 1,
  /** Coins `add_storey` takes, split like a shop purchase: the treasury's share, the rest burned. */
  price: 80,
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

/** Whether a block stands on a tile of a storey. */
export function solidAt(state: WorldState, x: number, y: number, storey: number): boolean {
  return blocksOn(state, storey)[tileKey(x, y)] !== undefined;
}

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
 * Whether a floor at (x, y) on `storey` (1 and up) is held up: a wall or window on the storey
 * below, within `STOREYS.span` tiles, on the same plot. `without` is a tile on the storey below
 * about to lose its block.
 */
function floorHeld(state: WorldState, x: number, y: number, storey: number, without?: string) {
  const { config } = state;
  const below = blocksOn(state, storey - 1);
  const home = plotOf(config, x, y);
  const { span } = STOREYS;
  for (let ty = y - span; ty <= y + span; ty++) {
    for (let tx = x - span; tx <= x + span; tx++) {
      if (!inBounds(config, tx, ty)) continue;
      const p = plotOf(config, tx, ty);
      if (p.px !== home.px || p.py !== home.py) continue;
      const key = tileKey(tx, ty);
      if (key !== without && holds(below[key])) return true;
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
): Rejection | null {
  if (storey === 0 || floorHeld(state, x, y, storey)) return null;
  return refuse(
    "nothing_under",
    `Nothing holds that floor up. Build walls under it first, within ${STOREYS.span} tiles.`,
  );
}

/**
 * Why `block` can't go on (x, y) on `storey`, or null: it stays on the ground floor, or nothing
 * holds it up (a floor on its own tile, or a wall or window right under it).
 */
export function blockProblem(
  state: WorldState,
  x: number,
  y: number,
  storey: number,
  block: BlockKind,
): Rejection | null {
  if (storey === 0) return null;
  const only = GROUND_FLOOR_ONLY[block];
  if (only) return refuse("ground_floor_only", `${only} stay on the ground floor.`);
  const key = tileKey(x, y);
  if (groundOn(state, storey)[key] !== undefined) return null;
  if (holds(blocksOn(state, storey - 1)[key])) return null;
  return refuse(
    "nothing_under",
    "Nothing holds that up. Lay a floor there first, or build a wall right under it.",
  );
}

/**
 * Why the block at (x, y) on `storey` can't be taken away, or null: it's a wall that is all that
 * holds up a block right above it with no floor of its own, or the last wall within reach of a
 * floor above.
 */
export function removeProblem(
  state: WorldState,
  x: number,
  y: number,
  storey: number,
): Rejection | null {
  const key = tileKey(x, y);
  const above = storey + 1;
  if (above > STOREYS.max || !holds(blocksOn(state, storey)[key])) return null;
  if (blocksOn(state, above)[key] !== undefined && groundOn(state, above)[key] === undefined) {
    return refuse("holds_up", "That wall holds up the block above it. Take that away first.");
  }
  const { config } = state;
  const home = plotOf(config, x, y);
  const { span } = STOREYS;
  const floors = groundOn(state, above);
  for (let ty = y - span; ty <= y + span; ty++) {
    for (let tx = x - span; tx <= x + span; tx++) {
      if (!inBounds(config, tx, ty)) continue;
      const p = plotOf(config, tx, ty);
      if (p.px !== home.px || p.py !== home.py) continue;
      if (floors[tileKey(tx, ty)] === undefined) continue;
      if (!floorHeld(state, tx, ty, above, key)) {
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
 * Why the floor at (x, y) on `storey` can't be lifted, or null: a block stands on it with no wall
 * right under it. Floors on the ground floor hold nothing up.
 */
export function liftProblem(
  state: WorldState,
  x: number,
  y: number,
  storey: number,
): Rejection | null {
  if (storey === 0) return null;
  const key = tileKey(x, y);
  if (blocksOn(state, storey)[key] !== undefined && !holds(blocksOn(state, storey - 1)[key])) {
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
