import { fnv1a } from "./hash";
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
  const roll = parseInt(fnv1a(`terrakin-biome|${rx}|${ry}`).slice(0, 4), 16) / 0xffff;
  if (roll < 0.34) return "meadow";
  if (roll < 0.62) return "forest";
  if (roll < 0.84) return "stone";
  return "sand";
}
