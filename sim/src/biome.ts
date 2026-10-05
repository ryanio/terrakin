import type { WorldConfig } from "./types";

/**
 * The ground biomes. A biome is a pure function of position: it is never world state, never
 * enters the input log, and never affects replay. Same coordinates, same biome, on every client
 * and on every replay of every log.
 *
 * `config` is taken so a future world seed can key the map. Today the map is fixed by
 * coordinates alone, which keeps phase 1 honest: scenery that can't desync.
 */
export type Biome = "meadow" | "forest" | "stone" | "sand";

/**
 * Tiles per side of a biome region. Bigger than a tile, so the world reads as broad organic
 * patches instead of per-tile confetti; smaller than a plot, so the plot grid stays the legible
 * unit of the world.
 */
export const BIOME_REGION = 4;

/** The biome at tile (x, y), hashed per region so neighbors usually share it. */
export function biomeAt(config: WorldConfig, x: number, y: number): Biome {
  void config;
  const rx = Math.floor(x / BIOME_REGION);
  const ry = Math.floor(y / BIOME_REGION);
  // Mix the two integers with a finalizer, so neighboring regions are independent both across and
  // down (hashing a string like `rx|ry` left the map in vertical stripes).
  let h = (Math.imul(rx, 374761393) + Math.imul(ry, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const roll = ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
  if (roll < 0.34) return "meadow";
  if (roll < 0.62) return "forest";
  if (roll < 0.84) return "stone";
  return "sand";
}
