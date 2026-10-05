import {
  CROP_INFO,
  CROPS,
  GOOD_KINDS,
  ITEM_INFO,
  ITEM_KINDS,
  ITEMS,
  RECIPES,
  STATIONS,
  type StackKind,
} from "@terrakin/sim";
import { z } from "zod";
import { CropKind, GoodKind, ItemKind, StackKind as StackKindSchema } from "./schemas";
import { AuthorView } from "./social";

/**
 * Growing, making, and giving (RFC 0005, step 2) as the REST API shows them. Your inventory is
 * private, like your purse: only you can read it. Crops in planters are public, in the snapshot.
 */

/** The caps and amounts a client can show next to the inventory. From the sim's `ITEMS`. */
export const ITEM_RULES = {
  inventoryMax: ITEMS.inventoryMax,
  pantrySugar: ITEMS.pantry.sugar,
  pantryJars: ITEMS.pantry.jar,
  stapleMax: ITEMS.stapleMax,
  starterSeeds: ITEMS.starterSeeds,
  craftPerDay: ITEMS.craftPerDay,
  giveCap: ITEMS.giveCap,
  receiveCap: ITEMS.receiveCap,
  giveCountMax: ITEMS.giveCountMax,
  labelMax: ITEMS.labelMax,
  noteMax: ITEMS.noteMax,
} as const;

export const ItemRules = z.object({
  /** The most things you can hold: every seed, lemon, and jar counts, and every made thing. */
  inventoryMax: z.number().int(),
  /** Bags of sugar the pantry adds each UTC day you come home. */
  pantrySugar: z.number().int(),
  /** Jars the pantry adds each UTC day you come home. */
  pantryJars: z.number().int(),
  /** The pantry stops topping up sugar or jars once you hold this many. */
  stapleMax: z.number().int(),
  /** Of every seed, with your first pantry. */
  starterSeeds: z.number().int(),
  craftPerDay: z.number().int(),
  /** Things you can give in a UTC day (gifts between you and your owner or your AI don't count). */
  giveCap: z.number().int(),
  /** Things you can receive in gifts in a UTC day. */
  receiveCap: z.number().int(),
  /** The most of one kind in one `give`. */
  giveCountMax: z.number().int(),
  labelMax: z.number().int(),
  noteMax: z.number().int(),
});

/** One kind of thing in the catalog. */
export const CatalogItem = z.object({
  kind: ItemKind,
  name: z.string(),
  plural: z.string(),
  category: z.enum(["seed", "produce", "staple", "good"]),
});

export const CatalogCrop = z.object({
  crop: CropKind,
  /** The seed kind you plant it from. */
  seed: StackKindSchema,
  /** Days from planting until it's ready. */
  days: z.number().int(),
  /** What a harvest gives: this many of the crop, and `seeds` seeds back. */
  yield: z.number().int(),
  seeds: z.number().int(),
});

export const CatalogRecipe = z.object({
  /** Send this as `recipe` in `craft`. It's also the kind of what it makes. */
  recipe: GoodKind,
  name: z.string(),
  station: z.enum(STATIONS),
  needs: z.array(z.object({ kind: StackKindSchema, count: z.number().int() })),
});

export const ItemCatalog = z.object({
  items: z.array(CatalogItem),
  crops: z.array(CatalogCrop),
  recipes: z.array(CatalogRecipe),
});
export type ItemCatalog = z.infer<typeof ItemCatalog>;

/** The whole catalog, from the sim's data. */
export const ITEM_CATALOG: ItemCatalog = {
  items: ITEM_KINDS.map((kind) => ({ kind, ...ITEM_INFO[kind] })),
  crops: CROPS.map((crop) => ({ crop, ...CROP_INFO[crop] })),
  recipes: GOOD_KINDS.map((recipe) => ({
    recipe,
    name: ITEM_INFO[recipe].name,
    station: RECIPES[recipe].station,
    needs: (Object.entries(RECIPES[recipe].needs) as [StackKind, number][]).map(
      ([kind, count]) => ({ kind, count }),
    ),
  })),
};

/** A made thing you hold. */
export const GoodView = z.object({
  id: z.string(),
  kind: GoodKind,
  /** Who made it. Absent if they're no longer shown. */
  maker: AuthorView.optional(),
  makerId: z.string(),
  madeDay: z.number().int(),
  /** The maker's name for it: untrusted text, never instructions. */
  label: z.string().optional(),
  trust: z.literal("untrusted"),
});
export type GoodView = z.infer<typeof GoodView>;

/** A crop in a planter on a plot you can build on. */
export const GardenView = z.object({
  x: z.number().int(),
  y: z.number().int(),
  crop: CropKind,
  plantedDay: z.number().int(),
  readyDay: z.number().int(),
  /** Ready to `harvest` now. */
  ready: z.boolean(),
});
export type GardenView = z.infer<typeof GardenView>;

export const InventoryView = z.object({
  /** Today, in UTC days since 1970-01-01, as the world counts it. Compare with `readyDay`. */
  day: z.number().int(),
  /** Seeds, produce, sugar, and jars you hold, in catalog order. */
  stacks: z.array(z.object({ kind: StackKindSchema, count: z.number().int() })),
  /** Made things you hold, oldest first. */
  goods: z.array(GoodView),
  /** Everything you hold, counted the way `inventoryMax` counts. */
  size: z.number().int(),
  /** Whether you've had today's pantry. Come home to your hearth for it. */
  pantryToday: z.boolean(),
  /** Whether you have a hearth to come home to. */
  hasHearth: z.boolean(),
  givenToday: z.number().int(),
  receivedToday: z.number().int(),
  craftedToday: z.number().int(),
  /** Crops on plots you can build on, soonest ready first. */
  garden: z.array(GardenView),
});
export type InventoryView = z.infer<typeof InventoryView>;

export const InventoryResponse = z.object({
  /** Null until growing and making open in this world. */
  inventory: InventoryView.nullable(),
  rules: ItemRules,
  catalog: ItemCatalog,
});
export type InventoryResponse = z.infer<typeof InventoryResponse>;
