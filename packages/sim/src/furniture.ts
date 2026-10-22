import {
  FURNITURE_KINDS,
  FURNITURE_RECIPES,
  type FurnitureKind,
  type Recipe as FurnitureRecipe,
} from "./catalog";
import type { BlockKind } from "./types";

/**
 * Furniture (RFC 0016): pieces you make at a workbench from what you gather and grow, then place
 * on your plot. Each kind is a block kind and a stack kind at once, like the town shop's decor:
 * `place` takes one from your things and `remove` gives it back to whoever takes it up. Unlike a
 * good (`RECIPES`), a piece has no id, maker, or label, so it stacks.
 *
 * Every piece is an entry in the catalog (`catalog.ts`, RFC 0018) with the role `furniture`, in
 * the decor › furniture family, and its recipe. A new piece is an entry there, its name on the end
 * of `BLOCK_KINDS` in `types.ts`, a color in `BLOCK_COLORS`, and its pictures: `itemArt`, the map,
 * both 3D views, and the plot photo. Old logs never named it, so adding one never changes how they
 * replay. Changing a recipe changes how a logged `craft` of it replays: that needs an RFC, like any
 * recipe.
 */

export { FURNITURE_KINDS, FURNITURE_RECIPES, type FurnitureKind, type FurnitureRecipe };

export const isFurnitureKind = (k: unknown): k is FurnitureKind =>
  typeof k === "string" && (FURNITURE_KINDS as readonly string[]).includes(k);

/**
 * Seats (RFC 0044): the blocks `rest` puts you on, and how you rest there, sitting or lying. Resting
 * is where you stand, never a field: someone on a seat's tile is resting on it, and any move takes
 * them off. `chair` and `bench` stay solid, as they always were, so you rest on them from beside
 * them; making them walked onto would change how logged walks replay. Only kinds added with this
 * table are walked onto (`WALKED_ONTO_SEATS`).
 */
export const SEATS = {
  chair: "sit",
  bench: "sit",
  armchair: "sit",
  sofa: "sit",
  bed: "lie",
} as const satisfies Partial<Record<BlockKind, "sit" | "lie">>;
export type SeatKind = keyof typeof SEATS;
export type Posture = (typeof SEATS)[SeatKind];

/**
 * The seats anyone walks onto, the way stairs are (RFC 0044), so a sofa or a bed takes a tile of a
 * room and none of its walking space. Never an older kind: logged walks were planned round those.
 */
export const WALKED_ONTO_SEATS = ["armchair", "sofa", "bed"] as const satisfies readonly SeatKind[];

export const isSeatKind = (k: unknown): k is SeatKind =>
  typeof k === "string" && Object.hasOwn(SEATS, k);

/** How someone on a `block` rests: `sit`, `lie`, or undefined when it isn't a seat. */
export const postureOn = (block: BlockKind | undefined): Posture | undefined =>
  isSeatKind(block) ? SEATS[block] : undefined;
