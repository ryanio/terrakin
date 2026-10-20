import {
  MATERIAL_KINDS,
  MATERIAL_RECIPES,
  type MaterialKind,
  type Recipe as MaterialRecipe,
} from "./catalog";

/**
 * Made materials ([RFC 0041](../../../docs/rfcs/0041-materials-and-roofs.md)): walls and windows
 * made at a workbench from what you gather and find, then placed on your plot. Each kind is a
 * block kind and a stack kind at once, exactly as furniture and the shop's decor are: `place`
 * takes one from your things and `remove` gives it back to whoever takes it up.
 *
 * They are extras. The four free blocks (`BUILDING_BLOCKS`: wood, stone, glass, leaf) stay free
 * and unlimited, so nothing a newcomer builds gets more expensive and every older plan still
 * builds. What these buy is that a home can look like somewhere: driftwood and sea glass come off
 * the shore, and plaster and brick from stone anyone can gather.
 *
 * A new material is an entry in `catalog.ts` with the role `material` in the `material` family and
 * its recipe, its name on the end of `BLOCK_KINDS` in `types.ts`, a color in `BLOCK_COLORS`, and
 * its pictures: `itemArt`, the map, both 3D views, and the plot photo. Old logs never named it, so
 * adding one never changes how they replay. Changing a recipe changes how a logged `craft` of it
 * replays, which needs an RFC, like any recipe.
 */

export { MATERIAL_KINDS, MATERIAL_RECIPES, type MaterialKind, type MaterialRecipe };

export const isMaterialKind = (k: unknown): k is MaterialKind =>
  typeof k === "string" && (MATERIAL_KINDS as readonly string[]).includes(k);

/**
 * The materials that hold up what is above them, as wood, stone and glass do (`floors.ts`). A
 * solid wall holds a floor up; a pane is a window and holds up as much as glass does, which is to
 * say the same. Nothing here is a hedge, so every one of them holds.
 */
export const HOLDING_MATERIALS: readonly MaterialKind[] = MATERIAL_KINDS;
