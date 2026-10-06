import { describe, expect, it } from "vitest";
import {
  CATALOG,
  CROP_INFO,
  CROPS,
  type Crop,
  type CropNumbers,
  DECOR_KINDS,
  FAMILIES,
  type FamilyInfo,
  familyPath,
  GOOD_KINDS,
  ITEM_INFO,
  ITEM_KINDS,
  type ItemKind,
  type KindEntry,
  MADE_KINDS,
  PANTRY_STAPLES,
  PIECE_KINDS,
  RECIPES,
  RESOURCE_KINDS,
  ROTATION_CROPS,
  ROTATION_GOODS,
  SEASON_STOCK,
  SEED_KINDS,
  STACK_KINDS,
  STAPLE_KINDS,
  STARTER_SEEDS,
  STATIONS,
} from "./catalog";
import * as items from "./items";
import { isShopWear, WEAR_ITEMS } from "./looks";
import * as shop from "./shop";

const entries = Object.entries(CATALOG) as [ItemKind, KindEntry][];

/** JSON with its keys in order: a recipe's needs come off in this order in the craft event. */
const json = (value: unknown) => JSON.stringify(value);

/**
 * A table's rows in the order of `kinds`, each with its keys in order. Nothing walks a table's own
 * keys, so their order is left out.
 */
const rows = (table: Readonly<Record<string, unknown>>, kinds: readonly string[]) =>
  json([Object.keys(table).sort(), kinds.map((kind) => [kind, table[kind]])]);

describe("the catalog's views", () => {
  it("give exactly the lists and tables in items.ts, in the same order", () => {
    const lists = {
      ITEM_KINDS: [ITEM_KINDS, items.ITEM_KINDS],
      STACK_KINDS: [STACK_KINDS, items.STACK_KINDS],
      SEED_KINDS: [SEED_KINDS, items.SEED_KINDS],
      CROPS: [CROPS, items.CROPS],
      STAPLE_KINDS: [STAPLE_KINDS, items.STAPLE_KINDS],
      RESOURCE_KINDS: [RESOURCE_KINDS, items.RESOURCE_KINDS],
      DECOR_KINDS: [DECOR_KINDS, items.DECOR_KINDS],
      GOOD_KINDS: [GOOD_KINDS, items.GOOD_KINDS],
      PIECE_KINDS: [PIECE_KINDS, items.PIECE_KINDS],
      MADE_KINDS: [MADE_KINDS, items.MADE_KINDS],
      STATIONS: [STATIONS, items.STATIONS],
    };
    for (const [name, [mine, theirs]] of Object.entries(lists)) expect(mine, name).toEqual(theirs);
    expect(rows(ITEM_INFO, ITEM_KINDS)).toBe(rows(items.ITEM_INFO, ITEM_KINDS));
    expect(rows(CROP_INFO, CROPS)).toBe(rows(items.CROP_INFO, CROPS));
    expect(rows(RECIPES, GOOD_KINDS)).toBe(rows(items.RECIPES, GOOD_KINDS));
  });

  it("sell what the town shop sells, at its prices and in its seasons", () => {
    const priced = entries.flatMap(([kind, e]) => (e.shop ? [[kind, e.shop.price]] : []));
    const sold = shop.SHOP_SKUS.filter((sku) => !isShopWear(sku)).map((sku) => [
      sku,
      shop.SHOP_CATALOG[sku].price,
    ]);
    expect(Object.fromEntries(priced)).toEqual(Object.fromEntries(sold));
    expect(SEASON_STOCK).toEqual(shop.SEASON_STOCK);
  });
});

describe("the frozen lists", () => {
  it("hold what the rules walk today: the first pantry's seeds, its staples, the town's rotation", () => {
    expect(STARTER_SEEDS).toEqual(items.STARTER_SEEDS);
    expect(PANTRY_STAPLES).toEqual(items.STAPLE_KINDS);
    expect(ROTATION_GOODS).toEqual(shop.ROTATION_GOODS);
    expect(ROTATION_CROPS).toEqual(shop.ROTATION_CROPS);
  });
});

describe("every entry", () => {
  it("has an id fit for logs and URLs, is listed once, and never shares a piece of wear's id", () => {
    // The shop sells kinds and wear under one name, `sku`, and pictures share one table.
    for (const [kind] of entries) {
      expect(kind).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      expect(WEAR_ITEMS as readonly string[], kind).not.toContain(kind);
    }
    expect([...ITEM_KINDS].sort()).toEqual(entries.map(([kind]) => kind).sort());
  });

  it("belongs to a family whose parents are families, and every family holds something", () => {
    const families = Object.keys(FAMILIES);
    for (const [family, { parent }] of Object.entries(FAMILIES as Record<string, FamilyInfo>)) {
      if (parent !== undefined) expect(families, family).toContain(parent);
    }
    const held = new Set<string>(entries.flatMap(([, e]) => familyPath(e.family)));
    expect(families.filter((family) => !held.has(family))).toEqual([]);
  });

  it("is named without dashes, like every family", () => {
    // Hyphens join words; a dash, or hyphens standing in for one, doesn't belong in a name.
    const dash = /[\u2012-\u2015]|\s-\s|--/;
    for (const [kind, { name, plural }] of entries) {
      expect(name, kind).not.toMatch(dash);
      expect(plural, kind).not.toMatch(dash);
    }
    for (const { name } of Object.values(FAMILIES)) expect(name).not.toMatch(dash);
  });

  it("has a look its template can draw", () => {
    const hex = /^#[0-9a-f]{6}$/;
    for (const [kind, { look, grows }] of entries) {
      const colors: string[] = [];
      switch (look.template) {
        case "produce":
          colors.push(look.body, look.detail, ...(look.jam ? [look.jam.fill, look.jam.cloth] : []));
          break;
        case "sprig":
        case "bloom":
          colors.push(look.body);
          break;
        case "jar":
          // The label shows what's in the jar.
          colors.push(look.fill, "cloth" in look ? look.cloth : look.lid);
          expect(CATALOG[look.label as ItemKind]?.role, kind).toBe("produce");
          break;
        case "packet":
          // A packet shows the crop it grows, in that crop's color.
          expect(CATALOG[grows as ItemKind]?.look, kind).toHaveProperty("body");
          break;
        case "drawn":
          break;
      }
      for (const color of colors) expect(color, kind).toMatch(hex);
    }
  });
});

describe("seeds and crops", () => {
  it("pair up: every seed grows a crop that names it back, and every crop has one seed", () => {
    for (const seed of SEED_KINDS) {
      const crop = CATALOG[seed].grows;
      expect(CROPS as readonly string[], seed).toContain(crop);
      expect(CROP_INFO[crop as Crop].seed, seed).toBe(seed);
    }
    for (const crop of CROPS) {
      expect(
        SEED_KINDS.filter((seed) => CATALOG[seed].grows === crop),
        crop,
      ).toHaveLength(1);
    }
  });

  it("take whole days and give back at most their seed, so gardens grow only by the shop and gifts", () => {
    // A crop ready the day it's planted could be picked over and over in one day, and more than one
    // seed back would let a garden grow by itself (decision 0051).
    for (const crop of CROPS) {
      const { days, yield: harvest, seedsBack } = CATALOG[crop].crop as CropNumbers;
      expect(Number.isInteger(days) && days >= 1, `${crop} days`).toBe(true);
      expect(Number.isInteger(harvest) && harvest >= 1, `${crop} yield`).toBe(true);
      expect([0, 1], `${crop} seeds back`).toContain(seedsBack);
    }
  });
});

describe("recipes", () => {
  it("make every good from things that stack and that the catalog has, never from nothing", () => {
    for (const kind of GOOD_KINDS) {
      const needs = Object.entries(CATALOG[kind].recipe?.needs ?? {});
      expect(needs.length, kind).toBeGreaterThan(0);
      for (const [need, n] of needs) {
        expect(STACK_KINDS as readonly string[], `${kind} needs ${need}`).toContain(need);
        expect(Number.isInteger(n) && n >= 1, `${kind} needs ${n} ${need}`).toBe(true);
      }
    }
  });

  it("make one jam from every fruit: three of it, a bag of sugar, and a jar, at a kitchen", () => {
    const fruits = entries.filter(([, e]) => e.family === "fruit");
    expect(fruits.length).toBeGreaterThan(0);
    for (const [fruit, { name }] of fruits) {
      const jam = CATALOG[`${fruit}_jam` as ItemKind];
      expect(jam, fruit).toMatchObject({
        name: `${name} jam`,
        plural: `Jars of ${name.toLowerCase()} jam`,
        family: "preserve",
        role: "good",
        look: { template: "jar", label: fruit },
      });
      expect(json(jam.recipe), fruit).toBe(
        json({ station: "kitchen", needs: { [fruit]: 3, sugar: 1, jar: 1 } }),
      );
    }
    const jams = entries.filter(([kind]) => kind.endsWith("_jam")).map(([kind]) => kind);
    expect(jams).toEqual(fruits.map(([fruit]) => `${fruit}_jam`));
  });
});
