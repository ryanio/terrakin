import { refuse } from "./check";
import { plotKey, tileKey } from "./keys";
import type {
  BlockKind,
  Direction,
  Plot,
  Rejection,
  ResidentId,
  Tile,
  WorldConfig,
  WorldState,
} from "./types";

/** One step in each direction, as (dx, dy). North is up: y grows to the south. */
export const STEP: Record<Direction, [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
  ne: [1, -1],
  nw: [-1, -1],
  se: [1, 1],
  sw: [-1, 1],
};

export const DEFAULT_CONFIG: WorldConfig = {
  width: 72,
  height: 72,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/**
 * How far nearby chat travels, in tiles (Chebyshev distance). Chat isn't world state and never
 * enters the log, so this is a constant: tuning it never changes how logs replay.
 * See decision 0010.
 */
export const CHAT_EARSHOT = 12;

/** Whether `listener` hears nearby chat from `speaker`. Everyone hears themselves. */
export function withinEarshot(speaker: Tile, listener: Tile): boolean {
  return chebyshev(speaker, listener) <= CHAT_EARSHOT;
}

export function validateConfig(config: WorldConfig): void {
  const { width, height, plotSize, maxPlotsPerResident, reach } = config;
  for (const [name, value] of Object.entries({ width, height, plotSize, maxPlotsPerResident })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`WorldConfig.${name} must be a positive integer, got ${value}`);
    }
  }
  if (!Number.isInteger(reach) || reach < 0) {
    throw new Error(`WorldConfig.reach must be a non-negative integer, got ${reach}`);
  }
  const { townEligibleAfterDays: eligibleAfter } = config;
  if (eligibleAfter !== undefined && (!Number.isInteger(eligibleAfter) || eligibleAfter < 0)) {
    throw new Error(
      `WorldConfig.townEligibleAfterDays must be a non-negative integer, got ${eligibleAfter}`,
    );
  }
  if (width % plotSize !== 0 || height % plotSize !== 0) {
    throw new Error("WorldConfig width and height must be multiples of plotSize");
  }
}

export function createWorld(config: WorldConfig = DEFAULT_CONFIG): WorldState {
  validateConfig(config);
  return { config: { ...config }, seq: 0, residents: {}, plots: {}, blocks: {} };
}

export function inBounds(config: WorldConfig, x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < config.width &&
    y < config.height
  );
}

/** Plot coordinates containing a tile. */
export function plotOf(config: WorldConfig, x: number, y: number): { px: number; py: number } {
  return { px: Math.floor(x / config.plotSize), py: Math.floor(y / config.plotSize) };
}

/**
 * Downtown's own rectangle: the world as it was before any land opened ([RFC 0038](../../../docs/rfcs/0038-new-lands.md),
 * [decision 0326](../../../docs/knowledge/decisions/0326-an-island-is-a-region-of-the-same-plane-and-water-is-what-is.md)).
 *
 * The town's centre isn't stored anywhere: the Commons, the spawn tile, the hall, the shop and the
 * game tables are all worked out from the middle of the world. `open_land` grows the world, so
 * every one of them would move east the moment a land opened, onto water or onto someone's home.
 * So each of those reads this and never `state.config`. What is about the world as it is now
 * (`inBounds`, `plotOf`, `plotInBounds`, `plotCenter`) keeps reading the config, which is right:
 * an island's tiles are in the world.
 */
export function downtown(state: WorldState): WorldConfig {
  const home = state.lands?.home;
  return home ? { ...state.config, width: home.width, height: home.height } : state.config;
}

/** The Commons is downtown's center plot. It can never be claimed. */
export function commonsPlot(state: WorldState): { px: number; py: number } {
  const config = downtown(state);
  return {
    px: Math.floor(config.width / config.plotSize / 2),
    py: Math.floor(config.height / config.plotSize / 2),
  };
}

export function isCommons(state: WorldState, px: number, py: number): boolean {
  const c = commonsPlot(state);
  return c.px === px && c.py === py;
}

/** Where new residents appear: the middle of downtown. */
export function spawnTile(state: WorldState): Tile {
  const config = downtown(state);
  return { x: Math.floor(config.width / 2), y: Math.floor(config.height / 2) };
}

/**
 * A town square: the plot a hall and a counter stand on, and the column they stand on. Downtown's
 * is the Commons; every land that opens brings one of its own, so an island has somewhere to file a
 * proposal and somewhere to buy a seed without crossing the water (RFC 0038).
 */
export interface Square {
  px: number;
  py: number;
  /** The column the hall's door and the shop's counter stand on. */
  x: number;
}

/**
 * The tiles of each building in a list, grouped by the square it stands on, in the order they come.
 * `townHall` and `shop` carry every building of their kind once a land is open, so a view that
 * draws a box per building groups them with this first: boxing the whole list would draw one hall
 * stretched from downtown across the water (decision 0332).
 */
export function bySquare(config: WorldConfig, tiles: readonly Tile[]): Tile[][] {
  const groups = new Map<string, Tile[]>();
  for (const t of tiles) {
    const { px, py } = plotOf(config, t.x, t.y);
    const group = groups.get(plotKey(px, py));
    if (group) group.push(t);
    else groups.set(plotKey(px, py), [t]);
  }
  return [...groups.values()];
}

/**
 * The square **one** building's tiles stand on, read back from them, for a reader that has the
 * tiles and not the world: the snapshot carries them, so the web gets the square with no new field.
 * Hand it one building's tiles (`bySquare` groups a list into those), never a list of several: the
 * answer is a plot slot and a column, and tiles from two squares have neither in common.
 */
export function squareOf(config: WorldConfig, tiles: readonly Tile[]): Square | undefined {
  const first = tiles[0];
  if (!first) return undefined;
  const xs = tiles.map((t) => t.x);
  return {
    ...plotOf(config, first.x, first.y),
    x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
  };
}

/**
 * The Town Hall's front door on a square: on the square's own column, one row in from its north
 * edge. Clients draw the hall here, and tapping it opens the Town Hall page.
 */
export function hallDoor(config: WorldConfig, square: Square): Tile {
  return { x: square.x, y: square.py * config.plotSize + Math.min(1, config.plotSize - 1) };
}

/**
 * The tiles a Town Hall stands on: three wide, from the row above its door to the door's row,
 * clipped to its square. Nothing is ever built there, by residents or by the town. Once the
 * server logs `solid_buildings` nobody walks onto them either (`walk.ts`); before it residents
 * walked across, and logs from then replay that way.
 */
export function hallTiles(config: WorldConfig, square: Square): Tile[] {
  const door = hallDoor(config, square);
  return boxOn(config, square, door.x - 1, door.x + 1, door.y - 1, door.y);
}

/**
 * The shop's counter on a square (RFC 0008): on the square's middle column, one row in from its
 * south edge, facing the Town Hall across the square.
 */
export function counterDoor(config: WorldConfig, square: Square): Tile {
  const { plotSize } = config;
  const south = (square.py + 1) * plotSize - 1;
  return { x: square.x, y: Math.max(square.py * plotSize, south - 1) };
}

/**
 * The tiles a shop stands on: three wide, from its counter's row to the row below, clipped to its
 * square. Once the shop opens the town builds nothing there, and with `solid_buildings` nobody
 * walks onto it, like the Town Hall.
 */
export function counterTiles(config: WorldConfig, square: Square): Tile[] {
  const door = counterDoor(config, square);
  return boxOn(config, square, door.x - 1, door.x + 1, door.y, door.y + 1);
}

/** The tiles of a rectangle that are in the world and on `square`, west to east, north to south. */
function boxOn(
  config: WorldConfig,
  square: Square,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): Tile[] {
  const tiles: Tile[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = plotOf(config, x, y);
      if (inBounds(config, x, y) && p.px === square.px && p.py === square.py) tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * Every town square: downtown's Commons first, then each open land's, in the order they opened.
 *
 * Downtown's buildings stand on the spawn column, where they always have, so nothing about any
 * world's hall or shop moves for any of this. A land has no spawn tile of its own, so its buildings
 * stand on the middle of its square, which is the same tile the spawn column is wherever a square's
 * plot count is odd, downtown on the live world included.
 */
export function squares(state: WorldState): Square[] {
  const { plotSize } = state.config;
  const home = { ...commonsPlot(state), x: spawnTile(state).x };
  const lands = (state.lands?.list ?? []).map(({ square: [px, py] }) => ({
    px,
    py,
    x: px * plotSize + Math.floor(plotSize / 2),
  }));
  return [home, ...lands];
}

/**
 * Whether a plot slot is a town square: downtown's Commons, or a land's own. A square is never
 * claimable, because its hall and its counter stand on it, which is what `settleProblem` asks.
 */
export function isTownSquare(state: WorldState, px: number, py: number): boolean {
  return squares(state).some((s) => s.px === px && s.py === py);
}

/** Every Town Hall's tiles: one hall on each square. */
export function townHallTiles(state: WorldState): Tile[] {
  return squares(state).flatMap((square) => hallTiles(state.config, square));
}

/**
 * The Town Hall's door downtown, on the Commons. Every land brings a hall door of its own, and
 * which one a resident is sent to is `nearestHall` in `doors.ts` (RFC 0038).
 */
export function townHallTile(state: WorldState): Tile {
  return hallDoor(state.config, squares(state)[0] as Square);
}

/** Whether a tile is part of any Town Hall. */
export function isTownHallTile(state: WorldState, x: number, y: number): boolean {
  return townHallTiles(state).some((t) => t.x === x && t.y === y);
}

/** Every shop's tiles: one counter on each square. */
export function shopTiles(state: WorldState): Tile[] {
  return squares(state).flatMap((square) => counterTiles(state.config, square));
}

/**
 * The shop's counter downtown, where Clem serves. Every land brings a counter of its own, nobody
 * behind it, and which one a resident is sent to is `nearestCounter` in `doors.ts` (RFC 0038).
 */
export function shopTile(state: WorldState): Tile {
  return counterDoor(state.config, squares(state)[0] as Square);
}

/** Whether a tile is part of any shop. */
export function isShopTile(state: WorldState, x: number, y: number): boolean {
  return shopTiles(state).some((t) => t.x === x && t.y === y);
}

/**
 * Where game tables stand (RFC 0011): four spots in the Commons, two on each side of the square
 * between the Town Hall and the shop, clear of both and of the spawn tile. They don't stop
 * walkers. A new table takes the first free spot, and once the server logs `keep_table_spots` a
 * Town Hall build puts no block on one (decision 0126), so from then on moving a spot changes how
 * logged builds replay: `town.test.ts` pins them. Downtown only: the tables are the Commons' own,
 * like its green.
 */
export function gameTableTiles(state: WorldState): Tile[] {
  const { plotSize } = state.config;
  const c = commonsPlot(state);
  const x0 = c.px * plotSize;
  const y0 = c.py * plotSize;
  const spawn = spawnTile(state);
  const tiles: Tile[] = [];
  for (const dy of [2, plotSize - 3]) {
    for (const dx of [1, plotSize - 2]) {
      const t = { x: x0 + dx, y: y0 + dy };
      const p = plotOf(state.config, t.x, t.y);
      if (!inBounds(state.config, t.x, t.y) || p.px !== c.px || p.py !== c.py) continue;
      if (isTownHallTile(state, t.x, t.y) || isShopTile(state, t.x, t.y)) continue;
      if ((t.x === spawn.x && t.y === spawn.y) || tiles.some((o) => o.x === t.x && o.y === t.y))
        continue;
      tiles.push(t);
    }
  }
  return tiles;
}

export function plotAtTile(state: WorldState, x: number, y: number): Plot | undefined {
  const { px, py } = plotOf(state.config, x, y);
  return state.plots[plotKey(px, py)];
}

export function plotsOwnedBy(state: WorldState, residentId: ResidentId): Plot[] {
  return Object.values(state.plots).filter((p) => p.ownerId === residentId);
}

/**
 * The plot a resident calls home: the one their hearth is on, else the first they own, else the
 * first shared with them, each north to south, then west to east. Undefined when they live on none.
 */
export function homePlotOf(state: WorldState, residentId: ResidentId): Plot | undefined {
  const plots = Object.values(state.plots)
    .filter((p) => canBuildOn(p, residentId))
    .sort((a, b) => a.py - b.py || a.px - b.px);
  const hearth = Object.hasOwn(state.residents, residentId)
    ? state.residents[residentId]?.hearth
    : undefined;
  if (hearth) {
    const at = plotOf(state.config, hearth.x, hearth.y);
    const there = plots.find((p) => p.px === at.px && p.py === at.py);
    if (there) return there;
  }
  return plots.find((p) => p.ownerId === residentId) ?? plots[0];
}

/** Whether a resident may build on a plot: its owner, or someone the owner shared it with. */
export function canBuildOn(
  plot: Pick<Plot, "ownerId" | "coOwners"> | undefined,
  residentId: ResidentId,
): boolean {
  if (!plot) return false;
  return plot.ownerId === residentId || (plot.coOwners?.includes(residentId) ?? false);
}

/** Whether plot coordinates name a plot inside the world. */
export function plotInBounds(config: WorldConfig, px: number, py: number): boolean {
  return (
    Number.isInteger(px) &&
    Number.isInteger(py) &&
    px >= 0 &&
    py >= 0 &&
    px < config.width / config.plotSize &&
    py < config.height / config.plotSize
  );
}

/** Why `settle` turns a plot down. */
export type SettleProblem =
  | "out_of_bounds"
  | "plot_is_water"
  | "plot_is_square"
  | "plot_owned"
  | "plot_limit";

/**
 * Why `settle` would turn down plot (px, py), in the order it checks, or undefined when it would
 * take it: the plot is outside the world, is open water, is a town square, is already someone's,
 * or the resident already owns a plot (settle is only for a first one). `settle` checks with it,
 * and the web's plot picker lists only the plots it passes (decision 0052).
 *
 * `config` is the world as it is now, since an island's slots are in the world; whether a slot is
 * a square is a fact the caller brings, because the answer depends on downtown's own rectangle and
 * on which lands are open (RFC 0038). It's required rather than optional so that a reader which
 * forgets it is a type error rather than a plot picker offering the Town Hall's ground.
 */
export function settleProblem(
  config: WorldConfig,
  px: number,
  py: number,
  facts: {
    claimed: boolean;
    ownsAPlot: boolean;
    /** Whether the slot is a town square: downtown's Commons, or a land's own (`isTownSquare`). */
    square: boolean;
    /**
     * Whether the slot is on land at all (RFC 0038). Left out means yes, which is every slot in a
     * world that never opened a land, so such a world answers exactly as it did.
     */
    onLand?: boolean;
  },
): SettleProblem | undefined {
  if (!plotInBounds(config, px, py)) return "out_of_bounds";
  if (facts.onLand === false) return "plot_is_water";
  if (facts.square) return "plot_is_square";
  if (facts.claimed) return "plot_owned";
  if (facts.ownsAPlot) return "plot_limit";
  return undefined;
}

/**
 * How far a tile is from plot (px, py), in tiles, counted like reach (Chebyshev): 0 on the plot,
 * 1 on a tile beside it (a corner's diagonal neighbor too), and so on.
 */
export function plotDistance(config: WorldConfig, tile: Tile, px: number, py: number): number {
  const size = config.plotSize;
  const dx = Math.max(px * size - tile.x, 0, tile.x - (px * size + size - 1));
  const dy = Math.max(py * size - tile.y, 0, tile.y - (py * size + size - 1));
  return Math.max(dx, dy);
}

/**
 * The center tile of a plot. On an even plot size it's the north-west of the middle four. With the
 * default plot size of 8 that is also where the starter home puts its hearth.
 */
export function plotCenter(config: WorldConfig, px: number, py: number): Tile {
  const half = Math.floor((config.plotSize - 1) / 2);
  return { x: px * config.plotSize + half, y: py * config.plotSize + half };
}

/**
 * The SKILL.md starter hut on plot (px, py): the outline of the 5x5 square from (x0, y0) to
 * (x0 + 4, y0 + 4), where x0 = px * plotSize + 1 and y0 = py * plotSize + 1, with a doorway at
 * (x0 + 2, y0 + 4) and windows at (x0, y0 + 2) and (x0 + 4, y0 + 2). Fifteen blocks, west to east
 * then north to south within each column. The hearth goes at (x0 + 2, y0 + 2). On plots smaller
 * than 6 tiles some of these tiles fall off the plot; callers skip those.
 */
export function starterHome(
  config: WorldConfig,
  px: number,
  py: number,
  walls: BlockKind,
  windows: BlockKind,
): { blocks: (Tile & { block: BlockKind })[]; hearth: Tile } {
  const x0 = px * config.plotSize + 1;
  const y0 = py * config.plotSize + 1;
  const blocks: (Tile & { block: BlockKind })[] = [];
  for (let x = x0; x <= x0 + 4; x++) {
    for (let y = y0; y <= y0 + 4; y++) {
      const edge = x === x0 || x === x0 + 4 || y === y0 || y === y0 + 4;
      const door = x === x0 + 2 && y === y0 + 4;
      const window = (x === x0 || x === x0 + 4) && y === y0 + 2;
      if (edge && !door) blocks.push({ x, y, block: window ? windows : walls });
    }
  }
  return { blocks, hearth: { x: x0 + 2, y: y0 + 2 } };
}

/**
 * Tiles inside the starter hut where a planter can go without blocking the way in: the corners,
 * then beside and behind the hearth, never the tile between the hearth and the doorway. Empty when
 * the hearth isn't where `starterHome` puts it, since then there's no hut layout to go by.
 */
export function starterHutGardenTiles(config: WorldConfig, hearth: Tile): Tile[] {
  const { px, py } = plotOf(config, hearth.x, hearth.y);
  const home = starterHome(config, px, py, "wood", "glass").hearth;
  if (home.x !== hearth.x || home.y !== hearth.y) return [];
  const offsets = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [-1, 0],
    [1, 0],
    [0, -1],
  ] as const;
  return offsets.map(([dx, dy]) => ({ x: hearth.x + dx, y: hearth.y + dy }));
}

/** Whether a block on the ground floor stops walkers there. Stairs are walked onto (RFC 0028). */
export function isSolid(state: WorldState, x: number, y: number): boolean {
  return blocksWalkers(state.blocks[tileKey(x, y)]);
}

/** Whether a block stops a walker on its tile. Stairs are the one block anyone walks onto (RFC 0028). */
export const blocksWalkers = (block: BlockKind | undefined): boolean =>
  block !== undefined && block !== "stairs";

export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/**
 * The walk that brings `target` within `reach` of `me`: east or west, then north or south, each
 * leg with its steps. Empty when it's already within reach.
 */
export function walkLegs(me: Tile, target: Tile, reach: number): ["e" | "w" | "n" | "s", number][] {
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const legs: ["e" | "w" | "n" | "s", number][] = [];
  const across = Math.abs(dx) - reach;
  const down = Math.abs(dy) - reach;
  if (across > 0) legs.push([dx > 0 ? "e" : "w", across]);
  if (down > 0) legs.push([dy > 0 ? "s" : "n", down]);
  return legs;
}

/**
 * `walkLegs` as move calls for a refusal to end with:
 * " Walk closer first: move e 3 times, then move n once." Empty when it's already within reach.
 */
export function walkHint(me: Tile, target: Tile, reach: number): string {
  const steps = walkLegs(me, target, reach).map(([dir, n]) => `move ${dir} ${times(n)}`);
  return steps.length ? ` Walk closer first: ${steps.join(", then ")}.` : "";
}

/**
 * Why `target` is out of `me`'s reach, or null when it's within `reach` tiles: `out_of_reach`,
 * saying `say` and then the walk that brings it within reach.
 */
export function outOfReach(
  me: Tile,
  target: Tile,
  reach: number,
  say = `That's more than ${reach} tiles away.`,
  /**
   * The walk, already in words, for a caller that can plan one around what's in the way. The
   * default hint is a straight line, which is right for a tile in front of you and wrong for a
   * walk across town, where a wall between the two makes it point nowhere.
   */
  hint?: string,
): Rejection | null {
  if (chebyshev(me, target) <= reach) return null;
  return refuse("out_of_reach", `${say}${hint ?? walkHint(me, target, reach)}`);
}

/** Deep copy. WorldState is plain JSON data by design, so a JSON round trip is exact. */
export function cloneWorld(state: WorldState): WorldState {
  return JSON.parse(JSON.stringify(state)) as WorldState;
}
