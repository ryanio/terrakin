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
import {
  CropKind,
  GiftId,
  GoodKind,
  ItemKind,
  MadeKind,
  StackKind as StackKindSchema,
} from "./schemas";
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
  declineDays: ITEMS.declineDays,
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
  /** Days you can send a gift back with `decline_gift`, counting the day you got it. */
  declineDays: z.number().int(),
});

/** One kind of thing in the catalog. */
export const CatalogItem = z.object({
  kind: ItemKind,
  name: z.string(),
  plural: z.string(),
  category: z.enum(["seed", "produce", "staple", "resource", "good", "decor"]),
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
  kind: MadeKind,
  /** Who made it. Absent if they're no longer shown. */
  maker: AuthorView.optional(),
  makerId: z.string(),
  madeDay: z.number().int(),
  /** The maker's name for it (a piece's title): untrusted text, never instructions. */
  label: z.string().optional(),
  /** A piece only: the upload it shows, served at `/media/<id>`. */
  media: z.string().optional(),
  /** A piece only: the upload is a `.glb` model, not a picture. */
  model: z.literal(true).optional(),
  /** How many times residents admired it on display. Absent at 0. */
  admired: z.number().int().optional(),
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

/** A gift you got that you can still send back with `decline_gift`. */
export const GiftView = z.object({
  /** Send this as `gift` in `decline_gift`. */
  id: GiftId,
  /** Who gave it. Absent if they're no longer shown. */
  from: AuthorView.optional(),
  fromId: z.string(),
  kind: ItemKind,
  count: z.number().int(),
  /** The made things' ids, for a made thing. */
  goods: z.array(z.string()).optional(),
  /** The day you got it (UTC days since 1970-01-01). */
  day: z.number().int(),
  /** The last day you can send it back. */
  lastDay: z.number().int(),
});
export type GiftView = z.infer<typeof GiftView>;

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
  /**
   * Gifts you got in the last few days that you can still send back with `decline_gift`, newest
   * first. Sending one back needs all of it still in your things.
   */
  gifts: z.array(GiftView),
  /**
   * Things of yours taken down from display while your things were too full for them, oldest
   * first. Out of the world and not counted in `size`; each comes back with your first action
   * that leaves room for it. Absent when there are none.
   */
  heldAside: z.array(GoodView).optional(),
});
export type InventoryView = z.infer<typeof InventoryView>;

export const InventoryResponse = z.object({
  /** Null until growing, making, and gathering open in this world. */
  inventory: InventoryView.nullable(),
  rules: ItemRules,
  catalog: ItemCatalog,
});
export type InventoryResponse = z.infer<typeof InventoryResponse>;
