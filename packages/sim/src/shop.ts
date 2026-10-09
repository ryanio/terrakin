import {
  CATALOG,
  type Crop,
  DECOR_KINDS,
  type DecorKind,
  type FishKind,
  type GoodKind,
  holidayKinds,
  ROTATION_CROPS,
  ROTATION_GOODS,
  type Role,
  SEED_KINDS,
  type SeedKind,
  STAPLE_KINDS,
  SEASON_STOCK as STOCK_BY_SEASON,
  type StapleKind,
  SWEET_KINDS,
  type SweetKind,
} from "./catalog";
import { coinCount as coins, isWhole, oneTimeSwitch, refuse } from "./check";
import { allowanceDue, isTownsfolk, movePurse, moveTreasury } from "./economy";
import {
  dayName,
  HOLIDAY_INFO,
  HOLIDAYS,
  type Holiday,
  holidayDates,
  holidayLastDay,
  holidayOf,
  nextHolidayStart,
} from "./holiday";
import {
  addStack,
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
  type StackKind,
} from "./items";
import { COSTUMES, isShopWear, SHOP_WEAR, type ShopWear, WEAR_INFO } from "./looks";
import { SEASONS, type Season, seasonOf, seasonSpan } from "./season";
import type {
  Command,
  EconomyState,
  Good,
  ItemsState,
  Rejection,
  RejectionCode,
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

/**
 * Wear the shop sells, and its price. Every other price is in the catalog (`catalog.ts`).
 * Halloween's costumes are decision 0210's, from `lower_holiday_prices` on (`priceOf`).
 */
const WEAR_PRICES: Readonly<Record<ShopWear, number>> = {
  top_hat: 80,
  raincoat: 90,
  umbrella: 60,
  witch_hat: 30,
  cat_ears: 20,
  pumpkin_head: 35,
  ghost_sheet: 25,
  bat_wings: 35,
};

/** The catalog's kinds the shop sells: those with a shop price, in catalog order. */
const sold = <K extends StackKind>(kinds: readonly K[]) =>
  kinds.filter((kind) => CATALOG[kind].shop !== undefined);

/**
 * What the shop sells. A sku is the name of what you get: a stack kind or a piece of shop wear.
 * Decor, then wear, then seeds, then the pantry's staples, then sweets.
 */
export const SHOP_SKUS: readonly ShopSku[] = [
  ...sold(DECOR_KINDS),
  ...SHOP_WEAR,
  ...sold(SEED_KINDS),
  ...sold(STAPLE_KINDS),
  ...sold(SWEET_KINDS),
];
export type ShopSku = DecorKind | ShopWear | SeedKind | StapleKind | SweetKind;

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

/** The section of the shop a kind sits in, by what it is to the rules. Candy sits with the pantry. */
const SECTION: Partial<Record<Role, ShopSection>> = {
  decor: "decor",
  seed: "garden",
  staple: "pantry",
  sweet: "pantry",
};

/**
 * What Halloween's costumes and decor cost before the server logged `lower_holiday_prices`
 * (decision 0107's prices). A world that hasn't logged it still charges these, so every purchase
 * replays at the price it was made at; from the switch on, the shop charges `SHOP_CATALOG`'s
 * (decision 0210). Frozen: a later price change is a new list behind a new switch.
 */
export const HOLIDAY_PRICES_BEFORE: Readonly<Partial<Record<ShopSku, number>>> = {
  bat_bunting: 12,
  cauldron: 30,
  candy_bowl: 15,
  witch_hat: 60,
  cat_ears: 40,
  pumpkin_head: 70,
  ghost_sheet: 50,
  bat_wings: 70,
};

/** Every sku's price and section: wear's from `WEAR_PRICES`, everything else's from the catalog. */
export const SHOP_CATALOG = Object.fromEntries(
  SHOP_SKUS.map((sku): [ShopSku, ShopEntry] => {
    if (isShopWear(sku)) return [sku, { price: WEAR_PRICES[sku], section: "wear" }];
    // `sold` kept only decor, seeds, staples, and sweets with a price.
    const { shop, role } = CATALOG[sku];
    return [
      sku,
      { price: (shop as { price: number }).price, section: SECTION[role] as ShopSection },
    ];
  }),
) as Readonly<Record<ShopSku, ShopEntry>>;

export interface BuyOrder {
  /** Coins the town pays for one. */
  price: number;
  /** The most of this kind the town buys from one resident on a day it's buying. */
  perDay: number;
}

const ORDERS = {
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
  // Bought every day of winter. Decision 0124 has the reasoning.
  cranberry: { price: 1, perDay: 3 },
  cranberry_jam: { price: 5, perDay: 1 },
  cranberry_punch: { price: 5, perDay: 1 },
  // Each season's own fish, bought every day of it (RFC 0023). Decision 0123 has the reasoning.
  trout: { price: 2, perDay: 2 },
  sunfish: { price: 2, perDay: 2 },
  salmon: { price: 2, perDay: 2 },
  char: { price: 2, perDay: 2 },
} satisfies Partial<Record<GoodKind | Crop | FishKind, BuyOrder>>;

/**
 * What the town buys: the made things and produce it has a buy order for. A kind gets one by a
 * decision of its own, never by joining the catalog.
 */
export type SellKind = keyof typeof ORDERS;

/** Every buy order the town has. On a given day it buys only some of them (`townBuys`). */
export const BUY_ORDERS: Readonly<Record<SellKind, BuyOrder>> = ORDERS;

export const isShopSku = (s: unknown): s is ShopSku =>
  typeof s === "string" && (SHOP_SKUS as readonly string[]).includes(s);

/** One for `shop_buy` messages: "Paper lantern", "Top hat". */
export const skuName = (sku: ShopSku) =>
  isShopWear(sku) ? WEAR_INFO[sku].label : ITEM_INFO[sku as StackKind].name;

/*
 * The rotation cycles through `ROTATION_GOODS` and `ROTATION_CROPS`, frozen in the catalog: their
 * order and lengths decide what the town bought on every day in the log, so a new kind never joins
 * them. A season's kinds go in `SEASON_BUYS` instead (RFC 0017).
 */
export { ROTATION_CROPS, ROTATION_GOODS };

/**
 * The kinds the town buys on `day`: today's turn of the fixed rotation, made things first, then
 * whatever the season adds. Every rotation kind comes up every few days, a season's kinds every
 * day of it, and nobody can make the town buy something it isn't buying today.
 */
export function townBuys(day: number): SellKind[] {
  const goods = Array.from(
    { length: Math.min(SHOP.goodsPerDay, ROTATION_GOODS.length) },
    (_, i) => ROTATION_GOODS[(day + i * 3) % ROTATION_GOODS.length] as SellKind,
  );
  const produce = Array.from(
    { length: Math.min(SHOP.producePerDay, ROTATION_CROPS.length) },
    (_, i) => ROTATION_CROPS[(day + i * 2) % ROTATION_CROPS.length] as SellKind,
  );
  return [...goods, ...produce, ...SEASON_BUYS[seasonOf(day)]];
}

// ---------- windows: seasons (RFC 0017) and holidays (RFC 0022) ----------

/**
 * A stretch of the year something is sold or bought in: a season, or a holiday. Seasonal and holiday
 * stock sell only in theirs and are refused the rest of the year (`stockWindows`), and the season
 * buys are bought in theirs on top of the rotation (`townBuys`).
 */
export type Window = { season: Season } | { holiday: Holiday };

/**
 * The first of `order` whose list in `lists` holds `x`, or undefined when none does. A kind listed
 * in two would get the first alone; every kind is in one list at most (`seasons.test.ts` checks).
 */
export const windowOf = <W extends string, X>(
  order: readonly W[],
  lists: Readonly<Record<W, readonly X[]>>,
  x: X,
): W | undefined => order.find((w) => lists[w].includes(x));

/** Whether `day` falls in `window`. */
const inWindow = (window: Window, day: number): boolean =>
  "season" in window ? window.season === seasonOf(day) : window.holiday === holidayOf(day);

/**
 * Shop stock sold in one season only, every day of it, and refused (`out_of_season`) the rest of
 * the year. Everything else is sold all year. What you bought stays yours when its season ends.
 */
export const SEASON_STOCK: Readonly<Record<Season, readonly ShopSku[]>> =
  STOCK_BY_SEASON as Readonly<Record<Season, readonly ShopSku[]>>;

/**
 * What the town buys every day of a season, on top of the daily rotation: autumn's pumpkins and
 * winter's cranberries, with what the kitchen makes from them (RFC 0017), and each season's own fish
 * (RFC 0023). A new kind goes on the end of its season's list.
 */
export const SEASON_BUYS: Readonly<Record<Season, readonly SellKind[]>> = {
  spring: ["trout"],
  summer: ["sunfish"],
  autumn: ["pumpkin", "pumpkin_pie", "pumpkin_soup", "salmon"],
  winter: ["cranberry", "cranberry_jam", "cranberry_punch", "char"],
};

/**
 * Shop stock sold only while a holiday runs, every day of it, and refused (`out_of_holiday`) the
 * rest of the year: the catalog's kinds with that holiday (Halloween's candy and decor, Midwinter's
 * candy canes), then its wear (Halloween's costumes). What you bought stays yours, to use and wear
 * any day.
 */
export const HOLIDAY_STOCK: Readonly<Record<Holiday, readonly ShopSku[]>> = {
  halloween: [...holidayKinds("halloween"), ...COSTUMES] as ShopSku[],
  midwinter: holidayKinds("midwinter") as ShopSku[],
};

/** The season `sku` is sold in, or undefined when the shop sells it all year. */
export const stockSeason = (sku: ShopSku): Season | undefined =>
  windowOf(SEASONS, SEASON_STOCK, sku);

/** The holiday `sku` is sold for, or undefined when no holiday holds it back. */
export const stockHoliday = (sku: ShopSku): Holiday | undefined =>
  windowOf(HOLIDAYS, HOLIDAY_STOCK, sku);

/** The season the town buys `kind` in on top of the rotation, or undefined for the rotation's own. */
export const buySeason = (kind: SellKind): Season | undefined =>
  windowOf(SEASONS, SEASON_BUYS, kind);

/** The windows `sku` is sold in, its season before its holiday, or none when it's sold all year. */
function stockWindows(sku: ShopSku): Window[] {
  const season = stockSeason(sku);
  const holiday = stockHoliday(sku);
  return [...(season ? [{ season }] : []), ...(holiday ? [{ holiday }] : [])];
}

/** Whether the shop sells `sku` on `day`: in its season, if it has one, and during its holiday. */
export const onSale = (sku: ShopSku, day: number): boolean =>
  stockWindows(sku).every((window) => inWindow(window, day));

/** The last day of the season `day` is in: the last day its stock is sold. */
export const seasonLastDay = (day: number) => seasonSpan(day).end - 1;

/** The holiday on `day` with its first and last day, as the shop shows it, or undefined. */
export function holidayOn(day: number): { holiday: Holiday; lastDay: number } | undefined {
  const holiday = holidayOf(day);
  return holiday ? { holiday, lastDay: holidayLastDay(holiday, day) } : undefined;
}

/** The first day of the next `season` after the season `day` is in. */
export function nextSeasonStart(season: Season, day: number): number {
  let { end } = seasonSpan(day);
  while (seasonOf(end) !== season) end = seasonSpan(end).end;
  return end;
}

/**
 * Why the shop won't sell `sku` on `day`, in plain words, or null when it's on sale: the first of
 * its windows `day` is outside (`out_of_season` before `out_of_holiday`), with the day it's back.
 */
function notOnSale(sku: ShopSku, day: number): Rejection | null {
  const window = stockWindows(sku).find((w) => !inWindow(w, day));
  if (!window) return null;
  const wear = isShopWear(sku);
  const what = wear
    ? `the ${WEAR_INFO[sku].label.toLowerCase()}`
    : ITEM_INFO[sku].plural.toLowerCase();
  const why: { code: RejectionCode; when: string; back: string; any: string } =
    "season" in window
      ? {
          code: "out_of_season",
          when: `in ${window.season}`,
          back: `It's ${seasonOf(day)} now, and ${window.season} starts on ${dayName(nextSeasonStart(window.season, day))}`,
          any: "in any season",
        }
      : {
          code: "out_of_holiday",
          when: `for ${HOLIDAY_INFO[window.holiday].name}, ${holidayDates(window.holiday)}`,
          back: `It's back on ${dayName(nextHolidayStart(window.holiday, day))}`,
          any: "any day",
        };
  return refuse(
    why.code,
    `The shop sells ${what} only ${why.when}. ${why.back} (UTC). What you already have is yours to ${wear ? "wear" : "use"} ${why.any}. GET /v1/shop lists what's sold today.`,
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

/** The shop as everyone sees it, or null before it opens. `holiday` is on while one runs. */
export function shopOf(state: WorldState): {
  day: number;
  season: Season;
  holiday?: { holiday: Holiday; lastDay: number };
  buying: BuyOrderRead[];
} | null {
  if (!state.shop || state.day === undefined) return null;
  const holiday = holidayOn(state.day);
  return {
    day: state.day,
    season: seasonOf(state.day),
    ...(holiday ? { holiday } : {}),
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

/**
 * What the shop asks for one `sku` in this world: `SHOP_CATALOG`'s price, or for holiday stock
 * before `lower_holiday_prices`, the price in `HOLIDAY_PRICES_BEFORE`.
 */
export function priceOf(state: WorldState, sku: ShopSku): number {
  const before = HOLIDAY_PRICES_BEFORE[sku];
  return before !== undefined && !state.shop?.holidayPricesLowered
    ? before
    : SHOP_CATALOG[sku].price;
}

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

/**
 * `lower_holiday_prices`, which only TOWN_ACTOR sends once the shop is open: Halloween's costumes
 * and decor cost `SHOP_CATALOG`'s prices from now on, not `HOLIDAY_PRICES_BEFORE` (decision 0210).
 */
export function checkLowerHolidayPrices(state: WorldState): ShopChecked {
  const shop = state.shop;
  if (!shop) return refuse("shop_closed", "The town shop hasn't opened in this world yet.");
  return oneTimeSwitch({
    on: shop.holidayPricesLowered,
    already: "Holiday stock is already at its lower prices.",
    turnOn: () => {
      shop.holidayPricesLowered = true;
    },
    event: { type: "holiday_prices_lowered" },
  });
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

export interface Open {
  shop: ShopState;
  econ: EconomyState;
  items: ItemsState;
  day: number;
}

/**
 * The checks every shop command shares: the shop open, the resident joined, not townsfolk. Recipe
 * cards (`recipes.ts`) check with it too.
 */
export function opened(state: WorldState, actor: ResidentId): Open | Rejection {
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
  const closed = notOnSale(sku, day);
  if (closed) return closed;
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
  const total = priceOf(state, sku) * count;
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
      `The town buys ${order.perDay} ${(order.perDay === 1 ? ITEM_INFO[kind].name : ITEM_INFO[kind].plural).toLowerCase()} from each resident a day. ${left === 0 ? "You've sold that many today" : `You can sell ${left} more today`}.`,
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
