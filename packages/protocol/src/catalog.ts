import {
  CATALOG,
  CROP_INFO,
  type Crop,
  canonicalJson,
  FAMILIES,
  FAMILY_RECIPES,
  type Family,
  type FamilyInfo,
  familyPath,
  fnv1a,
  ITEM_INFO,
  ITEM_KINDS,
  kindsIn,
  STATIONS,
} from "@terrakin/sim";
import { z } from "zod";
import { CatalogItem } from "./items";
import { CropKind, GoodKind, ItemKind, SeasonName, StackKind } from "./schemas";

/**
 * The catalog of things (RFC 0018) as `GET /v1/catalog` serves it: every family, every kind with
 * its family, how it grows, what the town shop asks for it, and how it's made, and the family
 * recipes. It comes from the sim's code, never from residents. `version` is a hash of the rest, so
 * it changes whenever anything in it does, and the check-in names it as `catalog`.
 */

const needsList = z.array(z.object({ kind: StackKind, count: z.number().int() }));

export const CatalogFamily = z.object({
  id: z.string().describe("The family's id, as a kind's `family` and `path` name it."),
  name: z.string().describe("Its name as a heading, like `Fruit`."),
  parent: z.string().optional().describe("The family it sits in. Absent for a top family."),
});

export const CatalogKind = z.object({
  kind: ItemKind,
  name: z.string(),
  plural: z.string(),
  family: z.string().describe("The one family it belongs to, the most specific."),
  path: z
    .array(z.string())
    .describe('That family\'s path from the most general, like `["food", "fruit"]`.'),
  category: CatalogItem.shape.category.describe(
    "What it is to the rules: a `good` is a made thing with an id and a maker; everything else stacks.",
  ),
  grows: CropKind.optional().describe("A seed: the crop it grows."),
  crop: z
    .object({
      seed: StackKind,
      days: z.number().int(),
      yield: z.number().int(),
      seeds: z.number().int(),
    })
    .optional()
    .describe(
      "A crop: the seed it grows from, the days from planting until it's ready, and what a harvest gives (`yield` of it and `seeds` seeds back).",
    ),
  shop: z
    .object({
      price: z.number().int(),
      seasons: z
        .array(SeasonName)
        .optional()
        .describe("Sold only in these seasons. Absent when it's sold all year."),
    })
    .optional()
    .describe("Sold at the town shop for `price` coins. `GET /v1/shop` says what it sells today."),
  recipe: z
    .object({
      station: z.enum(STATIONS),
      needs: needsList,
      familyRecipe: z
        .string()
        .optional()
        .describe("The family recipe it comes from, in `familyRecipes`, like `jam`."),
    })
    .optional()
    .describe(
      "Made with `craft`, naming this kind as `recipe`, at a station from what it uses up.",
    ),
  usedIn: z.array(ItemKind).optional().describe("The recipes that use it up. Absent when none do."),
});
export type CatalogKind = z.infer<typeof CatalogKind>;

export const CatalogFamilyRecipe = z.object({
  id: z.string().describe("Its id, as a kind's `recipe.familyRecipe` names it, like `jam`."),
  name: z.string(),
  family: z.string().describe("It takes `count` of any one kind from this family."),
  count: z.number().int(),
  plus: needsList.describe("What else it uses up."),
  station: z.enum(STATIONS),
  makes: z
    .array(GoodKind)
    .describe(
      "What it makes, one kind for each kind in the family, each listed in `kinds` with its recipe.",
    ),
});

export const CatalogResponse = z.object({
  version: z
    .string()
    .describe(
      "A hash of everything below. It changes whenever a kind, family, recipe, or price does. The check-in's `catalog` names the current one: read this again when it changes.",
    ),
  families: z
    .array(CatalogFamily)
    .describe("Every family, general ones first. Each kind belongs to one, its most specific."),
  kinds: z
    .array(CatalogKind)
    .describe(
      "Every kind of thing you can hold. New kinds, families, and categories may appear over time.",
    ),
  familyRecipes: z
    .array(CatalogFamilyRecipe)
    .describe(
      "Recipes that take any one kind from a family, like jam from any fruit. Each kind they make is in `kinds` with its own recipe.",
    ),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;

const needsOf = (needs: Readonly<Record<string, number>>) =>
  Object.entries(needs).map(([kind, count]) => ({ kind, count }));

/** The catalog's answer, from the sim's data, with its version. */
function catalogView(): CatalogResponse {
  const families = (Object.entries(FAMILIES) as [Family, FamilyInfo][]).map(([id, f]) => ({
    id,
    name: f.name,
    ...(f.parent ? { parent: f.parent } : {}),
  }));
  const usedIn = new Map<string, string[]>();
  for (const kind of ITEM_KINDS) {
    for (const need of Object.keys(CATALOG[kind].recipe?.needs ?? {})) {
      usedIn.set(need, [...(usedIn.get(need) ?? []), kind]);
    }
  }
  const madeBy = new Map(
    FAMILY_RECIPES.flatMap((r) => kindsIn(r.from).map((m) => [`${m}_${r.suffix}`, r.suffix])),
  );
  const kinds = ITEM_KINDS.map((kind) => {
    const e = CATALOG[kind];
    const familyRecipe = madeBy.get(kind);
    const used = usedIn.get(kind);
    return {
      kind,
      name: e.name,
      plural: e.plural,
      family: e.family,
      path: familyPath(e.family),
      category: ITEM_INFO[kind].category,
      ...(e.grows ? { grows: e.grows } : {}),
      ...(e.crop ? { crop: { ...CROP_INFO[kind as Crop] } } : {}),
      ...(e.shop
        ? {
            shop: {
              price: e.shop.price,
              ...(e.shop.seasons ? { seasons: [...e.shop.seasons] } : {}),
            },
          }
        : {}),
      ...(e.recipe
        ? {
            recipe: {
              station: e.recipe.station,
              needs: needsOf(e.recipe.needs),
              ...(familyRecipe ? { familyRecipe } : {}),
            },
          }
        : {}),
      ...(used ? { usedIn: used } : {}),
    };
  });
  const familyRecipes = FAMILY_RECIPES.map((r) => ({
    id: r.suffix,
    name: r.label,
    family: r.from,
    count: r.count,
    plus: needsOf(r.plus),
    station: r.station,
    makes: kindsIn(r.from).map((m) => `${m}_${r.suffix}`),
  }));
  const body = { families, kinds, familyRecipes };
  return CatalogResponse.parse({ version: fnv1a(canonicalJson(body)), ...body });
}

/** `GET /v1/catalog`'s answer. */
export const CATALOG_VIEW: CatalogResponse = catalogView();

/** The catalog's version, which the check-in names. */
export const CATALOG_VERSION = CATALOG_VIEW.version;
