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
  FURNITURE_KINDS,
  FURNITURE_RECIPES,
  familyPath,
  GOOD_KINDS,
  ITEM_KINDS,
  type ItemKind,
  type KindEntry,
  PANTRY_STAPLES,
  PIECE_KINDS,
  RECIPES,
  RESOURCE_KINDS,
  ROTATION_CROPS,
  ROTATION_GOODS,
  SEED_KINDS,
  STACK_KINDS,
  STAPLE_KINDS,
  STARTER_SEEDS,
} from "./catalog";
import { WEAR_ITEMS } from "./looks";
import { BLOCK_KINDS, FREE_BLOCKS } from "./types";

const entries = Object.entries(CATALOG) as [ItemKind, KindEntry][];

/** JSON with its keys in order: a recipe's needs come off in this order in the craft event. */
const json = (value: unknown) => JSON.stringify(value);

/**
 * Every kind as it shipped, by role, in order. Logs hold these ids, and `build` orders what it uses
 * by `STACK_KINDS`, so a kind already shipped never leaves, never moves, and never changes role. A
 * new one joins the end of its role's list.
 */
const SHIPPED = {
  seed: [
    "lemon_seed",
    "strawberry_seed",
    "tomato_seed",
    "herb_seed",
    "flower_seed",
    "pumpkin_seed",
  ],
  crop: ["lemon", "strawberry", "tomato", "herb", "flower", "pumpkin"],
  staple: ["sugar", "jar"],
  resource: ["wood", "stone"],
  decor: ["lantern", "frame", "fence", "bench", "hay_bale", "scarecrow"],
  furniture: [
    "table",
    "chair",
    "bookshelf",
    "barrel",
    "signpost",
    "lamp_post",
    "well",
    "stone_wall",
    "campfire",
    "flower_box",
  ],
  good: [
    "lemon_jam",
    "strawberry_jam",
    "lemonade",
    "tomato_sauce",
    "herb_tea",
    "bouquet",
    "herb_sachet",
    "flower_wreath",
    "pumpkin_pie",
    "pumpkin_soup",
  ],
  piece: ["piece"],
};

/**
 * Every shipped recipe and crop, its needs in order. A logged `craft` uses up exactly these and a
 * logged `plant` grows by exactly these, so changing one changes how old logs replay.
 */
const SHIPPED_RECIPES = {
  lemon_jam: ["kitchen", { lemon: 3, sugar: 1, jar: 1 }],
  strawberry_jam: ["kitchen", { strawberry: 3, sugar: 1, jar: 1 }],
  lemonade: ["kitchen", { lemon: 2, sugar: 1, jar: 1 }],
  tomato_sauce: ["kitchen", { tomato: 3, herb: 1, jar: 1 }],
  herb_tea: ["kitchen", { herb: 2, jar: 1 }],
  bouquet: ["workbench", { flower: 3 }],
  herb_sachet: ["workbench", { herb: 2, flower: 1 }],
  flower_wreath: ["workbench", { flower: 4, herb: 2 }],
  pumpkin_pie: ["kitchen", { pumpkin: 2, sugar: 1 }],
  pumpkin_soup: ["kitchen", { pumpkin: 1, herb: 1, jar: 1 }],
  table: ["workbench", { wood: 3 }],
  chair: ["workbench", { wood: 2 }],
  bookshelf: ["workbench", { wood: 4 }],
  barrel: ["workbench", { wood: 3 }],
  signpost: ["workbench", { wood: 2 }],
  lamp_post: ["workbench", { wood: 1, stone: 2 }],
  well: ["workbench", { wood: 2, stone: 6 }],
  stone_wall: ["workbench", { stone: 1 }],
  campfire: ["workbench", { wood: 2, stone: 3 }],
  flower_box: ["workbench", { wood: 1, flower: 3 }],
} as const;
const SHIPPED_CROPS = {
  lemon: { seed: "lemon_seed", days: 4, yield: 3, seeds: 1 },
  strawberry: { seed: "strawberry_seed", days: 3, yield: 4, seeds: 1 },
  tomato: { seed: "tomato_seed", days: 3, yield: 3, seeds: 1 },
  herb: { seed: "herb_seed", days: 2, yield: 3, seeds: 1 },
  flower: { seed: "flower_seed", days: 2, yield: 3, seeds: 1 },
  pumpkin: { seed: "pumpkin_seed", days: 5, yield: 2, seeds: 1 },
} as const;

describe("what shipped", () => {
  it("keeps every kind, in its place: a new kind only joins the end of its role's list", () => {
    const lists = {
      seed: SEED_KINDS,
      crop: CROPS,
      staple: STAPLE_KINDS,
      resource: RESOURCE_KINDS,
      decor: DECOR_KINDS,
      furniture: FURNITURE_KINDS,
      good: GOOD_KINDS,
      piece: PIECE_KINDS,
    };
    for (const [role, list] of Object.entries(lists)) {
      const shipped = SHIPPED[role as keyof typeof SHIPPED];
      expect(list.slice(0, shipped.length), role).toEqual(shipped);
    }
    // The lists that span roles keep every shipped kind in the order it shipped.
    const all = Object.values(SHIPPED).flat();
    expect(STACK_KINDS.filter((k) => all.includes(k))).toEqual([
      ...SHIPPED.seed,
      ...SHIPPED.crop,
      ...SHIPPED.staple,
      ...SHIPPED.resource,
      ...SHIPPED.decor,
      ...SHIPPED.furniture,
    ]);
    expect(ITEM_KINDS.filter((k) => all.includes(k))).toEqual([
      ...STACK_KINDS.filter((k) => all.includes(k)),
      ...SHIPPED.good,
      ...SHIPPED.piece,
    ]);
  });

  it("keeps every recipe and crop's numbers, needs in the order they come off", () => {
    for (const [kind, [station, needs]] of Object.entries(SHIPPED_RECIPES)) {
      const recipe = (RECIPES as Record<string, unknown>)[kind] ?? FURNITURE_RECIPES[kind as never];
      expect(json(recipe), kind).toBe(json({ station, needs }));
    }
    for (const [crop, info] of Object.entries(SHIPPED_CROPS)) {
      expect(json(CROP_INFO[crop as Crop]), crop).toBe(json(info));
    }
  });

  it("freezes the lists rules walk: the first pantry's seeds, its staples, the town's rotation", () => {
    expect(STARTER_SEEDS).toEqual([
      "lemon_seed",
      "strawberry_seed",
      "tomato_seed",
      "herb_seed",
      "flower_seed",
    ]);
    expect(PANTRY_STAPLES).toEqual(["sugar", "jar"]);
    expect(ROTATION_GOODS).toEqual([
      "lemon_jam",
      "strawberry_jam",
      "lemonade",
      "tomato_sauce",
      "herb_tea",
      "bouquet",
      "herb_sachet",
      "flower_wreath",
    ]);
    expect(ROTATION_CROPS).toEqual(["lemon", "strawberry", "tomato", "herb", "flower"]);
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

  it("places as a block if it's decor or furniture, and every block you hold is one of them", () => {
    const held: readonly string[] = [...DECOR_KINDS, ...FURNITURE_KINDS];
    const free: readonly string[] = FREE_BLOCKS;
    for (const kind of held) expect(BLOCK_KINDS, kind).toContain(kind);
    expect(BLOCK_KINDS.filter((b) => !free.includes(b)).sort()).toEqual([...held].sort());
  });

  it("is sold at the town shop if it's a seed, decor, or a staple, which a shop sku can be", () => {
    for (const [kind, { role, shop }] of entries) {
      if (role === "seed" || role === "decor" || role === "staple") {
        expect(shop?.price, kind).toBeGreaterThanOrEqual(1);
      }
    }
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

  it("each have one color of their own to stand for them, on the map and on their packet", () => {
    for (const crop of CROPS) expect(CATALOG[crop].look, crop).toHaveProperty("body");
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
  it("make every good and piece of furniture from things that stack, never from nothing", () => {
    for (const kind of [...GOOD_KINDS, ...FURNITURE_KINDS]) {
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
