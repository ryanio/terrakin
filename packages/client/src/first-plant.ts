/**
 * A first seed in one tap, for the world's next-step chip and the sheet after a home: where it
 * goes and which seed, worked out from what the world already shows, then the actions that put it
 * in. It goes in an empty planter of yours within reach of your hearth, or else in a new planter
 * inside the starter hut, on the tiles the sim keeps clear of the way in
 * (`starterHutGardenTiles`), as the garden link does for agents. The seed is the one held that
 * grows soonest. `planFirstPlanting`, `soonestCrop`, and `plantedLine` are pure and tested;
 * `sendFirstPlanting` sends what they decide, and the server checks every action like any other.
 */

import type { Action } from "@terrakin/protocol";
import {
  CROP_INFO,
  CROPS,
  type Crop,
  canBuildOn,
  starterHutGardenTiles,
  type WorldConfig,
} from "@terrakin/sim";
import { inventoryApi } from "./api/inventory";
import { actProblem, worldApi } from "./api/world";
import type { Mirror } from "./mirror";
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

/**
 * What a tap says when there's no one-tap plan: how to do it by hand. Never the step's own hint,
 * which says one tap plants it, since the tap that just failed was that one.
 */
export function plantByHandLine(problem: "no_seeds" | "no_room"): string {
  return problem === "no_seeds"
    ? "You have no seeds to plant. The shop sells them."
    : "There's no room for a planter by your hearth yet. Place one from Build, then tap it.";
}

/** What the toast says once the seed is in: "You planted an herb seed by your hearth. Ready in 2 days." */
export function plantedLine(crop: Crop): string {
  const { seed, days } = CROP_INFO[crop];
  const when = days === 1 ? "tomorrow" : `in ${days} days`;
  return `You planted ${aThing(seed)} by your hearth. Ready ${when}.`;
}

/** Send one action; its refusal, if any, in the server's words. */
const send = async (action: Action): Promise<string | null> =>
  actProblem(await worldApi.act(action));

/**
 * Plant a first seed by `me`'s hearth: home first when away from it, then a planter inside the
 * starter hut when there's no empty one within reach, then the seed that grows soonest. It gives
 * back what to say: the planted line, the world's refusal, or how to plant by hand when there are no
 * seeds or no room (a hearth set by hand, away from where the starter hut puts it). Null only when
 * there's no hearth or the inventory couldn't be read, so each caller says how in its own place.
 */
export async function sendFirstPlanting(m: Mirror, me: string): Promise<string | null> {
  const r = m.residents.get(me);
  const hearth = r?.hearth;
  if (!r || !hearth) return null;
  if (r.x !== hearth.x || r.y !== hearth.y || r.floor !== undefined) {
    const problem = await send({ type: "home" });
    if (problem) return problem;
  }
  const inv = await inventoryApi.inventory();
  if (!inv.ok) return null;
  const counts = new Map<string, number>(
    (inv.data.inventory?.stacks ?? []).map((s) => [s.kind, s.count]),
  );
  const plan = planFirstPlanting({
    config: m.config,
    hearth,
    blocks: m.blocks,
    crops: m.crops,
    mine: (t) => {
      const ownerId = m.ownerAt(t.x, t.y);
      return canBuildOn(
        ownerId ? { ownerId, coOwners: [...m.coOwnersAt(t.x, t.y)] } : undefined,
        me,
      );
    },
    standing: (t) =>
      [...m.residents.values()].some(
        (o) => o.online && o.x === t.x && o.y === t.y && o.floor === undefined,
      ),
    held: (kind) => counts.get(kind) ?? 0,
  });
  if ("problem" in plan) return plantByHandLine(plan.problem);
  const { tile, crop } = plan;
  const problem =
    (plan.place ? await send({ type: "place", ...tile, block: "planter" }) : null) ??
    (await send({ type: "plant", ...tile, seed: crop }));
  return problem ?? plantedLine(crop);
}
