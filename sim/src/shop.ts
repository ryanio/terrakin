import { coinCount as coins, isWhole, refuse } from "./check";
import { allowanceDue, isTownsfolk, movePurse, moveTreasury } from "./economy";
import {
  addStack,
  type Crop,
  DECOR_KINDS,
  type DecorKind,
  type GoodKind,
  held,
  ITEM_ID_PATTERN,
  ITEM_INFO,
  ITEMS,
  type ItemKind,
  inventory,
  inventoryEvent,
  inventorySize,
  isGoodKind,
  isStackKind,
  SEED_KINDS,
  type SeedKind,
  STAPLE_KINDS,
  type StackKind,
  type StapleKind,
} from "./items";
import { isShopWear, SHOP_WEAR, type ShopWear, WEAR_INFO } from "./looks";
import { dateOfDay, SEASONS, type Season, seasonOf, seasonSpan } from "./season";
import type {
  Command,
  EconomyState,
  Good,
  ItemsState,
  Rejection,
  ResidentId,
  ShopState,
  ShopToday,
  WorldEvent,
  WorldState,
} from "./types";
import { moveOff, offBuildings } from "./walk";

/**
 * The town shop (RFC 0008, phase 2): a catalog the town sells from, buy orders the town pays for,
 * `shop_buy`, and `sell_to_town`.
 *
 * Nothing here runs until the server sends `open_shop`, which needs coins and items open, so
 * worlds from before the shop replay to the hash they always had. A small share of every purchase
 * goes to the treasury and the rest is burned. What the town pays for goods is minted, and the town buys
 * only a few kinds a day, each up to a daily count per resident, so a garden can't print coins.
 */

// ---------- the catalog ----------

/** What the shop sells. A sku is the name of what you get: a stack kind or a piece of shop wear. */
export const SHOP_SKUS = [...DECOR_KINDS, ...SHOP_WEAR, ...SEED_KINDS, ...STAPLE_KINDS] as const;
export type ShopSku = DecorKind | ShopWear | SeedKind | StapleKind;

export type ShopSection = "decor" | "wear" | "garden" | "pantry";

export interface ShopEntry {
  price: number;
  section: ShopSection;
}

/**
 * The numbers. Every price is a whole number of coins. `scripts/economy-sim.ts` plays a month with
 * them, and decision 0052 has the reasoning.
 */
export const SHOP = {
  /** The most of one thing in a single `shop_buy` or `sell_to_town`. */
  countMax: 20,
  /**
   * The treasury's share of shop spending, in percent; the rest is burned. The server logs
   * `set_shop_share` when the world's share differs, so purchases before a change keep the share
   * they were made at. A world that never logged one uses `SHOP_SHARE_BEFORE`.
   */
  treasuryShare: 5,
  /** Kinds of made things the town buys each day. */
  goodsPerDay: 3,
  /** Kinds of produce the town buys each day. */
  producePerDay: 1,
} as const;

export const SHOP_CATALOG: Readonly<Record<ShopSku, ShopEntry>> = {
  lantern: { price: 40, section: "decor" },
  frame: { price: 30, section: "decor" },
  fence: { price: 3, section: "decor" },
  bench: { price: 25, section: "decor" },
  top_hat: { price: 80, section: "wear" },
  raincoat: { price: 90, section: "wear" },
  umbrella: { price: 60, section: "wear" },
  lemon_seed: { price: 4, section: "garden" },
  strawberry_seed: { price: 4, section: "garden" },
  tomato_seed: { price: 4, section: "garden" },
  herb_seed: { price: 3, section: "garden" },
  flower_seed: { price: 3, section: "garden" },
  sugar: { price: 3, section: "pantry" },
  jar: { price: 3, section: "pantry" },
  // Autumn only (`SEASON_STOCK`, RFC 0017). Decision 0079 has the reasoning.
  pumpkin_seed: { price: 4, section: "garden" },
  hay_bale: { price: 8, section: "decor" },
  scarecrow: { price: 35, section: "decor" },
};

/** What the town buys: made things and produce. */
export type SellKind = GoodKind | Crop;

export interface BuyOrder {
  /** Coins the town pays for one. */
  price: number;
  /** The most of this kind the town buys from one resident on a day it's buying. */
  perDay: number;
}

/** Every buy order the town has. On a given day it buys only some of them (`townBuys`). */
export const BUY_ORDERS: Readonly<Record<SellKind, BuyOrder>> = {
  lemon_jam: { price: 5, perDay: 1 },
  strawberry_jam: { price: 5, perDay: 1 },
  lemonade: { price: 4, perDay: 1 },
  tomato_sauce: { price: 6, perDay: 1 },
  herb_tea: { price: 3, perDay: 1 },
  bouquet: { price: 3, perDay: 1 },
  herb_sachet: { price: 3, perDay: 1 },
  flower_wreath: { price: 6, perDay: 1 },
  lemon: { price: 1, perDay: 3 },
  strawberry: { price: 1, perDay: 3 },
  tomato: { price: 1, perDay: 3 },
  herb: { price: 1, perDay: 3 },
  flower: { price: 1, perDay: 3 },
  // Bought every day of autumn (`SEASON_BUYS`, RFC 0017). Decision 0079 has the reasoning.
  pumpkin: { price: 2, perDay: 2 },
  pumpkin_pie: { price: 6, perDay: 1 },
  pumpkin_soup: { price: 5, perDay: 1 },
};

export const isShopSku = (s: unknown): s is ShopSku =>
  typeof s === "string" && (SHOP_SKUS as readonly string[]).includes(s);

/** One for `shop_buy` messages: "Paper lantern", "Top hat". */
export const skuName = (sku: ShopSku) =>
  isShopWear(sku) ? WEAR_INFO[sku].label : ITEM_INFO[sku as StackKind].name;

/**
 * The made things and crops the daily rotation cycles through. Frozen: their order and lengths
 * decide what the town bought on every day in the log, so a new kind never joins them. A season's
 * kinds go in `SEASON_BUYS` instead (RFC 0017).
 */
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
export const ROTATION_CROPS = [
  "lemon",
  "strawberry",
  "tomato",
  "herb",
  "flower",
] as const satisfies readonly Crop[];

/**
 * The kinds the town buys on `day`: today's turn of the fixed rotation, made things first, then
 * whatever the season adds. Every rotation kind comes up every few days, a season's kinds every
 * day of it, and nobody can make the town buy something it isn't buying today.
 */
export function townBuys(day: number): SellKind[] {
  const goods = Array.from(
    { length: Math.min(SHOP.goodsPerDay, ROTATION_GOODS.length) },
    (_, i) => ROTATION_GOODS[(day + i * 3) % ROTATION_GOODS.length] as GoodKind,
  );
  const produce = Array.from(
    { length: Math.min(SHOP.producePerDay, ROTATION_CROPS.length) },
    (_, i) => ROTATION_CROPS[(day + i * 2) % ROTATION_CROPS.length] as Crop,
  );
  return [...goods, ...produce, ...SEASON_BUYS[seasonOf(day)]];
}

// ---------- seasons (RFC 0017) ----------

/**
 * Shop stock sold in one season only, every day of it, and refused (`out_of_season`) the rest of
 * the year. Everything else is sold all year. What you bought stays yours when its season ends.
 */
export const SEASON_STOCK: Readonly<Record<Season, readonly ShopSku[]>> = {
  spring: [],
  summer: [],
  autumn: ["pumpkin_seed", "hay_bale", "scarecrow"],
  winter: [],
};

/** What the town buys every day of a season, on top of the daily rotation. */
export const SEASON_BUYS: Readonly<Record<Season, readonly SellKind[]>> = {
  spring: [],
  summer: [],
  autumn: ["pumpkin", "pumpkin_pie", "pumpkin_soup"],
  winter: [],
};

/** The season `sku` is sold in, or undefined when the shop sells it all year. */
export const stockSeason = (sku: ShopSku): Season | undefined =>
  SEASONS.find((s) => SEASON_STOCK[s].includes(sku));

/** The season the town buys `kind` in on top of the rotation, or undefined for the rotation's own. */
export const buySeason = (kind: SellKind): Season | undefined =>
  SEASONS.find((s) => SEASON_BUYS[s].includes(kind));

/** Whether the shop sells `sku` on `day`. */
export function onSale(sku: ShopSku, day: number): boolean {
  const season = stockSeason(sku);
  return season === undefined || season === seasonOf(day);
}

/** The last day of the season `day` is in: the last day its stock is sold. */
export const seasonLastDay = (day: number) => seasonSpan(day).end - 1;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "September 1", for a world day. */
function dayName(day: number): string {
  const { month, date } = dateOfDay(day);
  return `${MONTHS[month - 1]} ${date}`;
}

/** The first day of the next `season` after the season `day` is in. */
function nextStart(season: Season, day: number): number {
  let { end } = seasonSpan(day);
  while (seasonOf(end) !== season) end = seasonSpan(end).end;
  return end;
}

/** Why the shop won't sell `sku` on `day`, in plain words, or null when it's on sale. */
function outOfSeason(sku: ShopSku, day: number): Rejection | null {
  const season = stockSeason(sku);
  if (season === undefined || season === seasonOf(day)) return null;
  const what = isShopWear(sku)
    ? `the ${WEAR_INFO[sku].label.toLowerCase()}`
    : ITEM_INFO[sku].plural.toLowerCase();
  return refuse(
    "out_of_season",
    `The shop sells ${what} only in ${season}. It's ${seasonOf(day)} now, and ${season} starts on ${dayName(nextStart(season, day))} (UTC). What you already have is yours to use in any season. GET /v1/shop lists what's sold today.`,
  );
}

// ---------- reading ----------

/** What `GET /v1/shop` shows about today's buying. `sold` is yours when you're signed in. */
export interface BuyOrderRead {
  kind: SellKind;
  price: number;
  perDay: number;
  /** Set when the town buys it only in this season, every day of it (RFC 0017). */
  season?: Season;
}

/** The shop as everyone sees it, or null before it opens. */
export function shopOf(
  state: WorldState,
): { day: number; season: Season; buying: BuyOrderRead[] } | null {
  if (!state.shop || state.day === undefined) return null;
  return {
    day: state.day,
    season: seasonOf(state.day),
    buying: townBuys(state.day).map((kind) => {
      const season = buySeason(kind);
      return { kind, ...BUY_ORDERS[kind], ...(season ? { season } : {}) };
    }),
  };
}

/** What one resident has to do with the shop: what they sold today, and the wear they own. */
export function shopFor(
  state: WorldState,
  id: ResidentId,
): { sold: Partial<Record<ItemKind, number>>; wardrobe: ShopWear[] } | null {
  const shop = state.shop;
  if (!shop) return null;
  return {
    sold: { ...(shop.today.sold[id] ?? {}) },
    wardrobe: [...(shop.wardrobe[id] ?? [])] as ShopWear[],
  };
}

/** Whether `id` owns a piece of shop wear. */
export const ownsWear = (state: WorldState, id: ResidentId, wear: ShopWear) =>
  state.shop?.wardrobe[id]?.includes(wear) ?? false;

/** The share the shop opened with, before any `set_shop_share` (decision 0052). */
export const SHOP_SHARE_BEFORE = 50;

/** The treasury's share of shop spending in this world right now, in percent. */
export const treasuryShareOf = (state: WorldState) =>
  state.shop?.treasuryShare ?? SHOP_SHARE_BEFORE;

// ---------- changing ----------

type Mutation = () => WorldEvent[];
export type ShopChecked = Mutation | Rejection;

const emptyToday = (): ShopToday => ({ sold: {} });

/** `open_shop`, which only TOWN_ACTOR sends. */
export function checkOpenShop(state: WorldState): ShopChecked {
  if (state.shop) return refuse("already_open", "The town shop is already open.");
  if (!state.economy || !state.items || state.day === undefined) {
    return refuse("not_due", "The town shop opens once coins and items are open.");
  }
  // Once buildings are solid, anyone standing where the shop goes steps off it.
  const off = state.solidBuildings ? offBuildings(state, { shopOpen: true }) : [];
  return () => {
    state.shop = { wardrobe: {}, today: emptyToday() };
    return [{ type: "shop_opened" }, ...moveOff(state, off)];
  };
}

/** `set_shop_share {percent}`, which only TOWN_ACTOR sends: the treasury's share from now on. */
export function checkSetShopShare(
  state: WorldState,
  command: Extract<Command, { type: "set_shop_share" }>,
): ShopChecked {
  const shop = state.shop;
  if (!shop) return refuse("shop_closed", "The town shop hasn't opened in this world yet.");
  const { percent } = command;
  if (!isWhole(percent) || percent < 0 || percent > 100) {
    return refuse("server_only", "The treasury's share is a whole percent, 0 to 100.");
  }
  if (percent === treasuryShareOf(state)) {
    return refuse("server_only", `The treasury's share is already ${percent}%.`);
  }
  return () => {
    shop.treasuryShare = percent;
    return [{ type: "shop_share_set", percent }];
  };
}

/** What `new_day` does to the shop, or null before it opens: today's sales start over. */
export function shopNewDay(state: WorldState): Mutation | null {
  const shop = state.shop;
  if (!shop) return null;
  return () => {
    shop.today = emptyToday();
    return [];
  };
}

interface Open {
  shop: ShopState;
  econ: EconomyState;
  items: ItemsState;
  day: number;
}

/** The checks both shop commands share: the shop open, the resident joined, not townsfolk. */
function opened(state: WorldState, actor: ResidentId): Open | Rejection {
  const { shop, economy: econ, items, day } = state;
  if (!shop || !econ || !items || day === undefined) {
    return refuse("shop_closed", "The town shop hasn't opened in this world yet.");
  }
  if (!state.residents[actor]) return refuse("not_joined", "Join the world first.");
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk don't shop. Their coins are the town's.");
  }
  return { shop, econ, items, day };
}

/** `shop_buy {sku, count?}`. */
export function checkShopBuy(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "shop_buy" }>,
): ShopChecked {
  const open = opened(state, actor);
  if ("code" in open) return open;
  const { shop, econ, items, day } = open;
  const { sku } = command;
  if (!isShopSku(sku)) {
    return refuse("unknown_item", "The shop doesn't sell that. See GET /v1/shop for what it has.");
  }
  const season = outOfSeason(sku, day);
  if (season) return season;
  const count = command.count ?? 1;
  if (!isWhole(count) || count < 1 || count > SHOP.countMax) {
    return refuse("invalid_amount", `Buy 1 to ${SHOP.countMax} at a time.`);
  }
  const wear = isShopWear(sku) ? sku : null;
  if (wear) {
    if (count !== 1) return refuse("invalid_amount", "Wear is one of a kind. Leave out count.");
    if (shop.wardrobe[actor]?.includes(wear)) {
      return refuse("already_have", `You already have the ${WEAR_INFO[wear].label.toLowerCase()}.`);
    }
  }
  const total = SHOP_CATALOG[sku].price * count;
  const have = econ.coins[actor] ?? 0;
  if (have < total) {
    // The allowance pays after a command commits, so a purchase can't count on it: say so.
    const tip = allowanceDue(state, actor)
      ? "Today's allowance is waiting: send home first."
      : "Come home each day for your allowance.";
    return refuse(
      "not_enough_coins",
      `That's ${coins(total)}, and you have ${coins(have)}. ${tip}`,
    );
  }
  if (!wear && inventorySize(items.inventories[actor]) + count > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things. Make, place, give, or sell something first.`,
    );
  }
  const at = { seq: state.seq + 1, day };
  const toTreasury = Math.floor((total * treasuryShareOf(state)) / 100);
  return () => {
    const events: WorldEvent[] = [movePurse(econ, actor, -total, "shop", at)];
    // The treasury's history is public, so its share is a line that doesn't say who bought.
    if (toTreasury > 0) events.push(moveTreasury(econ, toTreasury, "shop", at));
    econ.burned += total - toTreasury;
    if (wear) {
      shop.wardrobe[actor] = [...(shop.wardrobe[actor] ?? []), wear].sort();
      events.push({ type: "wear_bought", residentId: actor, wear });
      return events;
    }
    const change = addStack(inventory(items, actor), sku as StackKind, count);
    events.push(inventoryEvent(actor, "bought", [change]));
    return events;
  };
}

/**
 * `sell_to_town {item, count?}`. `item` is produce (`lemon`), a made kind (`lemon_jam`, your
 * oldest `count` of them), or a made thing's id (`i_12`). The town buys only today's kinds, each up
 * to its daily count.
 */
export function checkSellToTown(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "sell_to_town" }>,
): ShopChecked {
  const open = opened(state, actor);
  if ("code" in open) return open;
  const { shop, econ, items, day } = open;
  const { item } = command;
  const count = command.count ?? 1;
  if (!isWhole(count) || count < 1 || count > SHOP.countMax) {
    return refuse("invalid_amount", `Sell 1 to ${SHOP.countMax} at a time.`);
  }
  const inv = items.inventories[actor];
  let kind: ItemKind;
  let goods: Good[] = [];
  if (typeof item === "string" && ITEM_ID_PATTERN.test(item)) {
    const good = inv?.goods.find((g) => g.id === item);
    if (!good) return refuse("not_enough_items", "You don't have that.");
    if (count !== 1) return refuse("invalid_amount", "An item id is one thing. Leave out count.");
    kind = good.kind;
    goods = [good];
  } else if (isGoodKind(item) || isStackKind(item)) {
    kind = item;
  } else {
    return refuse("unknown_item", "That isn't something you can hold. Check GET /v1/inventory.");
  }
  const buying = townBuys(day);
  if (!(buying as readonly string[]).includes(kind)) {
    const names = buying.map((k) => ITEM_INFO[k].plural.toLowerCase()).join(", ");
    return refuse(
      "not_buying",
      `The town isn't buying ${ITEM_INFO[kind].plural.toLowerCase()} today. Today it buys ${names}. It changes at midnight UTC.`,
    );
  }
  const order = BUY_ORDERS[kind as SellKind];
  const sold = shop.today.sold[actor]?.[kind] ?? 0;
  if (sold + count > order.perDay) {
    const left = order.perDay - sold;
    return refuse(
      "sell_limit",
      `The town buys ${order.perDay} ${ITEM_INFO[kind].plural.toLowerCase()} from each resident a day. ${left === 0 ? "You've sold that many today" : `You can sell ${left} more today`}.`,
    );
  }
  if (isGoodKind(kind) && goods.length === 0) {
    goods = (inv?.goods ?? []).filter((g) => g.kind === kind).slice(0, count);
    if (goods.length < count) {
      return refuse("not_enough_items", `You have ${goods.length} of those.`);
    }
  } else if (!isGoodKind(kind) && held(inv, kind as StackKind) < count) {
    return refuse("not_enough_items", `You have ${held(inv, kind as StackKind)} of those.`);
  }
  const total = order.price * count;
  const at = { seq: state.seq + 1, day };
  const ids = goods.map((g) => g.id);
  return () => {
    const mine = inventory(items, actor);
    let event: WorldEvent;
    if (ids.length > 0) {
      mine.goods = mine.goods.filter((g) => !ids.includes(g.id));
      event = inventoryEvent(actor, "sold", [], { lost: ids });
    } else {
      event = inventoryEvent(actor, "sold", [addStack(mine, kind as StackKind, -count)]);
    }
    shop.today.sold[actor] = { ...shop.today.sold[actor], [kind]: sold + count };
    econ.minted += total;
    return [event, movePurse(econ, actor, total, "sold", at)];
  };
}
