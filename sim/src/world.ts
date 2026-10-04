import { plotKey, tileKey } from "./keys";
import type { Plot, ResidentId, Tile, WorldConfig, WorldState } from "./types";

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
