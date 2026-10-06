import {
  FURNITURE_KINDS,
  FURNITURE_RECIPES,
  type FurnitureKind,
  type Recipe as FurnitureRecipe,
} from "./catalog";

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
