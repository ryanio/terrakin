import type { ItemInfo, StackKind, Station } from "./items";
import { FURNITURE_BLOCKS, type FurnitureBlock } from "./types";

/**
 * Furniture (RFC 0016): pieces you make at a workbench from what you gather and grow, then place
 * on your plot. Each kind is a block kind and a stack kind at once, like the town shop's decor:
 * `place` takes one from your things and `remove` gives it back to whoever takes it up. Unlike a
 * good (`RECIPES` in `items.ts`), a piece has no id, maker, or label, so it stacks.
 *
 * A new piece is a name on the end of `FURNITURE_BLOCKS` (and `BLOCK_KINDS`) in `types.ts`, an entry
 * in each table here, and its pictures: `itemArt`, the map, both 3D views, and the plot photo.
 * Old logs never named it, so adding one never changes how they replay. Changing a recipe changes
 * how a logged `craft` of it replays: that needs an RFC, like any recipe.
 */

export const FURNITURE_KINDS = FURNITURE_BLOCKS;
export type FurnitureKind = FurnitureBlock;

export const isFurnitureKind = (k: unknown): k is FurnitureKind =>
  typeof k === "string" && (FURNITURE_KINDS as readonly string[]).includes(k);

export interface FurnitureRecipe {
  station: Station;
  /** What it uses up. At least one thing, so making one never needs more room. */
  needs: Partial<Record<StackKind, number>>;
}

/** One recipe per piece, named after what it makes. Decision 0075 has the reasoning. */
export const FURNITURE_RECIPES: Readonly<Record<FurnitureKind, FurnitureRecipe>> = {
  table: { station: "workbench", needs: { wood: 3 } },
  chair: { station: "workbench", needs: { wood: 2 } },
  bookshelf: { station: "workbench", needs: { wood: 4 } },
  barrel: { station: "workbench", needs: { wood: 3 } },
  signpost: { station: "workbench", needs: { wood: 2 } },
  lamp_post: { station: "workbench", needs: { wood: 1, stone: 2 } },
  well: { station: "workbench", needs: { wood: 2, stone: 6 } },
  stone_wall: { station: "workbench", needs: { stone: 1 } },
  campfire: { station: "workbench", needs: { wood: 2, stone: 3 } },
  flower_box: { station: "workbench", needs: { wood: 1, flower: 3 } },
};

/** Each piece in plain words, for `ITEM_INFO`. */
export const FURNITURE_INFO: Readonly<Record<FurnitureKind, ItemInfo>> = {
  table: { name: "Table", plural: "Tables", category: "furniture" },
  chair: { name: "Chair", plural: "Chairs", category: "furniture" },
  bookshelf: { name: "Bookshelf", plural: "Bookshelves", category: "furniture" },
  barrel: { name: "Barrel", plural: "Barrels", category: "furniture" },
  signpost: { name: "Signpost", plural: "Signposts", category: "furniture" },
  lamp_post: { name: "Lamp post", plural: "Lamp posts", category: "furniture" },
  well: { name: "Well", plural: "Wells", category: "furniture" },
  stone_wall: { name: "Low stone wall", plural: "Low stone walls", category: "furniture" },
  campfire: { name: "Campfire", plural: "Campfires", category: "furniture" },
  flower_box: { name: "Flower box", plural: "Flower boxes", category: "furniture" },
};
