import type { Biome, Family } from "@terrakin/sim";
import { z } from "zod";
import { HolidayName, SeasonName } from "./schemas";

/**
 * The collection book (RFC 0021): every kind of thing a resident has ever held and every piece of
 * wear they have worn or bought, with the UTC day they first did, grouped by the catalog's
 * families. Public, like a profile: it says which kinds and since when, never how many anyone holds
 * now. The server keeps it (`packages/server/src/collection.ts`); these are its shapes and its
 * words.
 */

/** The group wear goes in, after the catalog's families. */
export const WEAR_GROUP = "wear";
export type CollectionGroupId = Family | typeof WEAR_GROUP;

/**
 * What the book says about each group: a hint for what's not collected yet (where it comes from),
 * and, for a group of two kinds or more, the badge finishing it earns.
 */
export const COLLECTION_WORDS: Readonly<
  Record<CollectionGroupId, { hint: string; badge?: string }>
> = {
  food: { hint: "Grown in a planter, or made" },
  fruit: { hint: "Grown from seed in a planter", badge: "Every fruit" },
  vegetable: { hint: "Grown from seed in a planter", badge: "Every vegetable" },
  herb: { hint: "Grown from seed in a planter" },
  preserve: { hint: "Made at a kitchen", badge: "Every preserve" },
  drink: { hint: "Made at a kitchen", badge: "Every drink" },
  baked: { hint: "Made at a kitchen" },
  sweets: { hint: "Made at a kitchen, or sold at the shop for a holiday", badge: "Every sweet" },
  flower: { hint: "Grown from seed in a planter" },
  keepsake: { hint: "Made at a workbench", badge: "Every keepsake" },
  seed: { hint: "From the pantry, the town shop, or a harvest", badge: "Every seed" },
  pantry: { hint: "From the pantry and the town shop", badge: "Every staple" },
  material: { hint: "Gathered in forests and on stony ground", badge: "Wood and stone" },
  decor: { hint: "Sold at the town shop", badge: "Every decoration" },
  furniture: { hint: "Made at a workbench", badge: "Every piece of furniture" },
  art: { hint: "Made from a picture of your own" },
  find: { hint: "Picked up where it lies" },
  forest_find: { hint: "Found in forests", badge: "Forest finds" },
  shore_find: { hint: "Found on the sand", badge: "Shore finds" },
  stone_find: { hint: "Found on stony ground", badge: "Stone finds" },
  meadow_find: { hint: "Found in meadows", badge: "Meadow finds" },
  wear: { hint: "Worn, or bought at the town shop", badge: "Full wardrobe" },
};

/** Where each biome's finds lie, in words: "It lies on the sand now and then." */
export const FIND_GROUND: Readonly<Record<Biome, string>> = {
  forest: "in forests",
  sand: "on the sand",
  stone: "on stony ground",
  meadow: "in meadows",
};

/** How often a find turns up, in words, from its chance per tile a day (`FIND_SPAWNS`). */
export function findRarity(chance: number): "common" | "uncommon" | "rare" {
  if (chance >= 0.0025) return "common";
  if (chance >= 0.001) return "uncommon";
  return "rare";
}

export const CollectionKind = z.object({
  kind: z
    .string()
    .describe("A kind from `GET /v1/catalog`, or in the `wear` group, a piece of wear."),
  name: z.string(),
  firstDay: z
    .number()
    .int()
    .optional()
    .describe(
      "The UTC day (days since 1970-01-01) they first had it. Absent while it isn't collected.",
    ),
  seasons: z
    .array(SeasonName)
    .optional()
    .describe(
      "Found on the ground, or sold at the shop, only in these seasons. Absent when it's any time of year.",
    ),
  holiday: HolidayName.optional().describe(
    "Sold at the shop only while this holiday runs, like `halloween` (RFC 0022). Absent otherwise.",
  ),
});
export type CollectionKind = z.infer<typeof CollectionKind>;

export const CollectionGroup = z.object({
  family: z
    .string()
    .describe("The catalog family these kinds belong to, like `shore_find`, or `wear`."),
  name: z.string().describe("The family's name, like `Fruit` or `Shore`."),
  path: z
    .array(z.string())
    .describe('The family\'s path from the most general, like `["find", "shore_find"]`.'),
  hint: z.string().describe("Where these come from, for what isn't collected yet."),
  count: z.number().int().describe("How many kinds in it they have."),
  total: z.number().int(),
  badge: z
    .string()
    .optional()
    .describe("What finishing it earns, like `Every fruit`. Absent for a group of one kind."),
  done: z.boolean().describe("Every kind in it is collected."),
  kinds: z.array(CollectionKind).describe("Every kind in it, in catalog order."),
});
export type CollectionGroup = z.infer<typeof CollectionGroup>;

export const CollectionView = z.object({
  resident: z.string(),
  count: z.number().int().describe("Kinds and pieces of wear they've collected."),
  total: z
    .number()
    .int()
    .describe("Every kind in the catalog and every piece of wear anyone can wear. It grows."),
  groups: z
    .array(CollectionGroup)
    .describe("Each family that holds kinds, in the catalog's order, then wear."),
  badges: z.array(z.string()).describe("The badges of every group they finished, in that order."),
});
export type CollectionView = z.infer<typeof CollectionView>;

export const CollectionResponse = z.object({ collection: CollectionView });
export type CollectionResponse = z.infer<typeof CollectionResponse>;

/** How far along a book is, for profiles: "Collected 34 of 85". */
export const CollectedView = z.object({
  count: z.number().int(),
  total: z.number().int(),
});
export type CollectedView = z.infer<typeof CollectedView>;
