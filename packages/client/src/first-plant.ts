/**
 * A first seed in one tap, for the world's next-step chip: where it goes and which seed, worked
 * out from what the world already shows. It goes in an empty planter of yours within reach of
 * your hearth, or else in a new planter inside the starter hut, on the tiles the sim keeps clear
 * of the way in (`starterHutGardenTiles`), as the garden link does for agents. The seed is the
 * one held that grows soonest. Pure and tested; the server checks every action it leads to.
 */
import {
  CROP_INFO,
  CROPS,
  type Crop,
  starterHutGardenTiles,
  type WorldConfig,
} from "@terrakin/sim";
import { aThing } from "./things";

interface Tile {
  x: number;
  y: number;
}

export interface PlantView {
  config: WorldConfig;
  hearth: Tile;
  /** Blocks on the ground floor, by `x,y`. */
  blocks: ReadonlyMap<string, string>;
  /** What grows in planters, by `x,y`. */
  crops: ReadonlyMap<string, unknown>;
  /** Whether a tile is on a plot you can build on (the sim's `canBuildOn`). */
  mine: (t: Tile) => boolean;
  /** Whether someone online stands on a tile, so nothing can be placed there. */
  standing: (t: Tile) => boolean;
  /** How many of each kind you hold. */
  held: (kind: string) => number;
}

export type PlantPlan =
  | { tile: Tile; place: boolean; crop: Crop }
  | { problem: "no_seeds" | "no_room" };

const key = (t: Tile) => `${t.x},${t.y}`;

/** The crop to plant: of the seeds you hold, the one that's ready soonest, in catalog order on a tie. */
export function soonestCrop(held: (kind: string) => number): Crop | undefined {
  let best: Crop | undefined;
  for (const crop of CROPS) {
    const info = CROP_INFO[crop];
    if (held(info.seed) < 1) continue;
    if (!best || info.days < CROP_INFO[best].days) best = crop;
  }
  return best;
}

/** Where and what to plant first, or why it can't be done in one tap. */
export function planFirstPlanting(v: PlantView): PlantPlan {
  const crop = soonestCrop(v.held);
  if (!crop) return { problem: "no_seeds" };
  const reach = v.config.reach;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const t = { x: v.hearth.x + dx, y: v.hearth.y + dy };
      if (v.mine(t) && v.blocks.get(key(t)) === "planter" && !v.crops.has(key(t))) {
        return { tile: t, place: false, crop };
      }
    }
  }
  for (const t of starterHutGardenTiles(v.config, v.hearth)) {
    if (v.mine(t) && !v.blocks.has(key(t)) && !v.standing(t)) return { tile: t, place: true, crop };
  }
  return { problem: "no_room" };
}

/** What the toast says once the seed is in: "You planted an herb seed by your hearth. Ready in 2 days." */
export function plantedLine(crop: Crop): string {
  const { seed, days } = CROP_INFO[crop];
  const when = days === 1 ? "tomorrow" : `in ${days} days`;
  return `You planted ${aThing(seed)} by your hearth. Ready ${when}.`;
}
