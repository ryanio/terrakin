import { plotKey, tileKey } from "./keys";
import type { BlockKind, Plot, ResidentId, Tile, WorldConfig, WorldState } from "./types";

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

export function plotAtTile(state: WorldState, x: number, y: number): Plot | undefined {
  const { px, py } = plotOf(state.config, x, y);
  return state.plots[plotKey(px, py)];
}

export function plotsOwnedBy(state: WorldState, residentId: ResidentId): Plot[] {
  return Object.values(state.plots).filter((p) => p.ownerId === residentId);
}

/** Whether a resident may build on a plot: its owner, or someone the owner shared it with. */
export function canBuildOn(plot: Plot | undefined, residentId: ResidentId): boolean {
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

export function isSolid(state: WorldState, x: number, y: number): boolean {
  return state.blocks[tileKey(x, y)] !== undefined;
}

export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Deep copy. WorldState is plain JSON data by design, so a JSON round trip is exact. */
export function cloneWorld(state: WorldState): WorldState {
  return JSON.parse(JSON.stringify(state)) as WorldState;
}
