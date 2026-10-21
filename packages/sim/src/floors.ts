import { coinCount, isWhole, refuse } from "./check";
import { allowanceDue, movePurse, moveTreasury, treasuryShareOf } from "./economy";
import type { GroundKind } from "./ground";
import { plotKey, tileKey } from "./keys";
import { own } from "./own";
import { plotListedProblem } from "./plot-market";
import {
  type BlockKind,
  type Climb,
  type Command,
  type FloorLayer,
  MATERIAL_BLOCKS,
  type Plot,
  type Rejection,
  type Resident,
  type ResidentId,
  type Tile,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { type Ground, walkWords, worldGround } from "./walk";
import {
  blocksWalkers,
  canBuildOn,
  chebyshev,
  inBounds,
  isCommons,
  plotAtTile,
  plotInBounds,
  plotOf,
} from "./world";

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

/**
 * The blocks that hold up what's above them: walls and windows, the free ones and the made
 * materials of RFC 0041 alike. A hedge holds nothing up. A roof sits on the same ones
 * (`holdsRoof` in `roofs.ts`).
 */
export const HOLDING_BLOCKS: readonly BlockKind[] = ["wood", "stone", "glass", ...MATERIAL_BLOCKS];

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

/** The upstairs to add, with the plot to add it to when the refusal has one in hand. */
const noFloor = (plot?: Plot) => {
  const where = plot ? ` at px ${plot.px}, py ${plot.py}` : "";
  return `This plot has no upstairs yet. add_floor${where} adds it for ${coinCount(FLOORS.price)}.`;
};

/** A tile in a refusal's words, as the rest of the sim names one. */
const tileWords = (x: number, y: number) => `x ${x}, y ${y}`;

/**
 * Where the stairs are and the walk onto them, around whatever is in the way on that floor. The
 * walk is left out when none gets there, which a loft with no flooring between the two leaves.
 */
function standOn(state: WorldState, me: Resident, stairs: Tile, floor: number): string {
  const walk = walkWords(state, me, stairs, 0, floorGround(state, floor));
  return `${tileWords(stairs.x, stairs.y)}.${walk ? ` Walk there first: ${walk}.` : ""}`;
}

/** The walls that hold up what's above them, for a refusal that has to say which. */
const HOLDING_WORDS = "wood, stone, glass, or a material you made";

/** The free flooring, as `design.ts` says it in a note. */
const FREE_FLOORING = "Dirt, sand, moss, and fallen leaves cost nothing.";

/** Every tile of a plot, nearest `me` first, so a hint names the one closest to hand. */
function plotTilesNear(state: WorldState, plot: Plot, me: Tile): Tile[] {
  const { plotSize } = state.config;
  const tiles: Tile[] = [];
  for (let y = plot.py * plotSize; y < (plot.py + 1) * plotSize; y++) {
    for (let x = plot.px * plotSize; x < (plot.px + 1) * plotSize; x++) tiles.push({ x, y });
  }
  return tiles.sort((a, b) => chebyshev(me, a) - chebyshev(me, b));
}

/** Whether anyone's hearth is on (x, y). Nobody builds on a hearth, so no hint names one. */
const hearthAt = (state: WorldState, x: number, y: number) =>
  Object.values(state.residents).some((r) => r.hearth?.x === x && r.hearth.y === y);

/** The staircase on `plot` that climbs from `floor`, nearest `me`, if there is one. */
function stairsOn(state: WorldState, me: Tile, plot: Plot, floor: number): Tile | undefined {
  const blocks = blocksOn(state, floor);
  return plotTilesNear(state, plot, me).find((t) => blocks[tileKey(t.x, t.y)] === "stairs");
}

/**
 * A tile of `plot` where a staircase up from `floor` would stand as things are, nearest `me`:
 * nothing on it, nothing on the stairwell above it, and no hearth or feet in the way.
 */
function stairsSpot(
  state: WorldState,
  me: Tile,
  plot: Plot,
  floor: number,
  /** Keep to build reach, so the call named isn't refused `out_of_reach` in its turn. */
  inReach = true,
): Tile | undefined {
  const blocks = blocksOn(state, floor);
  const above = floor + 1;
  // A floor counts as one tile of reach, as `outOfFloorReach` has it, since the stairwell is up
  // there. With `inReach` off this is every tile of the plot, for naming one to walk to.
  const all = plotTilesNear(state, plot, me);
  const near = inReach ? all.filter((t) => chebyshev(me, t) + 1 <= state.config.reach) : all;
  return near.find(({ x, y }) => {
    const key = tileKey(x, y);
    if (blocks[key] !== undefined) return false;
    if (blocksOn(state, above)[key] !== undefined || groundOn(state, above)[key] !== undefined) {
      return false;
    }
    if (floor === 0 && hearthAt(state, x, y)) return false;
    return !someoneOn(state, x, y, floor);
  });
}

/**
 * How to get up from where `me` stands, for `no_stairs`: the stairs on this plot and the walk to
 * them, else the call that builds a staircase, else the floor to add before one can go up. Empty
 * where `me` can't build here, since nothing it named would work.
 */
function upHint(state: WorldState, me: Resident): string {
  const floor = standingFloor(me);
  if (floor + 1 > FLOORS.max) return ` ${TOO_HIGH}`;
  const plot = plotAtTile(state, me.x, me.y);
  // Anyone may climb anyone's stairs, so where they are is said on any plot. Only the calls that
  // build wait on building rights, which is all they would be good for.
  const stairs = plot && stairsOn(state, me, plot, floor);
  if (stairs) return ` The stairs on this plot are at ${standOn(state, me, stairs, floor)}`;
  if (!plot || !canBuildOn(plot, me.id)) return "";
  if ((plot.floors ?? 0) <= floor) return ` ${noFloor(plot)} Stairs go up to it once it's there.`;
  const spot = stairsSpot(state, me, plot, floor);
  if (!spot) {
    // `stairsSpot` only looks within build reach, so "the plot is full" is usually wrong: the
    // room is there, a few tiles off. Name a tile further out and the walk to it when one
    // qualifies, so a reader walks rather than stops.
    const far = stairsSpot(state, me, plot, floor, false);
    if (far) {
      const walk = walkWords(state, me, far, state.config.reach - 1, floorGround(state, floor));
      return walk === ""
        ? ` Nowhere within reach can take a staircase. There's room at ${tileWords(far.x, far.y)}, with no walk to it from here.`
        : ` Nowhere within reach can take a staircase. There's room at ${tileWords(far.x, far.y)}: walk there (${walk}), then place ${tileWords(far.x, far.y)}, block stairs, for ${FLOORS.stairsWood} wood.`;
    }
    return " A staircase needs the tile above it clear, and every tile here has something on it.";
  }
  return ` This plot has none yet: place ${tileWords(spot.x, spot.y)}, block stairs puts a flight up from here, for ${FLOORS.stairsWood} wood. The tile above a staircase stays clear.`;
}

/** Where the way down is, for `no_stairs` on the way down: the stairs under this floor. */
function downHint(state: WorldState, me: Resident): string {
  const floor = standingFloor(me);
  const plot = plotAtTile(state, me.x, me.y);
  if (!plot) return "";
  const stairs = stairsOn(state, me, plot, floor - 1);
  return stairs ? ` The way down is at ${standOn(state, me, stairs, floor)}` : "";
}

/**
 * What to do about the tile upstairs a walk can't step onto, for `blocked`: the call that lays
 * flooring there, or the wall that has to hold it up first. Empty on a plot `me` can't build on,
 * where neither would work.
 */
export function noFlooringHint(state: WorldState, me: Resident, tile: Tile, floor: number): string {
  const plot = plotAtTile(state, tile.x, tile.y);
  if (!plot || !canBuildOn(plot, me.id)) return "";
  // The tile aimed at can be on the next plot along, which may have no floor up here. `lay`
  // checks that (`floorOf`) and would refuse, and the refusal it leads to names an `add_floor`
  // that spends 200 coins adding an upstairs to that other plot. Say nothing instead: the plain
  // "There's no flooring there." is true, and nothing here would help.
  if ((plot.floors ?? 0) < floor) return "";
  if (flooringProblem(state, tile.x, tile.y, floor)) {
    return ` Nothing holds flooring up there: put a wall on the floor below first, within ${FLOORS.span} tiles (${HOLDING_WORDS}).`;
  }
  return ` Lay some first: lay ${tileWords(tile.x, tile.y)}, floor ${floor}, ground dirt. ${FREE_FLOORING}`;
}

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
  if ((plot?.floors ?? 0) < floor) return refuse("no_floor", noFloor(plot));
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
    `Nothing holds that flooring up. Put a wall on the floor below first, within ${FLOORS.span} tiles (${HOLDING_WORDS}).`,
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
  return refuse("tile_occupied", "Stairs come up here. Keep it clear, and build round it.");
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
    if ((plot?.floors ?? 0) < above) return refuse("no_floor", noFloor(plot));
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
    // The stairwell, the tile a staircase comes up through, so the refusal names the call that
    // clears it: a loft floored first refuses stairs on every tile, and this is the way out.
    if (view.block(above, key) !== undefined) {
      return refuse(
        "tile_occupied",
        `Stairs come up through ${tileWords(x, y)} on floor ${above}, and a block is there. Take it away first: remove ${tileWords(x, y)}, floor ${above}.`,
      );
    }
    if (view.ground(above, key) !== undefined) {
      return refuse(
        "tile_occupied",
        `Stairs come up through ${tileWords(x, y)} on floor ${above}, and flooring is there. Lift it first: lift ${tileWords(x, y)}, floor ${above}. That tile stays clear, so stairs go in before the flooring round them.`,
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
    `Nothing holds that up. Lay flooring there first (lay ${tileWords(x, y)}, floor ${floor}), or put a wall right under it.`,
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
    if (dir === "down" && from === 0) {
      return refuse("no_stairs", "You're on the ground floor already.");
    }
    return dir === "up"
      ? refuse("no_stairs", `Stand on stairs to go up.${upHint(state, me)}`)
      : refuse("no_stairs", `Stand at the top of the stairs to go down.${downHint(state, me)}`);
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
  if (isCommons(state, px, py)) {
    return refuse(
      "plot_is_commons",
      "The Commons stays on the ground. Add an upstairs to your own plot.",
    );
  }
  const plot = state.plots[plotKey(px, py)];
  if (!plot || !canBuildOn(plot, actor)) {
    return refuse("not_your_plot", "You can add an upstairs only to a plot you own or share.");
  }
  const listed = plotListedProblem(state, plot.px, plot.py);
  if (listed) return listed;
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
