import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { CATALOG } from "./catalog";
import { WINTER_CONFIG, WINTER_HASH, WINTER_LOG } from "./fixtures/winter-log";
import { hashWorld } from "./hash";
import { holidayOf } from "./holiday";
import { CROP_INFO, isFishKind, RECIPES } from "./items";
import { replay } from "./replay";
import { dayOfDate, seasonOf } from "./season";
import {
  BUY_ORDERS,
  HOLIDAY_STOCK,
  SEASON_BUYS,
  SEASON_STOCK,
  SHOP_CATALOG,
  stockHoliday,
  stockSeason,
  townBuys,
} from "./shop";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type Command,
  type RejectionCode,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

/**
 * Winter (RFC 0017) and Midwinter (RFC 0022): winter's stock sold and its goods bought only from
 * December 1 to the last day of February, candy canes sold only from December 21 to December 31,
 * every coin the town pays capped per resident a day, and nothing about it changing what an old
 * log replays to. Decision 0124 has the numbers.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** Two winters: one that ends on February 28, and one that ends on February 29. */
const WINTERS = [
  { first: dayOfDate(2025, 12, 1), last: dayOfDate(2026, 2, 28) },
  { first: dayOfDate(2027, 12, 1), last: dayOfDate(2028, 2, 29) },
] as const;
const MIDWINTER = { first: dayOfDate(2026, 12, 21), last: dayOfDate(2026, 12, 31) } as const;

/** A world on `day` with coins, items, and the shop open, and Ada settled with coins to spend. */
function shopOn(day: number) {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
  ] as Command[]) {
    ok(state, TOWN_ACTOR, command);
  }
  ok(state, "ada", { type: "join", name: "Ada", kind: "human" });
  ok(state, "ada", { type: "settle", px: 0, py: 0 });
  ok(state, "ada", { type: "build_starter_home" });
  fund(state, "ada", 500);
  return state;
}

function send(state: WorldState, actor: string, command: Command) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  if (!result.ok) expect(hashWorld(state)).toBe(before);
  expectSupplyHolds(state);
  return result;
}

function ok(state: WorldState, actor: string, command: Command) {
  const result = send(state, actor, command);
  if (!result.ok) {
    throw new Error(`${actor} ${JSON.stringify(command)}: ${result.rejection.message}`);
  }
  return result.events;
}

/** A refusal with this code that moves no coins and leaves the world exactly as it was. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
  return result.ok ? "" : result.rejection.message;
}

const coins = (state: WorldState) => state.economy?.coins.ada ?? 0;

describe("the winter log", () => {
  it("replays to its pinned hash, with every coin accounted for", () => {
    const state = replay(WINTER_CONFIG, WINTER_LOG);
    expect(hashWorld(state)).toBe(WINTER_HASH);
    expectSupplyHolds(state);
  });
});

describe("winter's numbers", () => {
  it("are the ones decision 0124 records", () => {
    expect(CROP_INFO.cranberry).toEqual({ seed: "cranberry_seed", days: 4, yield: 3, seeds: 1 });
    expect(RECIPES.cranberry_jam).toEqual({
      station: "kitchen",
      needs: { cranberry: 3, sugar: 1, jar: 1 },
    });
    expect(RECIPES.cranberry_punch).toEqual({
      station: "kitchen",
      needs: { cranberry: 2, lemon: 1, jar: 1 },
    });
    expect(CATALOG.candy_cane.recipe).toEqual({
      station: "kitchen",
      needs: { herb: 1, sugar: 1 },
      makes: 5,
    });
    expect(Object.fromEntries(SEASON_STOCK.winter.map((s) => [s, SHOP_CATALOG[s]]))).toEqual({
      cranberry_seed: { price: 4, section: "garden" },
      snowman: { price: 30, section: "decor" },
      string_lights: { price: 12, section: "decor" },
      little_fir: { price: 20, section: "decor" },
      sled: { price: 25, section: "decor" },
    });
    // Winter's own fish (RFC 0023) comes after these, with decision 0123's numbers.
    const cranberries = SEASON_BUYS.winter.filter((k) => !isFishKind(k));
    expect(Object.fromEntries(cranberries.map((k) => [k, BUY_ORDERS[k]]))).toEqual({
      cranberry: { price: 1, perDay: 3 },
      cranberry_jam: { price: 5, perDay: 1 },
      cranberry_punch: { price: 5, perDay: 1 },
    });
    expect(Object.fromEntries(HOLIDAY_STOCK.midwinter.map((s) => [s, SHOP_CATALOG[s]]))).toEqual({
      candy_cane: { price: 2, section: "pantry" },
    });
  });

  it("add at most 13 coins a day from one resident, under autumn's 15", () => {
    const most = (kinds: readonly (keyof typeof BUY_ORDERS)[]) =>
      kinds.reduce((sum, k) => sum + BUY_ORDERS[k].price * BUY_ORDERS[k].perDay, 0);
    // Without each season's own fish (RFC 0023), which adds the same to every season.
    const grown = (kinds: readonly (keyof typeof BUY_ORDERS)[]) =>
      kinds.filter((k) => !isFishKind(k));
    expect(most(grown(SEASON_BUYS.winter))).toBe(13);
    expect(most(grown(SEASON_BUYS.winter))).toBeLessThan(most(grown(SEASON_BUYS.autumn)));
  });
});

describe("winter's stock", () => {
  it("is sold from December 1 to the last day of February, and refused the rest of the year", () => {
    for (const sku of SEASON_STOCK.winter) {
      expect(stockSeason(sku)).toBe("winter");
      for (const { first, last } of WINTERS) {
        for (const day of [first, last]) {
          const state = shopOn(day);
          const before = coins(state);
          ok(state, "ada", { type: "shop_buy", sku });
          expect(coins(state), `${sku} on ${day}`).toBe(before - SHOP_CATALOG[sku].price);
        }
        for (const day of [first - 1, last + 1, dayOfDate(2026, 7, 4)]) {
          const state = shopOn(day);
          refused(state, "ada", { type: "shop_buy", sku }, "out_of_season");
        }
      }
    }
  });

  it("says when winter comes back", () => {
    const state = shopOn(dayOfDate(2026, 3, 1));
    const message = refused(state, "ada", { type: "shop_buy", sku: "snowman" }, "out_of_season");
    expect(message).toContain("snowmen only in winter");
    expect(message).toContain("winter starts on December 1");
  });

  it("keeps working once winter is over: seeds plant, decor places, and recipes make", () => {
    const state = shopOn(WINTERS[0].last);
    ok(state, "ada", { type: "shop_buy", sku: "cranberry_seed" });
    ok(state, "ada", { type: "shop_buy", sku: "string_lights" });
    ok(state, TOWN_ACTOR, { type: "new_day", day: WINTERS[0].last + 1 });
    expect(seasonOf(WINTERS[0].last + 1)).toBe("spring");
    ok(state, "ada", { type: "place", x: 2, y: 2, block: "planter" });
    ok(state, "ada", { type: "plant", x: 2, y: 2, seed: "cranberry" });
    ok(state, "ada", { type: "place", x: 6, y: 6, block: "string_lights" });
    ok(state, "ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    stock(state, "ada", { cranberry: 2, lemon: 1, jar: 1 });
    ok(state, "ada", { type: "craft", recipe: "cranberry_punch", x: 4, y: 2 });
  });
});

describe("winter's buying", () => {
  it("takes cranberries through the last day of winter, and refuses them the day after", () => {
    const state = shopOn(WINTERS[0].last);
    stock(state, "ada", { cranberry: 6 });
    const before = coins(state);
    ok(state, "ada", { type: "sell_to_town", item: "cranberry", count: 3 });
    expect(coins(state)).toBe(before + 3 * BUY_ORDERS.cranberry.price);
    ok(state, TOWN_ACTOR, { type: "new_day", day: WINTERS[0].last + 1 });
    refused(state, "ada", { type: "sell_to_town", item: "cranberry" }, "not_buying");
  });

  it("takes each of winter's kinds up to its daily count, then pays nothing more", () => {
    const state = shopOn(WINTERS[0].first);
    ok(state, "ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    // Winter's own fish too (RFC 0023), caught beside water.
    stock(state, "ada", { cranberry: 14, lemon: 2, sugar: 2, jar: 4, char: 3 });
    for (const recipe of [
      "cranberry_jam",
      "cranberry_jam",
      "cranberry_punch",
      "cranberry_punch",
    ] as const) {
      ok(state, "ada", { type: "craft", recipe, x: 4, y: 2 });
    }
    for (const kind of SEASON_BUYS.winter) {
      const { price, perDay } = BUY_ORDERS[kind];
      const before = coins(state);
      for (let i = 0; i < perDay; i++) ok(state, "ada", { type: "sell_to_town", item: kind });
      expect(coins(state), kind).toBe(before + price * perDay);
      // Ada still holds more of each, so only the daily count can refuse it.
      const message = refused(state, "ada", { type: "sell_to_town", item: kind }, "sell_limit");
      expect(message).toContain(`${perDay}`);
      expect(coins(state), kind).toBe(before + price * perDay);
    }
    // The next day the counts start over.
    ok(state, TOWN_ACTOR, { type: "new_day", day: WINTERS[0].first + 1 });
    ok(state, "ada", { type: "sell_to_town", item: "cranberry_jam" });
  });

  it("buys none of winter's kinds the day before winter or the day after it", () => {
    for (const { first, last } of WINTERS) {
      for (const day of [first - 1, last + 1]) {
        const state = shopOn(day);
        ok(state, "ada", { type: "place", x: 4, y: 2, block: "kitchen" });
        stock(state, "ada", { cranberry: 5, lemon: 1, sugar: 1, jar: 2 });
        ok(state, "ada", { type: "craft", recipe: "cranberry_jam", x: 4, y: 2 });
        ok(state, "ada", { type: "craft", recipe: "cranberry_punch", x: 4, y: 2 });
        for (const kind of SEASON_BUYS.winter) {
          const message = refused(state, "ada", { type: "sell_to_town", item: kind }, "not_buying");
          // Not "it changes at midnight": the town won't take them again until December.
          expect(message).toContain("only in winter");
          expect(message).toContain("winter starts on December 1");
          expect(message).not.toContain("midnight");
        }
      }
    }
  });

  it("comes after the day's rotation, every day of winter", () => {
    for (const { first, last } of WINTERS) {
      for (const day of [first, last]) {
        expect(townBuys(day).slice(-SEASON_BUYS.winter.length)).toEqual(SEASON_BUYS.winter);
      }
    }
    const autumn = townBuys(WINTERS[0].first - 1);
    expect(autumn.slice(-SEASON_BUYS.autumn.length)).toEqual(SEASON_BUYS.autumn);
    // Spring adds only its own fish (RFC 0023) to the rotation's four.
    expect(townBuys(WINTERS[0].last + 1).slice(4)).toEqual(SEASON_BUYS.spring);
  });
});

describe("Midwinter", () => {
  it("runs from December 21 to December 31, inside winter", () => {
    for (const year of [2025, 2026, 2030]) {
      expect(holidayOf(dayOfDate(year, 12, 20))).toBeUndefined();
      expect(holidayOf(dayOfDate(year, 12, 21))).toBe("midwinter");
      expect(holidayOf(dayOfDate(year, 12, 31))).toBe("midwinter");
      expect(holidayOf(dayOfDate(year + 1, 1, 1))).toBeUndefined();
      expect(seasonOf(dayOfDate(year, 12, 21))).toBe("winter");
    }
  });

  it("sells candy canes from its first day to its last, and refuses them the day before and after", () => {
    for (const sku of HOLIDAY_STOCK.midwinter) {
      expect(stockHoliday(sku)).toBe("midwinter");
      for (const day of [MIDWINTER.first, MIDWINTER.last]) {
        const state = shopOn(day);
        const before = coins(state);
        ok(state, "ada", { type: "shop_buy", sku, count: 3 });
        expect(coins(state)).toBe(before - 3 * SHOP_CATALOG[sku].price);
      }
      for (const day of [MIDWINTER.first - 1, MIDWINTER.last + 1, dayOfDate(2027, 6, 1)]) {
        const state = shopOn(day);
        const message = refused(state, "ada", { type: "shop_buy", sku }, "out_of_holiday");
        expect(message).toContain("only for Midwinter, December 21 to December 31");
        expect(message).toContain("back on December 21");
      }
    }
  });

  it("makes five candy canes at a kitchen from a bunch of herbs and a bag of sugar, any day", () => {
    const state = shopOn(dayOfDate(2027, 7, 4));
    ok(state, "ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    stock(state, "ada", { herb: 1, sugar: 1 });
    ok(state, "ada", { type: "craft", recipe: "candy_cane", x: 4, y: 2 });
    expect(state.items?.inventories.ada?.stacks.candy_cane).toBe(5);
    // The town buys no sweets, so the refusal says where they go instead of "try tomorrow".
    const unsold = refused(
      state,
      "ada",
      { type: "sell_to_town", item: "candy_cane" },
      "not_buying",
    );
    expect(unsold).toContain("never buys candy canes");
    expect(unsold).not.toContain("midnight");
    refused(
      state,
      "ada",
      { type: "craft", recipe: "candy_cane", x: 4, y: 2, label: "Minty" },
      "invalid_label",
    );
  });
});
