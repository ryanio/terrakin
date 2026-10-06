import { plotKey, tileKey } from "./keys";
import type {
  BlockKind,
  Direction,
  Plot,
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

/** The Commons is the center plot. It can never be claimed. */
export function commonsPlot(config: WorldConfig): { px: number; py: number } {
  return {
    px: Math.floor(config.width / config.plotSize / 2),
    py: Math.floor(config.height / config.plotSize / 2),
  };
}

export function isCommons(config: WorldConfig, px: number, py: number): boolean {
  const c = commonsPlot(config);
  return c.px === px && c.py === py;
}

/** Where new residents appear: the middle of the Commons. */
export function spawnTile(config: WorldConfig): Tile {
  return { x: Math.floor(config.width / 2), y: Math.floor(config.height / 2) };
}

/**
 * The Town Hall's front door: on the spawn column, one row in from the Commons' north edge.
 * Clients draw the hall here, and tapping it opens the Town Hall page.
 */
export function townHallTile(config: WorldConfig): Tile {
  const { py } = commonsPlot(config);
  return { x: spawnTile(config).x, y: py * config.plotSize + Math.min(1, config.plotSize - 1) };
}

/**
 * The tiles the Town Hall stands on: three wide, from the row above its door to the door's row,
 * clipped to the Commons. Nothing is ever built there, by residents or by the town. Once the
 * server logs `solid_buildings` nobody walks onto them either (`walk.ts`); before it residents
 * walked across, and logs from then replay that way.
 */
export function townHallTiles(config: WorldConfig): Tile[] {
  const door = townHallTile(config);
  const c = commonsPlot(config);
  const tiles: Tile[] = [];
  for (let y = door.y - 1; y <= door.y; y++) {
    for (let x = door.x - 1; x <= door.x + 1; x++) {
      const p = plotOf(config, x, y);
      if (inBounds(config, x, y) && p.px === c.px && p.py === c.py) tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Whether a tile is part of the Town Hall. */
export function isTownHallTile(config: WorldConfig, x: number, y: number): boolean {
  return townHallTiles(config).some((t) => t.x === x && t.y === y);
}

/**
 * The town shop's front door (RFC 0008): on the spawn column, one row in from the Commons' south
 * edge, facing the Town Hall across the square. Clients draw the shop here, and tapping it opens
 * the shop.
 */
export function shopTile(config: WorldConfig): Tile {
  const { py } = commonsPlot(config);
  const south = (py + 1) * config.plotSize - 1;
  return { x: spawnTile(config).x, y: Math.max(py * config.plotSize, south - 1) };
}

/**
 * The tiles the shop stands on: three wide, from its door's row to the row below, clipped to the
 * Commons. Once the shop opens the town builds nothing there, and with `solid_buildings` nobody
 * walks onto it, like the Town Hall.
 */
export function shopTiles(config: WorldConfig): Tile[] {
  const door = shopTile(config);
  const c = commonsPlot(config);
  const tiles: Tile[] = [];
  for (let y = door.y; y <= door.y + 1; y++) {
    for (let x = door.x - 1; x <= door.x + 1; x++) {
      const p = plotOf(config, x, y);
      if (inBounds(config, x, y) && p.px === c.px && p.py === c.py) tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Whether a tile is part of the shop. */
export function isShopTile(config: WorldConfig, x: number, y: number): boolean {
  return shopTiles(config).some((t) => t.x === x && t.y === y);
}

/**
 * Where game tables stand (RFC 0011): four spots in the Commons, two on each side of the square
 * between the Town Hall and the shop, clear of both and of the spawn tile. They don't stop
 * walkers. A new table takes the first free spot, and once the server logs `keep_table_spots` a
 * Town Hall build puts no block on one (decision 0126), so from then on moving a spot changes how
 * logged builds replay: `town.test.ts` pins them.
 */
export function gameTableTiles(config: WorldConfig): Tile[] {
  const { plotSize } = config;
  const c = commonsPlot(config);
  const x0 = c.px * plotSize;
  const y0 = c.py * plotSize;
  const spawn = spawnTile(config);
  const tiles: Tile[] = [];
  for (const dy of [2, plotSize - 3]) {
    for (const dx of [1, plotSize - 2]) {
      const t = { x: x0 + dx, y: y0 + dy };
      const p = plotOf(config, t.x, t.y);
      if (!inBounds(config, t.x, t.y) || p.px !== c.px || p.py !== c.py) continue;
      if (isTownHallTile(config, t.x, t.y) || isShopTile(config, t.x, t.y)) continue;
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

export function isSolid(state: WorldState, x: number, y: number): boolean {
  return state.blocks[tileKey(x, y)] !== undefined;
}

export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/**
 * The walk that brings `target` within `reach` of `me`, as move calls for a refusal to end with:
 * " Walk closer first: move e 3 times, then move n once." Empty when it's already within reach.
 */
export function walkHint(me: Tile, target: Tile, reach: number): string {
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const steps: string[] = [];
  const across = Math.abs(dx) - reach;
  const down = Math.abs(dy) - reach;
  if (across > 0) steps.push(`move ${dx > 0 ? "e" : "w"} ${times(across)}`);
  if (down > 0) steps.push(`move ${dy > 0 ? "s" : "n"} ${times(down)}`);
  return steps.length ? ` Walk closer first: ${steps.join(", then ")}.` : "";
}

/** Deep copy. WorldState is plain JSON data by design, so a JSON round trip is exact. */
export function cloneWorld(state: WorldState): WorldState {
  return JSON.parse(JSON.stringify(state)) as WorldState;
}
