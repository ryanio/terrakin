import { isWhole, refuse } from "./check";
import { isTownsfolk, pairSkipsCaps } from "./economy";
import { tileKey } from "./keys";
import {
  type Command,
  DECOR_BLOCKS,
  type DecorBlock,
  type GiftRecord,
  type Good,
  type Inventory,
  type InventoryReason,
  type ItemsState,
  type ItemsToday,
  type Rejection,
  type ResidentId,
  type Tile,
  type WorldEvent,
  type WorldState,
} from "./types";
import { canBuildOn, chebyshev, inBounds, plotAtTile } from "./world";

/**
 * Growing, making, and giving (RFC 0005, step 2): the item catalog as data, inventories, planters,
 * crafting at stations, the daily pantry, and `give`.
 *
 * Nothing here runs until the server sends `open_items`, so worlds from before items replay to the
 * hash they always had. Growth reads only `state.day`, which moves only at `new_day`: a crop is
 * ready once the day reaches its `readyDay`, so skipped days count like any other.
 */

// ---------- the catalog ----------

/** What grows in a planter. Each has a seed kind (`lemon_seed`) and a produce kind (`lemon`). */
export const CROPS = ["lemon", "strawberry", "tomato", "herb", "flower"] as const;
export type Crop = (typeof CROPS)[number];

export const SEED_KINDS = [
  "lemon_seed",
  "strawberry_seed",
  "tomato_seed",
  "herb_seed",
  "flower_seed",
] as const;
export type SeedKind = (typeof SEED_KINDS)[number];

/** The kitchen's basics, from the daily pantry. */
export const STAPLE_KINDS = ["sugar", "jar"] as const;
export type StapleKind = (typeof STAPLE_KINDS)[number];

/** Fallen branches and loose stones, picked up with `gather`. */
export const RESOURCE_KINDS = ["wood", "stone"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Decor from the town shop, held until you place it (RFC 0008). Same names as the blocks. */
export const DECOR_KINDS = DECOR_BLOCKS;
export type DecorKind = DecorBlock;

/** Things that stack: you hold a count of each, not separate items. */
export const STACK_KINDS = [
  ...SEED_KINDS,
  ...CROPS,
  ...STAPLE_KINDS,
  ...RESOURCE_KINDS,
  ...DECOR_KINDS,
] as const;
export type StackKind = (typeof STACK_KINDS)[number];

/** Made things. Each one is its own item with an id, its maker, and the day it was made. */
export const GOOD_KINDS = [
  "lemon_jam",
  "strawberry_jam",
  "lemonade",
  "tomato_sauce",
  "herb_tea",
  "bouquet",
  "herb_sachet",
  "flower_wreath",
] as const;
export type GoodKind = (typeof GOOD_KINDS)[number];

/**
 * A piece of art (RFC 0005 step 3): made with `make_piece` from your own upload, not from a recipe.
 * Kept apart from `GOOD_KINDS`, whose length sets the town's daily buy rotation.
 */
export const PIECE_KINDS = ["piece"] as const;
export type PieceKind = (typeof PIECE_KINDS)[number];

/** Everything that's its own item with an id and a maker: made goods and pieces. */
export const MADE_KINDS = [...GOOD_KINDS, ...PIECE_KINDS] as const;
export type MadeKind = (typeof MADE_KINDS)[number];

export const ITEM_KINDS = [...STACK_KINDS, ...MADE_KINDS] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type ItemCategory = "seed" | "produce" | "staple" | "resource" | "good" | "decor";

export interface ItemInfo {
  /** One of it, in plain words. */
  name: string;
  /** More than one. */
  plural: string;
  category: ItemCategory;
}

export const ITEM_INFO: Record<ItemKind, ItemInfo> = {
  lemon_seed: { name: "Lemon seed", plural: "Lemon seeds", category: "seed" },
  strawberry_seed: { name: "Strawberry seed", plural: "Strawberry seeds", category: "seed" },
  tomato_seed: { name: "Tomato seed", plural: "Tomato seeds", category: "seed" },
  herb_seed: { name: "Herb seed", plural: "Herb seeds", category: "seed" },
  flower_seed: { name: "Flower seed", plural: "Flower seeds", category: "seed" },
  lemon: { name: "Lemon", plural: "Lemons", category: "produce" },
  strawberry: { name: "Strawberry", plural: "Strawberries", category: "produce" },
  tomato: { name: "Tomato", plural: "Tomatoes", category: "produce" },
  herb: { name: "Bunch of herbs", plural: "Bunches of herbs", category: "produce" },
  flower: { name: "Flower", plural: "Flowers", category: "produce" },
  sugar: { name: "Bag of sugar", plural: "Bags of sugar", category: "staple" },
  jar: { name: "Jar", plural: "Jars", category: "staple" },
  wood: { name: "Wood", plural: "Wood", category: "resource" },
  stone: { name: "Stone", plural: "Stone", category: "resource" },
  lantern: { name: "Paper lantern", plural: "Paper lanterns", category: "decor" },
  frame: { name: "Picture frame", plural: "Picture frames", category: "decor" },
  fence: { name: "Fence post", plural: "Fence posts", category: "decor" },
  bench: { name: "Garden bench", plural: "Garden benches", category: "decor" },
  lemon_jam: { name: "Lemon jam", plural: "Jars of lemon jam", category: "good" },
  strawberry_jam: { name: "Strawberry jam", plural: "Jars of strawberry jam", category: "good" },
  lemonade: { name: "Lemonade", plural: "Jars of lemonade", category: "good" },
  tomato_sauce: { name: "Tomato sauce", plural: "Jars of tomato sauce", category: "good" },
  herb_tea: { name: "Herb tea", plural: "Jars of herb tea", category: "good" },
  bouquet: { name: "Bouquet", plural: "Bouquets", category: "good" },
  herb_sachet: { name: "Herb sachet", plural: "Herb sachets", category: "good" },
  flower_wreath: { name: "Flower wreath", plural: "Flower wreaths", category: "good" },
  piece: { name: "Piece of art", plural: "Pieces of art", category: "good" },
};

export interface CropInfo {
  seed: SeedKind;
  /** Days from planting to ready. Planted on day D, it's ready when day D + days starts. */
  days: number;
  /** Produce a harvest gives. */
  yield: number;
  /** Seeds a harvest gives back, so a garden keeps going. */
  seeds: number;
}

export const CROP_INFO: Record<Crop, CropInfo> = {
  lemon: { seed: "lemon_seed", days: 4, yield: 3, seeds: 1 },
  strawberry: { seed: "strawberry_seed", days: 3, yield: 4, seeds: 1 },
  tomato: { seed: "tomato_seed", days: 3, yield: 3, seeds: 1 },
  herb: { seed: "herb_seed", days: 2, yield: 3, seeds: 1 },
  flower: { seed: "flower_seed", days: 2, yield: 3, seeds: 1 },
};

/** Block kinds you craft at. `craft` names the station's tile. */
export const STATIONS = ["kitchen", "workbench"] as const;
export type Station = (typeof STATIONS)[number];

export interface Recipe {
  station: Station;
  /** What it uses up. */
  needs: Partial<Record<StackKind, number>>;
}

/** One recipe per made thing, named after what it makes. */
export const RECIPES: Record<GoodKind, Recipe> = {
  lemon_jam: { station: "kitchen", needs: { lemon: 3, sugar: 1, jar: 1 } },
  strawberry_jam: { station: "kitchen", needs: { strawberry: 3, sugar: 1, jar: 1 } },
  lemonade: { station: "kitchen", needs: { lemon: 2, sugar: 1, jar: 1 } },
  tomato_sauce: { station: "kitchen", needs: { tomato: 3, herb: 1, jar: 1 } },
  herb_tea: { station: "kitchen", needs: { herb: 2, jar: 1 } },
  bouquet: { station: "workbench", needs: { flower: 3 } },
  herb_sachet: { station: "workbench", needs: { herb: 2, flower: 1 } },
  flower_wreath: { station: "workbench", needs: { flower: 4, herb: 2 } },
};

/**
 * The numbers. Every count is a whole number of items. Decision 0051 has the reasoning.
 */
export const ITEMS = {
  /** The most things one resident can hold: every unit of a stack counts, and every made thing. */
  inventoryMax: 200,
  /** What the pantry gives each UTC day, the first time you're at your hearth. */
  pantry: { sugar: 2, jar: 2 } as Readonly<Record<StapleKind, number>>,
  /** The pantry stops topping up a staple once you hold this many. */
  stapleMax: 10,
  /**
   * The pantry once the town shop is open (`open_shop`), which sells sugar and jars: decision
   * 0052. Before it opens, `pantry` and `stapleMax` above, so older logs replay as they did.
   */
  shopPantry: { sugar: 1, jar: 1 } as Readonly<Record<StapleKind, number>>,
  shopStapleMax: 6,
  /** With your very first pantry: this many of every seed. */
  starterSeeds: 2,
  /** Things you can make in a UTC day. */
  craftPerDay: 20,
  /** Things you can give in a UTC day (a person and their AI don't count, from the day after they link). */
  giveCap: 20,
  /** Things you can receive in gifts in a UTC day. */
  receiveCap: 50,
  /** The most of one kind in a single `give`. */
  giveCountMax: 20,
  /** A made thing's label, in characters. Untrusted text. */
  labelMax: 40,
  /** A gift's note, in characters. Untrusted text. */
  noteMax: 140,
  /**
   * Days a gift can be sent back with `decline_gift`, counting the day it was given: one given on
   * day D can be sent back until day D + 6 ends.
   */
  declineDays: 7,
} as const;

/** A made thing's id: `i_` and a number from the world's counter. */
export const ITEM_ID_PATTERN = /^i_[1-9][0-9]*$/;

/** A gift's id: `gift_` and a number from the gifts' counter. */
export const GIFT_ID_PATTERN = /^gift_[1-9][0-9]*$/;

export const isItemKind = (k: unknown): k is ItemKind =>
  typeof k === "string" && (ITEM_KINDS as readonly string[]).includes(k);
export const isStackKind = (k: unknown): k is StackKind =>
  typeof k === "string" && (STACK_KINDS as readonly string[]).includes(k);
export const isGoodKind = (k: unknown): k is GoodKind =>
  typeof k === "string" && (GOOD_KINDS as readonly string[]).includes(k);
/** A made good or a piece: its own item with an id. */
export const isMadeKind = (k: unknown): k is MadeKind =>
  typeof k === "string" && (MADE_KINDS as readonly string[]).includes(k);
export const isDecorKind = (k: unknown): k is DecorKind =>
  typeof k === "string" && (DECOR_KINDS as readonly string[]).includes(k);
export const isCrop = (k: unknown): k is Crop =>
  typeof k === "string" && (CROPS as readonly string[]).includes(k);
export const isResourceKind = (k: unknown): k is ResourceKind =>
  typeof k === "string" && (RESOURCE_KINDS as readonly string[]).includes(k);

/** "1 lemon", "3 lemons", in plain words. */
export function countOf(kind: ItemKind, n: number): string {
  const info = ITEM_INFO[kind];
  return `${n} ${(n === 1 ? info.name : info.plural).toLowerCase()}`;
}

// ---------- reading ----------

/** How many units a resident holds: every stacked unit plus every made thing. */
export function inventorySize(inv: Inventory | undefined): number {
  if (!inv) return 0;
  let n = inv.goods.length;
  for (const count of Object.values(inv.stacks)) n += count ?? 0;
  return n;
}

/** How many of a stack a resident holds. */
export const held = (inv: Inventory | undefined, kind: StackKind) => inv?.stacks[kind] ?? 0;

/** A crop's state on a given day. */
export const isReady = (readyDay: number, day: number | undefined) =>
  day !== undefined && day >= readyDay;

/** Whether a crop's harvest (its yield and its seeds back) fits next to `held` things. */
export const harvestFits = (held: number, crop: Crop) =>
  held + CROP_INFO[crop].yield + CROP_INFO[crop].seeds <= ITEMS.inventoryMax;

/** What `GET /v1/inventory` shows a resident. Private to them. */
export interface InventoryRead {
  stacks: { kind: StackKind; count: number }[];
  goods: Good[];
  size: number;
  pantryToday: boolean;
  givenToday: number;
  receivedToday: number;
  craftedToday: number;
  /** Gifts to this resident they can still send back whole, newest first. */
  gifts: GiftRecord[];
}

/** The last day a gift given on `day` can be sent back. */
export const lastDeclineDay = (day: number) => day + ITEMS.declineDays - 1;

/** A resident's inventory, or null before items open. */
export function inventoryOf(state: WorldState, id: ResidentId): InventoryRead | null {
  const items = state.items;
  if (!items) return null;
  const inv = items.inventories[id];
  return {
    stacks: STACK_KINDS.flatMap((kind) => {
      const count = held(inv, kind);
      return count > 0 ? [{ kind, count }] : [];
    }),
    goods: (inv?.goods ?? []).map((g) => ({ ...g })),
    size: inventorySize(inv),
    pantryToday: state.day !== undefined && items.pantry[id] === state.day,
    givenToday: items.today.given[id] ?? 0,
    receivedToday: items.today.received[id] ?? 0,
    craftedToday: items.today.crafted[id] ?? 0,
    gifts: Object.values(items.gifts ?? {})
      .filter((g) => g.to === id && holdsWhole(inv, g))
      .sort((a, b) => giftNumber(b.id) - giftNumber(a.id))
      .map((g) => ({ ...g, ...(g.goods ? { goods: [...g.goods] } : {}) })),
  };
}

const giftNumber = (id: string) => Number(id.slice("gift_".length));

/** Whether a resident still holds all of a gift, so it could go back. */
function holdsWhole(inv: Inventory | undefined, gift: GiftRecord): boolean {
  if (isStackKind(gift.kind)) return held(inv, gift.kind) >= gift.count;
  const ids = gift.goods ?? [];
  return ids.every((id) => inv?.goods.some((g) => g.id === id));
}

// ---------- changing ----------

type Mutation = () => WorldEvent[];
export type ItemsChecked = Mutation | Rejection;

const emptyToday = (): ItemsToday => ({ given: {}, received: {}, crafted: {} });

/** One stack's change in an `inventory` event: signed `amount`, and the `count` held after it. */
interface StackChange {
  kind: StackKind;
  amount: number;
  count: number;
}

/** A resident's inventory, made empty on first use. Call only when committing. */
export function inventory(items: ItemsState, id: ResidentId): Inventory {
  let inv = items.inventories[id];
  if (!inv) {
    inv = { stacks: {}, goods: [] };
    items.inventories[id] = inv;
  }
  return inv;
}

/** Add (or with a negative amount, take) units of a stack. A stack at 0 is dropped. */
export function addStack(inv: Inventory, kind: StackKind, amount: number): StackChange {
  const count = (inv.stacks[kind] ?? 0) + amount;
  if (count === 0) delete inv.stacks[kind];
  else inv.stacks[kind] = count;
  return { kind, amount, count };
}

/** The private event for one resident's inventory change. Absent parts stay absent. */
export function inventoryEvent(
  id: ResidentId,
  reason: InventoryReason,
  changes: StackChange[],
  extra: {
    gained?: Good[];
    lost?: string[];
    with?: ResidentId;
    note?: string;
    gift?: string;
  } = {},
): WorldEvent {
  return {
    type: "inventory",
    residentId: id,
    reason,
    ...(changes.length > 0 ? { changes } : {}),
    ...(extra.gained?.length ? { gained: extra.gained.map((g) => ({ ...g })) } : {}),
    ...(extra.lost?.length ? { lost: [...extra.lost] } : {}),
    ...(extra.with === undefined ? {} : { with: extra.with }),
    ...(extra.note ? { note: extra.note } : {}),
    ...(extra.gift ? { gift: extra.gift } : {}),
  };
}

/** The checks every item command shares: items open and the world counting days. */
export function closed(state: WorldState): Rejection | null {
  if (!state.items || state.day === undefined) {
    return refuse(
      "items_closed",
      "Growing, making, and gathering haven't opened in this world yet.",
    );
  }
  return null;
}

/** Whether a tile is within a resident's reach, or how to get there. */
export function reachProblem(state: WorldState, me: Tile, at: Tile): Rejection | null {
  const { config } = state;
  if (!isWhole(at.x) || !isWhole(at.y) || !inBounds(config, at.x, at.y)) {
    return refuse("out_of_bounds", "That's outside the world.");
  }
  if (chebyshev(me, at) > config.reach) {
    return refuse(
      "out_of_reach",
      `That's more than ${config.reach} tiles away. Walk closer first.`,
    );
  }
  return null;
}

// ---------- server input ----------

/** `open_items`, which only TOWN_ACTOR sends. */
export function checkOpenItems(state: WorldState): ItemsChecked {
  if (state.items)
    return refuse("already_open", "Growing, making, and gathering are already open.");
  if (state.day === undefined) {
    return refuse(
      "not_due",
      "Growing, making, and gathering open once the world starts counting days.",
    );
  }
  return () => {
    state.items = {
      nextId: 1,
      inventories: {},
      crops: {},
      pantry: {},
      today: emptyToday(),
    };
    return [{ type: "items_opened" }];
  };
}

/**
 * What `new_day` does to items, or null before they open: the day's give, receive, and craft
 * counters start over. Crops need nothing: one is ready once the day reaches its `readyDay`.
 */
export function itemsNewDay(state: WorldState): Mutation | null {
  const items = state.items;
  if (!items) return null;
  return () => {
    items.today = emptyToday();
    // Gifts past their last day to send back are forgotten, and so are yesterday's pickups:
    // each tile grows at most one back a day. `state.day` is the new day by now.
    const day = state.day;
    if (items.gifts && day !== undefined) {
      for (const [id, gift] of Object.entries(items.gifts)) {
        if (lastDeclineDay(gift.day) < day) delete items.gifts[id];
      }
    }
    if (items.gathered && day !== undefined) {
      for (const [key, d] of Object.entries(items.gathered)) {
        if (d < day) delete items.gathered[key];
      }
    }
    return [];
  };
}

/** `open_gifts`, which only TOWN_ACTOR sends: from now on, gifts can be sent back. */
export function checkOpenGifts(state: WorldState): ItemsChecked {
  const items = state.items;
  if (!items)
    return refuse(
      "items_closed",
      "Growing, making, and gathering haven't opened in this world yet.",
    );
  if (items.gifts) return refuse("already_open", "Gifts can already be sent back.");
  return () => {
    items.gifts = {};
    items.nextGift = 1;
    return [{ type: "gifts_opened" }];
  };
}

// ---------- planting and harvesting ----------

/** `plant {x, y, seed}`: one of your seeds into an empty planter on a plot you can build on. */
export function checkPlant(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "plant" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  const { x, y, seed: crop } = command;
  if (!isCrop(crop)) {
    return refuse("unknown_item", `Plant one of: ${CROPS.join(", ")}.`);
  }
  const far = reachProblem(state, me, { x, y });
  if (far) return far;
  if (!canBuildOn(plotAtTile(state, x, y), actor)) {
    return refuse("not_your_plot", "You can only plant on your own plot, or one shared with you.");
  }
  const key = tileKey(x, y);
  if (state.blocks[key] !== "planter") {
    return refuse("no_planter", "Plant in a planter. Place one with place and block planter.");
  }
  if (items.crops[key]) return refuse("tile_occupied", "Something is already growing there.");
  const info = CROP_INFO[crop];
  const inv = items.inventories[actor];
  if (held(inv, info.seed) < 1) {
    return refuse("not_enough_items", `You have no ${ITEM_INFO[info.seed].plural.toLowerCase()}.`);
  }
  const readyDay = day + info.days;
  return () => {
    items.crops[key] = { crop, by: actor, plantedDay: day, readyDay };
    const change = addStack(inventory(items, actor), info.seed, -1);
    return [
      { type: "planted", x, y, crop, by: actor, plantedDay: day, readyDay },
      inventoryEvent(actor, "plant", [change]),
    ];
  };
}

/** `harvest {x, y}`: a ready crop on a plot you can build on, into your inventory. */
export function checkHarvest(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "harvest" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  const { x, y } = command;
  const far = reachProblem(state, me, { x, y });
  if (far) return far;
  if (!canBuildOn(plotAtTile(state, x, y), actor)) {
    return refuse(
      "not_your_plot",
      "You can only harvest on your own plot, or one shared with you.",
    );
  }
  const key = tileKey(x, y);
  const planting = items.crops[key];
  if (!planting) return refuse("no_crop", "Nothing is growing there.");
  if (!isReady(planting.readyDay, day)) {
    const wait = planting.readyDay - day;
    return refuse(
      "not_ready",
      `It isn't ready yet. It will be in ${wait === 1 ? "1 day" : `${wait} days`}, once day ${planting.readyDay} starts (midnight UTC).`,
    );
  }
  const info = CROP_INFO[planting.crop];
  if (!harvestFits(inventorySize(items.inventories[actor]), planting.crop)) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things, and this harvest needs room for ${info.yield + info.seeds}. Make or give something first.`,
    );
  }
  const { crop } = planting;
  return () => {
    delete items.crops[key];
    const mine = inventory(items, actor);
    const changes = [addStack(mine, crop, info.yield)];
    if (info.seeds > 0) changes.push(addStack(mine, info.seed, info.seeds));
    return [
      { type: "harvested", x, y, crop, by: actor },
      inventoryEvent(actor, "harvest", changes),
    ];
  };
}

/** Whether removing the block on a tile is held up by a crop growing in it. */
export const cropAt = (state: WorldState, x: number, y: number) =>
  state.items?.crops[tileKey(x, y)];

// ---------- crafting ----------

/** `craft {recipe, x, y, label?}` at the right station within reach. */
export function checkCraft(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "craft" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  const { recipe, x, y, label } = command;
  if (!isGoodKind(recipe)) {
    return refuse(
      "unknown_item",
      `There's no recipe for that. Try one of: ${GOOD_KINDS.join(", ")}.`,
    );
  }
  if (label !== undefined && (typeof label !== "string" || label.length > ITEMS.labelMax)) {
    return refuse("invalid_label", `A label is text, at most ${ITEMS.labelMax} characters.`);
  }
  const far = reachProblem(state, me, { x, y });
  if (far) return far;
  const { station, needs } = RECIPES[recipe];
  if (state.blocks[tileKey(x, y)] !== station) {
    return refuse(
      "no_station",
      `${ITEM_INFO[recipe].name} is made at a ${station}. Place one with place and block ${station}, or use one nearby.`,
    );
  }
  const crafted = items.today.crafted[actor] ?? 0;
  if (crafted >= ITEMS.craftPerDay) {
    return refuse("craft_limit", `You can make ${ITEMS.craftPerDay} things a day. Try tomorrow.`);
  }
  const inv = items.inventories[actor];
  const missing = (Object.entries(needs) as [StackKind, number][])
    .filter(([kind, n]) => held(inv, kind) < n)
    .map(([kind, n]) => countOf(kind, n - held(inv, kind)));
  if (missing.length > 0) {
    return refuse("not_enough_items", `You need ${missing.join(", ")} more.`);
  }
  const id = `i_${items.nextId}`;
  const good: Good = {
    id,
    kind: recipe,
    maker: actor,
    madeDay: day,
    ...(typeof label === "string" && label !== "" ? { label } : {}),
  };
  return () => {
    items.nextId += 1;
    items.today.crafted[actor] = crafted + 1;
    const mine = inventory(items, actor);
    const changes = (Object.entries(needs) as [StackKind, number][]).map(([kind, n]) =>
      addStack(mine, kind, -n),
    );
    mine.goods.push(good);
    return [inventoryEvent(actor, "craft", changes, { gained: [good] })];
  };
}

// ---------- giving ----------

/**
 * `give {item, to, count?, note?}`. `item` is a made thing's id (`i_12`) or a kind: a stack
 * (`lemon`, `count` of them) or a made kind (`lemon_jam`, your oldest `count` of them).
 */
export function checkGiveItem(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "give" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const { item, to, note } = command;
  const count = command.count ?? 1;
  if (!isWhole(count) || count < 1 || count > ITEMS.giveCountMax) {
    return refuse("invalid_amount", `Give 1 to ${ITEMS.giveCountMax} at a time.`);
  }
  if (note !== undefined && (typeof note !== "string" || note.length > ITEMS.noteMax)) {
    return refuse("invalid_gift", `A note is text, at most ${ITEMS.noteMax} characters.`);
  }
  if (typeof to !== "string" || !state.residents[to]) {
    return refuse("unknown_resident", "Nobody in the world has that id.");
  }
  if (to === actor) return refuse("invalid_gift", "You can't give things to yourself.");
  const inv = items.inventories[actor];
  let kind: ItemKind;
  let goods: Good[] = [];
  if (typeof item === "string" && ITEM_ID_PATTERN.test(item)) {
    const good = inv?.goods.find((g) => g.id === item);
    if (!good) return refuse("not_enough_items", "You don't have that.");
    if (count !== 1) return refuse("invalid_amount", "An item id is one thing. Leave out count.");
    kind = good.kind;
    goods = [good];
  } else if (isMadeKind(item)) {
    kind = item;
    goods = (inv?.goods ?? []).filter((g) => g.kind === item).slice(0, count);
    if (goods.length < count) {
      return refuse("not_enough_items", `You have ${countOf(item, goods.length)}.`);
    }
  } else if (isStackKind(item)) {
    kind = item;
    if (held(inv, item) < count) {
      return refuse("not_enough_items", `You have ${countOf(item, held(inv, item))}.`);
    }
  } else {
    return refuse("unknown_item", "That isn't something you can hold. Check GET /v1/inventory.");
  }
  const paired = pairSkipsCaps(state, actor, to);
  const given = items.today.given[actor] ?? 0;
  const received = items.today.received[to] ?? 0;
  if (!paired && given + count > ITEMS.giveCap) {
    return refuse(
      "gift_limit",
      `You can give ${ITEMS.giveCap} things a day. You have ${ITEMS.giveCap - given} left to give today.`,
    );
  }
  // Like coins: refuse only once they're already at the cap, so a refusal never depends on this
  // gift's size and can't measure what they've had today.
  if (!paired && received >= ITEMS.receiveCap) {
    return refuse(
      "gift_limit",
      `A resident can receive ${ITEMS.receiveCap} things in gifts a day, and they've had that today. Try tomorrow.`,
    );
  }
  if (inventorySize(items.inventories[to]) + count > ITEMS.inventoryMax) {
    return refuse("inventory_full", "They can't hold that many more things right now.");
  }
  const withNote = typeof note === "string" && note !== "" ? { note } : {};
  const ids = goods.map((g) => g.id);
  const day = state.day as number;
  return () => {
    if (!paired) {
      items.today.given[actor] = given + count;
      items.today.received[to] = received + count;
    }
    // Once gifts can be sent back, each one is kept for a few days under its own id.
    let gift: { gift?: string } = {};
    if (items.gifts && items.nextGift !== undefined) {
      const id = `gift_${items.nextGift}`;
      items.nextGift += 1;
      items.gifts[id] = {
        id,
        from: actor,
        to,
        kind,
        count,
        ...(ids.length > 0 ? { goods: [...ids] } : {}),
        day,
      };
      gift = { gift: id };
    }
    const mine = inventory(items, actor);
    const theirs = inventory(items, to);
    if (isStackKind(kind)) {
      const out = addStack(mine, kind, -count);
      const into = addStack(theirs, kind, count);
      return [
        inventoryEvent(actor, "gift_out", [out], { with: to, ...withNote, ...gift }),
        inventoryEvent(to, "gift_in", [into], { with: actor, ...withNote, ...gift }),
        { type: "item_given", from: actor, to, kind },
      ];
    }
    mine.goods = mine.goods.filter((g) => !ids.includes(g.id));
    theirs.goods.push(...goods);
    return [
      inventoryEvent(actor, "gift_out", [], { lost: ids, with: to, ...withNote, ...gift }),
      inventoryEvent(to, "gift_in", [], { gained: goods, with: actor, ...withNote, ...gift }),
      { type: "item_given", from: actor, to, kind },
    ];
  };
}

/**
 * `decline_gift {gift}`: send a gift back to whoever gave it, while it can still be sent back and
 * you still hold all of it. It goes back whatever their daily caps say, but only if they have room:
 * a thing is never dropped on the way. Sending back is private: only the two inventories change.
 */
export function checkDeclineGift(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "decline_gift" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const record = typeof command.gift === "string" ? items.gifts?.[command.gift] : undefined;
  // Someone else's gift reads the same as one that never was.
  if (!record || record.to !== actor || lastDeclineDay(record.day) < (state.day as number)) {
    return refuse(
      "unknown_gift",
      `No gift with that id is yours to send back. Gifts can be sent back for ${ITEMS.declineDays} days; GET /v1/inventory lists yours.`,
    );
  }
  const inv = items.inventories[actor];
  const { from, kind, count } = record;
  const ids = record.goods ?? [];
  const goods = (inv?.goods ?? []).filter((g) => ids.includes(g.id));
  if (!holdsWhole(inv, record)) {
    return refuse(
      "not_enough_items",
      "You no longer have all of it, so it can't go back. Keep what's left, or give it with give.",
    );
  }
  if (inventorySize(items.inventories[from]) + count > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      "They have no room for it right now. Try again another day, or keep it.",
    );
  }
  const id = record.id;
  return () => {
    delete items.gifts?.[id];
    const mine = inventory(items, actor);
    const theirs = inventory(items, from);
    if (isStackKind(kind)) {
      const out = addStack(mine, kind, -count);
      const back = addStack(theirs, kind, count);
      return [
        inventoryEvent(actor, "declined", [out], { with: from, gift: id }),
        inventoryEvent(from, "returned", [back], { with: actor, gift: id }),
      ];
    }
    mine.goods = mine.goods.filter((g) => !ids.includes(g.id));
    theirs.goods.push(...goods);
    return [
      inventoryEvent(actor, "declined", [], { lost: ids, with: from, gift: id }),
      inventoryEvent(from, "returned", [], { gained: goods, with: actor, gift: id }),
    ];
  };
}

// ---------- the pantry: bookkeeping on residents' own inputs ----------

/** The pantry's numbers: smaller once the town shop is open, since it sells sugar and jars. */
export function pantryNumbers(state: WorldState): {
  pantry: Readonly<Record<StapleKind, number>>;
  stapleMax: number;
} {
  return state.shop
    ? { pantry: ITEMS.shopPantry, stapleMax: ITEMS.shopStapleMax }
    : { pantry: ITEMS.pantry, stapleMax: ITEMS.stapleMax };
}

/**
 * What today's pantry would add for `id`, in order: the starter seeds the first time ever, then
 * sugar and jars, never past `stapleMax` of each or `inventoryMax` in all. Empty when nothing is
 * due: items closed, no days yet, no hearth, townsfolk (like the allowance), had today, or full.
 */
function pantryAdds(state: WorldState, id: ResidentId): [StackKind, number][] {
  const items = state.items;
  if (!items || state.day === undefined || isTownsfolk(state, id)) return [];
  if (!state.residents[id]?.hearth || items.pantry[id] === state.day) return [];
  const inv = items.inventories[id];
  let room = ITEMS.inventoryMax - inventorySize(inv);
  const adds: [StackKind, number][] = [];
  const add = (kind: StackKind, want: number) => {
    const n = Math.min(want, room);
    if (n > 0) {
      adds.push([kind, n]);
      room -= n;
    }
  };
  if (items.pantry[id] === undefined) for (const seed of SEED_KINDS) add(seed, ITEMS.starterSeeds);
  const { pantry, stapleMax } = pantryNumbers(state);
  for (const staple of STAPLE_KINDS) {
    add(staple, Math.min(pantry[staple], Math.max(0, stapleMax - held(inv, staple))));
  }
  return adds;
}

/** Whether standing on their hearth would bring `id` anything from today's pantry. */
export const pantryDue = (state: WorldState, id: ResidentId) => pantryAdds(state, id).length > 0;

/**
 * After a resident's accepted input: if it leaves them on their own hearth and today's pantry
 * would add something, add it and record the day. A pantry with nothing to add records nothing,
 * so it changes no state without an event.
 */
export function payPantry(state: WorldState, id: ResidentId): WorldEvent[] {
  const items = state.items;
  const day = state.day;
  const me = state.residents[id];
  if (!items || day === undefined || !me?.hearth) return [];
  if (me.x !== me.hearth.x || me.y !== me.hearth.y) return [];
  const adds = pantryAdds(state, id);
  if (adds.length === 0) return [];
  const first = items.pantry[id] === undefined;
  items.pantry[id] = day;
  const inv = inventory(items, id);
  const changes = adds.map(([kind, n]) => addStack(inv, kind, n));
  return [inventoryEvent(id, first ? "starter" : "pantry", changes)];
}

// ---------- decor from the town shop ----------

/**
 * Whether `actor` can place a decor block: items open and one in their things. A free block is
 * always fine here. Read in `place`'s check.
 */
export function decorPlaceProblem(
  state: WorldState,
  actor: ResidentId,
  block: string,
): Rejection | null {
  if (!isDecorKind(block)) return null;
  const shut = closed(state);
  if (shut) return shut;
  if (held(state.items?.inventories[actor], block) < 1) {
    return refuse(
      "not_enough_items",
      `You have no ${ITEM_INFO[block].plural.toLowerCase()}. Buy one at the town shop with shop_buy.`,
    );
  }
  return null;
}

/** Whether `actor` has room to take a decor block back up. Read in `remove`'s check. */
export function decorRemoveProblem(
  state: WorldState,
  actor: ResidentId,
  block: string | undefined,
): Rejection | null {
  if (!isDecorKind(block)) return null;
  if (inventorySize(state.items?.inventories[actor]) + 1 > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things, and taking this up needs room for one more.`,
    );
  }
  return null;
}

/**
 * Commit side of placing or removing a block: a decor block leaves (`-1`) or comes back to (`+1`)
 * the actor's things, with its private event. Free blocks change nothing.
 */
export function moveDecor(
  state: WorldState,
  actor: ResidentId,
  block: string | undefined,
  amount: 1 | -1,
): WorldEvent[] {
  const items = state.items;
  if (!items || !isDecorKind(block)) return [];
  const change = addStack(inventory(items, actor), block, amount);
  return [inventoryEvent(actor, amount < 0 ? "placed" : "picked_up", [change])];
}
