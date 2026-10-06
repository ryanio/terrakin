/**
 * The catalog of things (RFC 0018): every kind of thing a resident can hold, one entry each, sorted
 * into families such as food › fruit. Seeds, produce, staples, materials, decor, furniture, made
 * goods, pieces of art, and finds are all entries here, as plain data like the looks catalog.
 *
 * Ids never change, since logs hold them, and new entries go on the end. The lists and tables below
 * the entries are views of it: each list groups kinds by role, in catalog order, so a new kind
 * joins the end of its lists. Lists a rule walks, whose contents and order decide how old logs
 * replay, are frozen by name at the bottom instead.
 *
 * The sim reads its lists and tables from here: `items.ts`, `furniture.ts`, `shop.ts`, and `types.ts`
 * export them under the names they always had. `catalog.test.ts` pins every list and recipe as it
 * shipped, so a new entry can only add to them.
 */
import type { Holiday } from "./holiday";
import type { Season } from "./season";

// ---------- families ----------

/** A family: its name as a heading, and the family it sits in, if any. */
export interface FamilyInfo {
  name: string;
  parent?: string;
}

/**
 * Every family, in the order people see them. A family sits in at most one other, so each has a
 * path from the most general to itself: food › fruit. Every kind belongs to exactly one family, its
 * most specific. Families sort things for people (the inventory, the shop, the API), and a family
 * recipe takes any one kind from a family. No other rule reads them.
 */
export const FAMILIES = {
  food: { name: "Food" },
  fruit: { name: "Fruit", parent: "food" },
  vegetable: { name: "Vegetables", parent: "food" },
  herb: { name: "Herbs", parent: "food" },
  preserve: { name: "Preserves", parent: "food" },
  drink: { name: "Drinks", parent: "food" },
  baked: { name: "Baked goods", parent: "food" },
  sweets: { name: "Sweets", parent: "food" },
  flower: { name: "Flowers" },
  keepsake: { name: "Keepsakes" },
  seed: { name: "Seeds" },
  pantry: { name: "Pantry" },
  material: { name: "Materials" },
  decor: { name: "Decor" },
  furniture: { name: "Furniture", parent: "decor" },
  art: { name: "Art" },
  // Finds (RFC 0021): picked up with `gather` where they lie, each family named for its ground.
  find: { name: "Finds" },
  forest_find: { name: "Forest", parent: "find" },
  shore_find: { name: "Shore", parent: "find" },
  stone_find: { name: "Stony ground", parent: "find" },
  meadow_find: { name: "Meadow", parent: "find" },
} as const satisfies Readonly<Record<string, FamilyInfo>>;
export type Family = keyof typeof FAMILIES;

/** A family's path, from the most general to itself: `familyPath("fruit")` is food, then fruit. */
export function familyPath(family: Family): Family[] {
  const path: Family[] = [];
  for (let f: Family | undefined = family; f !== undefined; ) {
    if (path.includes(f)) throw new Error(`The families go round in a loop at ${f}.`);
    path.unshift(f);
    f = (FAMILIES[f] as FamilyInfo).parent as Family | undefined;
  }
  return path;
}

// ---------- entries ----------

/**
 * What a kind is to the rules, which read this and never the family: something to plant, produce
 * from a planter, a kitchen staple, a gathered material, decor that places as a block, furniture
 * made at a workbench that stacks and places like decor (RFC 0016), a made good, a piece of art, or
 * a find (RFC 0021): something rare picked up where it lies, which stacks and can stand on a
 * pedestal; or a sweet (RFC 0022): made at a kitchen and stacked, to hand out, like candy. It's
 * the category the API shows, where a piece shows as a good.
 */
export type Role =
  | "seed"
  | "produce"
  | "staple"
  | "resource"
  | "decor"
  | "furniture"
  | "good"
  | "piece"
  | "find"
  | "sweet";

/** Block kinds you craft at. `craft` names the station's tile. */
export const STATIONS = ["kitchen", "workbench"] as const;
export type Station = (typeof STATIONS)[number];

/**
 * How a made thing is made, as its entry writes it: at a station, using up what it needs, in this
 * order. The views give it as a `Recipe`, its needs keyed by kind.
 */
export interface KindRecipe {
  station: Station;
  /** Each kind it uses up and how many. Only things that stack. */
  needs: Readonly<Record<string, number>>;
  /** How many one craft makes, for a sweet. Absent is one, as every good and piece of furniture. */
  makes?: number;
}

/** How a crop grows. Planted on day D, it's ready when day D + days starts. */
export interface CropNumbers {
  days: number;
  /** Produce a harvest gives. */
  yield: number;
  /** Seeds a harvest gives back, so a garden keeps going. */
  seedsBack: number;
}

/**
 * A crop drawn from the produce template: its outline (an oval with pointed ends like a lemon, a
 * berry, round, or three ribbed lobes like a pumpkin), what grows on top (a leaf, a leafy cap, a
 * star of sepals with a stem, a stubby stem with a curl of vine and a leaf, or a small crown like a
 * pomegranate's), its skin, and the color of its speckles, seeds, or ribs. A crop with a vine on
 * top grows along the soil in a planter. A fruit also gives the colors of its jam: what fills the
 * jar the jam family recipe makes, and the cloth tied over it.
 */
export interface ProduceLook {
  template: "produce";
  shape: "oval" | "berry" | "round" | "lobed";
  top: "leaf" | "cap" | "star" | "vine" | "crown";
  body: string;
  detail: string;
  jam?: { fill: string; cloth: string };
}

/**
 * A jar filled with `fill`, with a picture of `label` (a kind) on its label, and either a cloth tied
 * over the top, like a jam, or a lid and a sprig of leaves, like a sauce.
 */
export type JarLook =
  | { template: "jar"; fill: string; label: string; cloth: string }
  | { template: "jar"; fill: string; label: string; lid: string };

/**
 * How a kind is drawn: a template and its colors, so a new fruit is a few colors and not a new
 * drawing. Besides produce and jars: `sprig` is a sprig of leaves (herbs), `bloom` a flower on its
 * stem with its petals in `body`, and `packet` a paper seed packet with the crop it grows on the
 * front, in that crop's colors. `drawn` kinds have their own picture in
 * `packages/ui/src/item-art.ts`, under their id. Colors are `#rrggbb`. `body` is the one color that
 * stands for a kind where it shows small: a ripe crop on the map and in 3D, a plot photo, a seed
 * packet's band.
 */
export type KindLook =
  | ProduceLook
  | { template: "sprig"; body: string }
  | { template: "bloom"; body: string }
  | { template: "packet" }
  | JarLook
  | { template: "drawn" };

/** One kind of thing. Nothing in it comes from residents. */
export interface KindEntry {
  /** One of it, in plain words: "Lemon". */
  name: string;
  /** More than one: "Lemons". */
  plural: string;
  /** The most specific family it belongs to. */
  family: Family;
  role: Role;
  /** A seed: the crop it grows. */
  grows?: string;
  /** A crop: how it grows. */
  crop?: CropNumbers;
  /**
   * Sold at the town shop for `price` coins: all year, every day of `seasons` only, or only while
   * `holiday` runs (RFC 0022).
   */
  shop?: { price: number; seasons?: readonly Season[]; holiday?: Holiday };
  /** A made good or a piece of furniture: how it's made. */
  recipe?: KindRecipe;
  look: KindLook;
}

/** An entry with its role and family kept as literal types, so the kinds can be listed by type. */
type Typed<R extends Role, F extends Family> = KindEntry & { role: R; family: F };

/** One entry, written out. */
const entry = <const R extends Role, const F extends Family>(e: Typed<R, F>): Typed<R, F> => e;

/** A kind's id in plain words, starting with a capital: "sweet_pea" is "Sweet pea". */
const title = (id: string) => `${id.charAt(0).toUpperCase()}${id.slice(1).replaceAll("_", " ")}`;

/**
 * A find (RFC 0021): picked up where it lies, in its family's ground, and drawn by hand. Where and
 * how often it lies is `FIND_SPAWNS` in `gather.ts`, frozen there, never here.
 */
const find = <const F extends Family>(name: string, plural: string, family: F) =>
  entry({ name, plural, family, role: "find", look: { template: "drawn" } });

interface CropSpec<F extends Family> {
  name: string;
  plural: string;
  family: F;
  days: number;
  yield: number;
  seedsBack: number;
  /** What the town shop asks for one of its seeds. */
  seedPrice: number;
  /** The seasons the shop sells its seeds in, when it doesn't all year. */
  seedSeasons?: readonly Season[];
  look: KindLook;
}

/**
 * A crop and its seed: `id`, which grows in a planter, and `<id>_seed`, which grows it and which the
 * town shop sells for `seedPrice`.
 */
function crop<const Id extends string, const F extends Family>(id: Id, spec: CropSpec<F>) {
  const {
    name,
    plural,
    family,
    days,
    yield: harvest,
    seedsBack,
    seedPrice,
    seedSeasons,
    look,
  } = spec;
  const seed: KindEntry = {
    name: `${title(id)} seed`,
    plural: `${title(id)} seeds`,
    family: "seed",
    role: "seed",
    grows: id,
    shop: seedSeasons ? { price: seedPrice, seasons: seedSeasons } : { price: seedPrice },
    look: { template: "packet" },
  };
  const produce: KindEntry = {
    name,
    plural,
    family,
    role: "produce",
    crop: { days, yield: harvest, seedsBack },
    look,
  };
  return { [`${id}_seed`]: seed, [id]: produce } as unknown as Record<
    `${Id}_seed`,
    Typed<"seed", "seed">
  > &
    Record<Id, Typed<"produce", F> & { crop: CropNumbers }>;
}

/** A fruit: a crop in food › fruit, drawn as produce with its jam's colors. */
const fruit = <const Id extends string>(
  id: Id,
  spec: Omit<CropSpec<"fruit">, "family" | "look"> & {
    look: ProduceLook & { jam: { fill: string; cloth: string } };
  },
) => crop(id, { ...spec, family: "fruit" });

/**
 * The entries as written, before family recipes add what they make. Key order is catalog order:
 * new kinds go on the end.
 */
const WRITTEN = {
  ...fruit("lemon", {
    name: "Lemon",
    plural: "Lemons",
    days: 4,
    yield: 3,
    seedsBack: 1,
    seedPrice: 4,
    look: {
      template: "produce",
      shape: "oval",
      top: "leaf",
      body: "#f2d04b",
      detail: "#f2b84b",
      jam: { fill: "#f2c53d", cloth: "#e2b23a" },
    },
  }),
  ...fruit("strawberry", {
    name: "Strawberry",
    plural: "Strawberries",
    days: 3,
    yield: 4,
    seedsBack: 1,
    seedPrice: 4,
    look: {
      template: "produce",
      shape: "berry",
      top: "cap",
      body: "#d9434f",
      detail: "#ffe7a3",
      jam: { fill: "#c8344a", cloth: "#ea8a9d" },
    },
  }),
  ...crop("tomato", {
    name: "Tomato",
    plural: "Tomatoes",
    family: "vegetable",
    days: 3,
    yield: 3,
    seedsBack: 1,
    seedPrice: 4,
    look: { template: "produce", shape: "round", top: "star", body: "#e0573a", detail: "#c4462c" },
  }),
  ...crop("herb", {
    name: "Bunch of herbs",
    plural: "Bunches of herbs",
    family: "herb",
    days: 2,
    yield: 3,
    seedsBack: 1,
    seedPrice: 3,
    look: { template: "sprig", body: "#4f8a3a" },
  }),
  ...crop("flower", {
    name: "Flower",
    plural: "Flowers",
    family: "flower",
    days: 2,
    yield: 3,
    seedsBack: 1,
    seedPrice: 3,
    look: { template: "bloom", body: "#e58fb6" },
  }),
  sugar: entry({
    name: "Bag of sugar",
    plural: "Bags of sugar",
    family: "pantry",
    role: "staple",
    shop: { price: 3 },
    look: { template: "drawn" },
  }),
  jar: entry({
    name: "Jar",
    plural: "Jars",
    family: "pantry",
    role: "staple",
    shop: { price: 3 },
    look: { template: "drawn" },
  }),
  wood: entry({
    name: "Wood",
    plural: "Wood",
    family: "material",
    role: "resource",
    look: { template: "drawn" },
  }),
  stone: entry({
    name: "Stone",
    plural: "Stone",
    family: "material",
    role: "resource",
    look: { template: "drawn" },
  }),
  lantern: entry({
    name: "Paper lantern",
    plural: "Paper lanterns",
    family: "decor",
    role: "decor",
    shop: { price: 40 },
    look: { template: "drawn" },
  }),
  frame: entry({
    name: "Picture frame",
    plural: "Picture frames",
    family: "decor",
    role: "decor",
    shop: { price: 30 },
    look: { template: "drawn" },
  }),
  fence: entry({
    name: "Fence post",
    plural: "Fence posts",
    family: "decor",
    role: "decor",
    shop: { price: 3 },
    look: { template: "drawn" },
  }),
  bench: entry({
    name: "Garden bench",
    plural: "Garden benches",
    family: "decor",
    role: "decor",
    shop: { price: 25 },
    look: { template: "drawn" },
  }),
  lemonade: entry({
    name: "Lemonade",
    plural: "Jars of lemonade",
    family: "drink",
    role: "good",
    recipe: { station: "kitchen", needs: { lemon: 2, sugar: 1, jar: 1 } },
    look: { template: "drawn" },
  }),
  tomato_sauce: entry({
    name: "Tomato sauce",
    plural: "Jars of tomato sauce",
    family: "preserve",
    role: "good",
    recipe: { station: "kitchen", needs: { tomato: 3, herb: 1, jar: 1 } },
    look: { template: "jar", fill: "#b8322a", label: "tomato", lid: "#b4532f" },
  }),
  herb_tea: entry({
    name: "Herb tea",
    plural: "Jars of herb tea",
    family: "drink",
    role: "good",
    recipe: { station: "kitchen", needs: { herb: 2, jar: 1 } },
    look: { template: "drawn" },
  }),
  bouquet: entry({
    name: "Bouquet",
    plural: "Bouquets",
    family: "keepsake",
    role: "good",
    recipe: { station: "workbench", needs: { flower: 3 } },
    look: { template: "drawn" },
  }),
  herb_sachet: entry({
    name: "Herb sachet",
    plural: "Herb sachets",
    family: "keepsake",
    role: "good",
    recipe: { station: "workbench", needs: { herb: 2, flower: 1 } },
    look: { template: "drawn" },
  }),
  flower_wreath: entry({
    name: "Flower wreath",
    plural: "Flower wreaths",
    family: "keepsake",
    role: "good",
    recipe: { station: "workbench", needs: { flower: 4, herb: 2 } },
    look: { template: "drawn" },
  }),
  // Made with `make_piece` from your own upload, not from a recipe.
  piece: entry({
    name: "Piece of art",
    plural: "Pieces of art",
    family: "art",
    role: "piece",
    look: { template: "drawn" },
  }),
  // Autumn (RFC 0017): its crop, what the kitchen makes from it, and the shop's autumn decor.
  ...crop("pumpkin", {
    name: "Pumpkin",
    plural: "Pumpkins",
    family: "vegetable",
    days: 5,
    yield: 2,
    seedsBack: 1,
    seedPrice: 4,
    seedSeasons: ["autumn"],
    look: { template: "produce", shape: "lobed", top: "vine", body: "#e8862f", detail: "#c4661c" },
  }),
  pumpkin_pie: entry({
    name: "Pumpkin pie",
    plural: "Pumpkin pies",
    family: "baked",
    role: "good",
    recipe: { station: "kitchen", needs: { pumpkin: 2, sugar: 1 } },
    look: { template: "drawn" },
  }),
  pumpkin_soup: entry({
    name: "Pumpkin soup",
    plural: "Jars of pumpkin soup",
    family: "preserve",
    role: "good",
    recipe: { station: "kitchen", needs: { pumpkin: 1, herb: 1, jar: 1 } },
    look: { template: "jar", fill: "#e3913d", label: "pumpkin", lid: "#5e7f45" },
  }),
  hay_bale: entry({
    name: "Hay bale",
    plural: "Hay bales",
    family: "decor",
    role: "decor",
    shop: { price: 8, seasons: ["autumn"] },
    look: { template: "drawn" },
  }),
  scarecrow: entry({
    name: "Scarecrow",
    plural: "Scarecrows",
    family: "decor",
    role: "decor",
    shop: { price: 35, seasons: ["autumn"] },
    look: { template: "drawn" },
  }),
  // Furniture from the workbench (RFC 0016): made from what you gather and grow, held and placed
  // like decor.
  table: entry({
    name: "Table",
    plural: "Tables",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 3 } },
    look: { template: "drawn" },
  }),
  chair: entry({
    name: "Chair",
    plural: "Chairs",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 2 } },
    look: { template: "drawn" },
  }),
  bookshelf: entry({
    name: "Bookshelf",
    plural: "Bookshelves",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 4 } },
    look: { template: "drawn" },
  }),
  barrel: entry({
    name: "Barrel",
    plural: "Barrels",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 3 } },
    look: { template: "drawn" },
  }),
  signpost: entry({
    name: "Signpost",
    plural: "Signposts",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 2 } },
    look: { template: "drawn" },
  }),
  lamp_post: entry({
    name: "Lamp post",
    plural: "Lamp posts",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 1, stone: 2 } },
    look: { template: "drawn" },
  }),
  well: entry({
    name: "Well",
    plural: "Wells",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 2, stone: 6 } },
    look: { template: "drawn" },
  }),
  stone_wall: entry({
    name: "Low stone wall",
    plural: "Low stone walls",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { stone: 1 } },
    look: { template: "drawn" },
  }),
  campfire: entry({
    name: "Campfire",
    plural: "Campfires",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 2, stone: 3 } },
    look: { template: "drawn" },
  }),
  flower_box: entry({
    name: "Flower box",
    plural: "Flower boxes",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { wood: 1, flower: 3 } },
    look: { template: "drawn" },
  }),
  // Carved from a pumpkin at a workbench, and lit after dark.
  jack_o_lantern: entry({
    name: "Jack-o'-lantern",
    plural: "Jack-o'-lanterns",
    family: "furniture",
    role: "furniture",
    recipe: { station: "workbench", needs: { pumpkin: 1 } },
    look: { template: "drawn" },
  }),
  // Pomegranates: seeds sold all year, and jam from the jam family recipe.
  ...fruit("pomegranate", {
    name: "Pomegranate",
    plural: "Pomegranates",
    days: 4,
    yield: 3,
    seedsBack: 1,
    seedPrice: 4,
    look: {
      template: "produce",
      shape: "round",
      top: "crown",
      body: "#b8323f",
      detail: "#7a1f2b",
      jam: { fill: "#8f1d36", cloth: "#a98bd8" },
    },
  }),
  // Finds (RFC 0021): rarer things lying on the ground, by biome, a few only in their season.
  acorn: find("Acorn", "Acorns", "forest_find"),
  pinecone: find("Pinecone", "Pinecones", "forest_find"),
  mushroom: find("Mushroom", "Mushrooms", "forest_find"),
  feather: find("Feather", "Feathers", "forest_find"),
  chestnut: find("Chestnut", "Chestnuts", "forest_find"),
  holly: find("Sprig of holly", "Sprigs of holly", "forest_find"),
  seashell: find("Seashell", "Seashells", "shore_find"),
  driftwood: find("Driftwood", "Driftwood", "shore_find"),
  sea_glass: find("Sea glass", "Sea glass", "shore_find"),
  starfish: find("Starfish", "Starfish", "shore_find"),
  crystal: find("Crystal", "Crystals", "stone_find"),
  fossil: find("Fossil", "Fossils", "stone_find"),
  geode: find("Geode", "Geodes", "stone_find"),
  four_leaf_clover: find("Four-leaf clover", "Four-leaf clovers", "meadow_find"),
  maple_leaf: find("Maple leaf", "Maple leaves", "meadow_find"),
  cherry_blossom: find("Cherry blossom", "Cherry blossoms", "meadow_find"),
  // Halloween (RFC 0022): candy to hand out at your door, and spooky, cozy decor, all sold only
  // while Halloween runs. Candy is made at a kitchen any day, five from a pumpkin and a bag of
  // sugar. Decision 0107 has the numbers.
  candy: entry({
    name: "Candy",
    plural: "Candies",
    family: "sweets",
    role: "sweet",
    shop: { price: 2, holiday: "halloween" },
    recipe: { station: "kitchen", needs: { pumpkin: 1, sugar: 1 }, makes: 5 },
    look: { template: "drawn" },
  }),
  bat_bunting: entry({
    name: "Bat bunting",
    plural: "Strings of bat bunting",
    family: "decor",
    role: "decor",
    shop: { price: 12, holiday: "halloween" },
    look: { template: "drawn" },
  }),
  cauldron: entry({
    name: "Cauldron",
    plural: "Cauldrons",
    family: "decor",
    role: "decor",
    shop: { price: 30, holiday: "halloween" },
    look: { template: "drawn" },
  }),
  // Left by the door, it hands out its owner's candy to trick-or-treaters while they're away.
  candy_bowl: entry({
    name: "Candy bowl",
    plural: "Candy bowls",
    family: "decor",
    role: "decor",
    shop: { price: 15, holiday: "halloween" },
    look: { template: "drawn" },
  }),
  // Winter (RFC 0017): cranberries, which like cold ground, with seeds sold December to February;
  // their jam from the jam family recipe and hot punch from the kitchen; and the shop's winter
  // decor. Decision 0124 has the numbers.
  ...fruit("cranberry", {
    name: "Cranberry",
    plural: "Cranberries",
    days: 4,
    yield: 3,
    seedsBack: 1,
    seedPrice: 4,
    seedSeasons: ["winter"],
    look: {
      template: "produce",
      shape: "round",
      top: "leaf",
      body: "#a3173a",
      detail: "#6b0f27",
      jam: { fill: "#7d1432", cloth: "#5e8f52" },
    },
  }),
  cranberry_punch: entry({
    name: "Hot cranberry punch",
    plural: "Jars of hot cranberry punch",
    family: "drink",
    role: "good",
    recipe: { station: "kitchen", needs: { cranberry: 2, lemon: 1, jar: 1 } },
    look: { template: "drawn" },
  }),
  snowman: entry({
    name: "Snowman",
    plural: "Snowmen",
    family: "decor",
    role: "decor",
    shop: { price: 30, seasons: ["winter"] },
    look: { template: "drawn" },
  }),
  // A string of colored bulbs between two posts, which glow after dark.
  string_lights: entry({
    name: "String of lights",
    plural: "Strings of lights",
    family: "decor",
    role: "decor",
    shop: { price: 12, seasons: ["winter"] },
    look: { template: "drawn" },
  }),
  little_fir: entry({
    name: "Little fir",
    plural: "Little firs",
    family: "decor",
    role: "decor",
    shop: { price: 20, seasons: ["winter"] },
    look: { template: "drawn" },
  }),
  sled: entry({
    name: "Sled",
    plural: "Sleds",
    family: "decor",
    role: "decor",
    shop: { price: 25, seasons: ["winter"] },
    look: { template: "drawn" },
  }),
  // Midwinter (RFC 0022): candy canes, sold only while Midwinter runs, and made at a kitchen any
  // day, five from a bunch of herbs (the mint) and a bag of sugar. Decision 0124 has the numbers.
  candy_cane: entry({
    name: "Candy cane",
    plural: "Candy canes",
    family: "sweets",
    role: "sweet",
    shop: { price: 2, holiday: "midwinter" },
    recipe: { station: "kitchen", needs: { herb: 1, sugar: 1 }, makes: 5 },
    look: { template: "drawn" },
  }),
};

// ---------- family recipes ----------

/**
 * A recipe that takes any one kind from a family and makes a thing named after it. It adds one
 * entry per kind whose family is `from`, right after that kind, so each thing it makes is an
 * ordinary kind with an ordinary recipe everywhere: `craft` names `lemon_jam` like any recipe.
 */
export interface FamilyRecipe {
  /** What it's called on its own: "Jam". */
  label: string;
  /** What it makes from a kind is `<kind>_<suffix>`: `lemon_jam`. */
  suffix: string;
  /** The family the one kind comes from. */
  from: Family;
  /** How many of that kind it uses up. */
  count: number;
  /** What else it uses up, after that kind. */
  plus: Readonly<Record<string, number>>;
  station: Station;
  /** The family what it makes belongs to. */
  makes: Family;
  /** One of what it makes, from the name of the kind it's made from. */
  name: (kindName: string) => string;
  plural: (kindName: string) => string;
  look: (kind: string, entry: KindEntry) => KindLook;
}

/** Jam: three of one fruit, a bag of sugar, and a jar, at a kitchen. A lemon makes lemon jam. */
export const JAM = {
  label: "Jam",
  suffix: "jam",
  from: "fruit",
  count: 3,
  plus: { sugar: 1, jar: 1 },
  station: "kitchen",
  makes: "preserve",
  name: (fruitName: string) => `${fruitName} jam`,
  plural: (fruitName: string) => `Jars of ${fruitName.toLowerCase()} jam`,
  look: (fruit: string, { look }: KindEntry): KindLook => {
    if (look.template !== "produce" || !look.jam) {
      throw new Error(`${fruit} is a fruit, so its look needs the colors of its jam.`);
    }
    return { template: "jar", fill: look.jam.fill, label: fruit, cloth: look.jam.cloth };
  },
} as const satisfies FamilyRecipe;

/** Every family recipe. A new one is a decision of its own: it adds a kind for every member. */
export const FAMILY_RECIPES = [JAM] as const satisfies readonly FamilyRecipe[];

/**
 * The family recipe a name asks for: `tomato_jam` asks for jam, whether or not a tomato is a fruit.
 * Undefined when no family recipe makes things named like it.
 */
export const familyRecipeOf = (name: string): FamilyRecipe | undefined =>
  FAMILY_RECIPES.find((r) => name.length > r.suffix.length + 1 && name.endsWith(`_${r.suffix}`));

// ---------- the catalog ----------

type Written = typeof WRITTEN;
/** The written kinds whose entries match `P`. */
type With<P> = { [K in keyof Written]: Written[K] extends P ? K : never }[keyof Written] & string;
/** What a family recipe makes, by type: `lemon_jam` from the jam recipe and a lemon. */
type MadeBy<R> = R extends { from: infer F; suffix: infer S extends string }
  ? `${With<{ family: F }>}_${S}`
  : never;
type FamilyMade = MadeBy<(typeof FAMILY_RECIPES)[number]>;

export type ItemKind = (keyof Written & string) | FamilyMade;
export type SeedKind = With<{ role: "seed" }>;
export type ProduceKind = With<{ role: "produce" }>;
export type Crop = With<{ crop: CropNumbers }>;
export type StapleKind = With<{ role: "staple" }>;
export type ResourceKind = With<{ role: "resource" }>;
export type DecorKind = With<{ role: "decor" }>;
export type FurnitureKind = With<{ role: "furniture" }>;
export type GoodKind = With<{ role: "good" }> | FamilyMade;
export type PieceKind = With<{ role: "piece" }>;
export type FindKind = With<{ role: "find" }>;
export type SweetKind = With<{ role: "sweet" }>;
export type StackKind =
  | SeedKind
  | ProduceKind
  | StapleKind
  | ResourceKind
  | DecorKind
  | FurnitureKind
  | FindKind
  | SweetKind;
export type MadeKind = GoodKind | PieceKind;

/** What a family recipe makes from one kind in its family. */
function made(recipe: FamilyRecipe, kind: string, member: KindEntry): KindEntry {
  return {
    name: recipe.name(member.name),
    plural: recipe.plural(member.name),
    family: recipe.makes,
    role: "good",
    recipe: { station: recipe.station, needs: { [kind]: recipe.count, ...recipe.plus } },
    look: recipe.look(kind, member),
  };
}

/** The written entries, each followed by what family recipes make from it. */
function build(): Readonly<Record<ItemKind, KindEntry>> {
  const all: Record<string, KindEntry> = {};
  const add = (kind: string, e: KindEntry) => {
    if (Object.hasOwn(all, kind)) throw new Error(`The catalog has two entries for ${kind}.`);
    all[kind] = e;
  };
  for (const [kind, e] of Object.entries(WRITTEN) as [string, KindEntry][]) {
    add(kind, e);
    for (const recipe of FAMILY_RECIPES) {
      if (e.family === recipe.from) add(`${kind}_${recipe.suffix}`, made(recipe, kind, e));
    }
  }
  return all as Record<ItemKind, KindEntry>;
}

/** Every kind of thing, by id, in catalog order. */
export const CATALOG = build();

// ---------- views ----------

const KINDS = Object.keys(CATALOG) as ItemKind[];
const withRole = (role: Role) => KINDS.filter((kind) => CATALOG[kind].role === role);

/** The kinds in a family itself, not in the families under it, in catalog order. */
export const kindsIn = (family: Family): ItemKind[] =>
  KINDS.filter((kind) => CATALOG[kind].family === family);

/**
 * What to tell someone who asks a family recipe of a kind outside its family, like `tomato_jam`:
 * the kinds it takes. Undefined when the name is a kind, or asks no family recipe.
 */
export function familyRecipeMiss(name: string): string | undefined {
  const recipe = familyRecipeOf(name);
  if (!recipe || Object.hasOwn(CATALOG, name)) return undefined;
  const made = kindsIn(recipe.from).map((kind) => `${kind}_${recipe.suffix}`);
  const from = FAMILIES[recipe.from].name.toLowerCase();
  return `${recipe.label} is made from one kind of ${from} at a time. Try one of: ${made.join(", ")}.`;
}

export const SEED_KINDS = withRole("seed") as readonly SeedKind[];
export const PRODUCE_KINDS = withRole("produce") as readonly ProduceKind[];
/** What grows in a planter. Each has a seed kind that grows it. */
export const CROPS = KINDS.filter((kind) => CATALOG[kind].crop) as readonly Crop[];
export const STAPLE_KINDS = withRole("staple") as readonly StapleKind[];
export const RESOURCE_KINDS = withRole("resource") as readonly ResourceKind[];
export const DECOR_KINDS = withRole("decor") as readonly DecorKind[];
export const FURNITURE_KINDS = withRole("furniture") as readonly FurnitureKind[];
/** Finds (RFC 0021): picked up where they lie, by biome and season. */
export const FIND_KINDS = withRole("find") as readonly FindKind[];
/** Sweets (RFC 0022): made at a kitchen like a good, but they stack, to hand out. */
export const SWEET_KINDS = withRole("sweet") as readonly SweetKind[];
/**
 * Things that stack: you hold a count of each, not separate items. Finds and then sweets came
 * last, after every role that shipped before them, so no kind that shipped earlier moves.
 */
export const STACK_KINDS: readonly StackKind[] = [
  ...SEED_KINDS,
  ...PRODUCE_KINDS,
  ...STAPLE_KINDS,
  ...RESOURCE_KINDS,
  ...DECOR_KINDS,
  ...FURNITURE_KINDS,
  ...FIND_KINDS,
  ...SWEET_KINDS,
];
/** Made things with a recipe. Each one is its own item with an id, its maker, and its made day. */
export const GOOD_KINDS = withRole("good") as readonly GoodKind[];
export const PIECE_KINDS = withRole("piece") as readonly PieceKind[];
/** Everything that's its own item with an id and a maker: made goods and pieces. */
export const MADE_KINDS: readonly MadeKind[] = [...GOOD_KINDS, ...PIECE_KINDS];
export const ITEM_KINDS: readonly ItemKind[] = [...STACK_KINDS, ...MADE_KINDS];

export type ItemCategory =
  | "seed"
  | "produce"
  | "staple"
  | "resource"
  | "good"
  | "decor"
  | "furniture"
  | "find"
  | "sweet";

export interface ItemInfo {
  /** One of it, in plain words. */
  name: string;
  /** More than one. */
  plural: string;
  category: ItemCategory;
}

export const ITEM_INFO = Object.fromEntries(
  ITEM_KINDS.map((kind) => {
    const { name, plural, role } = CATALOG[kind];
    return [kind, { name, plural, category: role === "piece" ? "good" : role }];
  }),
) as Readonly<Record<ItemKind, ItemInfo>>;

export interface CropInfo {
  seed: SeedKind;
  /** Days from planting to ready. Planted on day D, it's ready when day D + days starts. */
  days: number;
  /** Produce a harvest gives. */
  yield: number;
  /** Seeds a harvest gives back, so a garden keeps going. */
  seeds: number;
}

export const CROP_INFO = Object.fromEntries(
  CROPS.map((kind) => {
    const { days, yield: harvest, seedsBack } = CATALOG[kind].crop as CropNumbers;
    const seed = SEED_KINDS.find((s) => CATALOG[s].grows === kind);
    return [kind, { seed, days, yield: harvest, seeds: seedsBack }];
  }),
) as Readonly<Record<Crop, CropInfo>>;

/**
 * How a made thing is made: at a station, using up what it needs, in this order. A sweet's says how
 * many one craft makes (`makes`); everything else makes one.
 */
export interface Recipe {
  station: Station;
  needs: Readonly<Partial<Record<StackKind, number>>>;
  makes?: number;
}

/** One recipe per made good, named after what it makes. */
export const RECIPES = Object.fromEntries(
  GOOD_KINDS.map((kind) => [kind, CATALOG[kind].recipe]),
) as Readonly<Record<GoodKind, Recipe>>;

/** One recipe per piece of furniture, named after what it makes. */
export const FURNITURE_RECIPES = Object.fromEntries(
  FURNITURE_KINDS.map((kind) => [kind, CATALOG[kind].recipe]),
) as Readonly<Record<FurnitureKind, Recipe>>;

/** One recipe per sweet, named after what it makes, with how many one craft makes. */
export const SWEET_RECIPES = Object.fromEntries(
  SWEET_KINDS.map((kind) => [kind, CATALOG[kind].recipe]),
) as Readonly<Record<SweetKind, Recipe>>;

/**
 * What the town shop sells in one season only, every day of it. Everything else it sells, it sells
 * all year.
 */
const soldIn = (season: Season) =>
  STACK_KINDS.filter((kind) => CATALOG[kind].shop?.seasons?.includes(season));
export const SEASON_STOCK: Readonly<Record<Season, readonly StackKind[]>> = {
  spring: soldIn("spring"),
  summer: soldIn("summer"),
  autumn: soldIn("autumn"),
  winter: soldIn("winter"),
};

/**
 * What the town shop sells only while a holiday runs (RFC 0022). The shop adds the holiday's wear
 * (`HOLIDAY_STOCK` in `shop.ts`).
 */
export const holidayKinds = (holiday: Holiday): StackKind[] =>
  STACK_KINDS.filter((kind) => CATALOG[kind].shop?.holiday === holiday);

// ---------- frozen lists ----------

/*
 * Lists that rules walk, frozen by name. Old logs replayed through exactly these kinds in exactly
 * this order, so a kind never joins one by being added to the catalog. A kind joins a rule like
 * these only through a new logged input. Where finds lie is one more, `FIND_SPAWNS` in `gather.ts`.
 */

/** The seeds a first pantry brings, `ITEMS.starterSeeds` of each. */
export const STARTER_SEEDS = [
  "lemon_seed",
  "strawberry_seed",
  "tomato_seed",
  "herb_seed",
  "flower_seed",
] as const satisfies readonly SeedKind[];

/** What the daily pantry tops up, in this order. */
export const PANTRY_STAPLES = ["sugar", "jar"] as const satisfies readonly StapleKind[];
export type PantryStaple = (typeof PANTRY_STAPLES)[number];

/** The made things the town's daily rotation (`townBuys`) cycles through, in this order. */
export const ROTATION_GOODS = [
  "lemon_jam",
  "strawberry_jam",
  "lemonade",
  "tomato_sauce",
  "herb_tea",
  "bouquet",
  "herb_sachet",
  "flower_wreath",
] as const satisfies readonly GoodKind[];

/** The crops the town's daily rotation cycles through, in this order. */
export const ROTATION_CROPS = [
  "lemon",
  "strawberry",
  "tomato",
  "herb",
  "flower",
] as const satisfies readonly Crop[];
