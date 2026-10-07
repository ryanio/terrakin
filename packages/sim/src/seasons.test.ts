import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { AUTUMN_CONFIG, AUTUMN_HASH, AUTUMN_LOG } from "./fixtures/autumn-log";
import { hashWorld } from "./hash";
import { HOLIDAYS } from "./holiday";
import { CROP_INFO, RECIPES } from "./items";
import { replay } from "./replay";
import { dayOfDate, SEASONS } from "./season";
import {
  BUY_ORDERS,
  HOLIDAY_STOCK,
  ROTATION_CROPS,
  ROTATION_GOODS,
  SEASON_BUYS,
  SEASON_STOCK,
  SHOP_CATALOG,
  stockSeason,
  townBuys,
  windowOf,
} from "./shop";
import { expectSupplyHolds, fund, stock } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldConfig } from "./types";
import { createWorld } from "./world";

/**
 * Seasons (RFC 0017): the shop sells a season's stock and the town buys its goods only while it
 * lasts, by the world's day, and nothing about it changes what an old log replays to.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const AUTUMN_STARTS = dayOfDate(2024, 9, 1);
const AUTUMN_ENDS = dayOfDate(2024, 11, 30);

/** Days counting from `day`, with coins, items, and the shop open and Ada settled on plot (0, 0). */
function shopOn(day: number) {
  const state = createWorld(CONFIG);
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    expectSupplyHolds(state);
    return result;
  };
  const ok = (actor: string, command: Command) => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
  };
  for (const command of [
    { type: "new_day", day },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
  ] as Command[]) {
    ok(TOWN_ACTOR, command);
  }
  ok("ada", { type: "join", name: "Ada", kind: "human" });
  ok("ada", { type: "settle", px: 0, py: 0 });
  ok("ada", { type: "build_starter_home" });
  fund(state, "ada", 500);
  const day_ = (d: number) => ok(TOWN_ACTOR, { type: "new_day", day: d });
  const coins = () => state.economy?.coins.ada ?? 0;
  return { state, send, ok, day: day_, coins };
}

describe("the autumn log", () => {
  it("replays to its pinned hash, with every coin accounted for", () => {
    const state = replay(AUTUMN_CONFIG, AUTUMN_LOG);
    expect(hashWorld(state)).toBe(AUTUMN_HASH);
    expectSupplyHolds(state);
  });
});

describe("seasonal stock", () => {
  it("is sold from the first day of autumn to the last, and refused the rest of the year", () => {
    for (const sku of SEASON_STOCK.autumn) {
      for (const day of [AUTUMN_STARTS, AUTUMN_ENDS]) {
        const w = shopOn(day);
        const before = w.coins();
        w.ok("ada", { type: "shop_buy", sku });
        expect(w.coins()).toBe(before - SHOP_CATALOG[sku].price);
      }
      for (const day of [AUTUMN_STARTS - 1, AUTUMN_ENDS + 1, dayOfDate(2025, 4, 10)]) {
        const w = shopOn(day);
        const before = w.coins();
        const result = w.send("ada", { type: "shop_buy", sku });
        expect(result.ok ? null : result.rejection.code, `${sku} on ${day}`).toBe("out_of_season");
        expect(w.coins()).toBe(before);
      }
    }
  });

  it("says when its season comes back", () => {
    const w = shopOn(AUTUMN_ENDS + 1);
    const result = w.send("ada", { type: "shop_buy", sku: "pumpkin_seed" });
    const message = result.ok ? "" : result.rejection.message;
    expect(message).toContain("only in autumn");
    expect(message).toContain("autumn starts on September 1");
  });
});

describe("seasonal buying", () => {
  it("takes pumpkins through the last day of autumn, and refuses them the day after", () => {
    const w = shopOn(AUTUMN_ENDS);
    stock(w.state, "ada", { pumpkin: 4 });
    const before = w.coins();
    w.ok("ada", { type: "sell_to_town", item: "pumpkin", count: 2 });
    expect(w.coins()).toBe(before + 2 * BUY_ORDERS.pumpkin.price);
    w.day(AUTUMN_ENDS + 1);
    const result = w.send("ada", { type: "sell_to_town", item: "pumpkin" });
    expect(result.ok ? null : result.rejection.code).toBe("not_buying");
  });

  it("takes each of autumn's kinds up to its daily count, then pays nothing more", () => {
    const w = shopOn(AUTUMN_STARTS);
    w.ok("ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    // Autumn's own fish too (RFC 0023), caught beside water.
    stock(w.state, "ada", { pumpkin: 9, sugar: 2, herb: 2, jar: 2, salmon: 3 });
    for (const recipe of ["pumpkin_pie", "pumpkin_pie", "pumpkin_soup", "pumpkin_soup"] as const) {
      w.ok("ada", { type: "craft", recipe, x: 4, y: 2 });
    }
    for (const kind of SEASON_BUYS.autumn) {
      for (let i = 0; i < BUY_ORDERS[kind].perDay; i++) {
        w.ok("ada", { type: "sell_to_town", item: kind });
      }
      // Ada still holds one more of each, so only the daily count can refuse it.
      const before = w.coins();
      const result = w.send("ada", { type: "sell_to_town", item: kind });
      expect(result.ok ? null : result.rejection.code).toBe("sell_limit");
      expect(w.coins()).toBe(before);
    }
  });

  it("buys none of autumn's kinds the day before autumn or the day after it", () => {
    for (const day of [AUTUMN_STARTS - 1, AUTUMN_ENDS + 1]) {
      const w = shopOn(day);
      for (const kind of SEASON_BUYS.autumn) {
        const result = w.send("ada", { type: "sell_to_town", item: kind });
        expect(result.ok ? null : result.rejection.code).toBe("not_buying");
      }
    }
  });

  it("names each thing in one season or holiday at most, since the shop labels and sells by the first", () => {
    const stocked = SEASONS.flatMap((s) => SEASON_STOCK[s]);
    expect(new Set(stocked).size).toBe(stocked.length);
    const bought = SEASONS.flatMap((s) => SEASON_BUYS[s]);
    expect(new Set(bought).size).toBe(bought.length);
    const held = HOLIDAYS.flatMap((h) => HOLIDAY_STOCK[h]);
    expect(new Set(held).size).toBe(held.length);
    // The first, in season order, if a kind were ever named in two.
    const twice = { spring: [], summer: ["x"], autumn: ["x"], winter: [] };
    expect(windowOf(SEASONS, twice, "x")).toBe("summer");
    expect(windowOf(SEASONS, twice, "y")).toBeUndefined();
    for (const sku of SEASON_STOCK.autumn) expect(stockSeason(sku)).toBe("autumn");
  });

  it("leaves the rotation every past day was bought from as it was", () => {
    // What the town bought on each day in the log comes from these, in this order. A new kind goes
    // in a season's buys instead, so an old sell_to_town replays the same.
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
    expect(townBuys(20_013)).toEqual([
      "bouquet",
      "lemon_jam",
      "tomato_sauce",
      "herb",
      ...SEASON_BUYS.autumn,
    ]);
  });
});

describe("autumn's numbers", () => {
  it("are the ones decision 0079 records", () => {
    expect(CROP_INFO.pumpkin).toEqual({ seed: "pumpkin_seed", days: 5, yield: 2, seeds: 1 });
    expect(RECIPES.pumpkin_pie).toEqual({ station: "kitchen", needs: { pumpkin: 2, sugar: 1 } });
    expect(RECIPES.pumpkin_soup).toEqual({
      station: "kitchen",
      needs: { pumpkin: 1, herb: 1, jar: 1 },
    });
    expect(Object.fromEntries(SEASON_STOCK.autumn.map((s) => [s, SHOP_CATALOG[s]]))).toEqual({
      pumpkin_seed: { price: 4, section: "garden" },
      hay_bale: { price: 8, section: "decor" },
      scarecrow: { price: 35, section: "decor" },
    });
    // Autumn's own fish come after them (RFC 0023); `fishing.test.ts` pins decision 0123's numbers.
    const pumpkins = ["pumpkin", "pumpkin_pie", "pumpkin_soup"] as const;
    expect(SEASON_BUYS.autumn.slice(0, pumpkins.length)).toEqual(pumpkins);
    expect(Object.fromEntries(pumpkins.map((k) => [k, BUY_ORDERS[k]]))).toEqual({
      pumpkin: { price: 2, perDay: 2 },
      pumpkin_pie: { price: 6, perDay: 1 },
      pumpkin_soup: { price: 5, perDay: 1 },
    });
  });
});
