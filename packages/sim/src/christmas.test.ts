import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { hashWorld } from "./hash";
import { MIDWINTER_WEAR, WEAR_INFO } from "./looks";
import { dayOfDate } from "./season";
import { HOLIDAY_STOCK, SHOP_CATALOG, stockHoliday } from "./shop";
import { expectSupplyHolds, fund } from "./test-support";
import {
  type Command,
  type RejectionCode,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

/**
 * Christmas inside Midwinter (RFC 0034): the stock the shop sells only while Midwinter runs,
 * December 21 to 31: a stocking (decor) and a Santa hat (wear, yours for good once bought).
 * Decision 0291 has the numbers. Wrapped presents and New Year's are the rest of slice 4.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const FIRST = dayOfDate(2026, 12, 21);
const LAST = dayOfDate(2026, 12, 31);

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

/** A refusal with this code that leaves the world exactly as it was. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
  return result.ok ? "" : result.rejection.message;
}

const coins = (state: WorldState) => state.economy?.coins.ada ?? 0;

describe("Christmas stock", () => {
  it("is a stocking at 6 and a Santa hat at 25, the hat in the hat slot", () => {
    expect(SHOP_CATALOG.stocking).toEqual({ price: 6, section: "decor" });
    expect(SHOP_CATALOG.santa_hat).toEqual({ price: 25, section: "wear" });
    expect(WEAR_INFO.santa_hat).toEqual({ slot: "hat", label: "Santa hat" });
    expect(MIDWINTER_WEAR).toEqual(["santa_hat"]);
    expect(HOLIDAY_STOCK.midwinter).toEqual(["stocking", "candy_cane", "santa_hat"]);
    expect(stockHoliday("stocking")).toBe("midwinter");
    expect(stockHoliday("santa_hat")).toBe("midwinter");
  });

  it("sells both from Midwinter's first day to its last", () => {
    for (const day of [FIRST, LAST]) {
      const state = shopOn(day);
      const before = coins(state);
      ok(state, "ada", { type: "shop_buy", sku: "stocking", count: 2 });
      ok(state, "ada", { type: "shop_buy", sku: "santa_hat" });
      expect(coins(state)).toBe(before - 2 * 6 - 25);
      expect(state.items?.inventories.ada?.stacks.stocking).toBe(2);
      expect(state.shop?.wardrobe.ada).toEqual(["santa_hat"]);
    }
  });

  it("refuses both the day before Midwinter and the day after, naming the days", () => {
    for (const day of [FIRST - 1, LAST + 1]) {
      const state = shopOn(day);
      const hat = refused(state, "ada", { type: "shop_buy", sku: "santa_hat" }, "out_of_holiday");
      expect(hat).toContain("the santa hat only for Midwinter, December 21 to December 31");
      expect(hat).toContain("yours to wear any day");
      const stocking = refused(
        state,
        "ada",
        { type: "shop_buy", sku: "stocking" },
        "out_of_holiday",
      );
      expect(stocking).toContain("stockings only for Midwinter, December 21 to December 31");
      expect(stocking).toContain("back on December 21");
    }
  });

  it("keeps the hat wearable any day once bought, and refuses it before", () => {
    const state = shopOn(dayOfDate(2026, 12, 25));
    expect(
      refused(state, "ada", { type: "profile", wear: ["santa_hat"] }, "not_owned"),
    ).toContain("Buy it there with shop_buy first");
    // Outside Midwinter the same refusal names the days, since shop_buy would refuse it too.
    const before = shopOn(dayOfDate(2026, 12, 20));
    expect(
      refused(before, "ada", { type: "profile", wear: ["santa_hat"] }, "not_owned"),
    ).toContain("only for Midwinter, December 21 to December 31");
    ok(state, "ada", { type: "shop_buy", sku: "santa_hat" });
    ok(state, "ada", { type: "profile", wear: ["santa_hat"] });
    expect(state.residents.ada?.wear).toEqual(["santa_hat"]);
    // Into the new year, when the shop no longer sells it: what you bought stays yours.
    ok(state, TOWN_ACTOR, { type: "new_day", day: dayOfDate(2027, 1, 4) });
    ok(state, "ada", { type: "profile", wear: [] });
    ok(state, "ada", { type: "profile", wear: ["santa_hat"] });
    expect(state.residents.ada?.wear).toEqual(["santa_hat"]);
  });

  it("places a bought stocking on your plot like any decor", () => {
    const state = shopOn(dayOfDate(2026, 12, 25));
    ok(state, "ada", { type: "shop_buy", sku: "stocking" });
    ok(state, "ada", { type: "place", x: 4, y: 2, block: "stocking" });
    expect(state.blocks["4,2"]).toBe("stocking");
    expect(state.items?.inventories.ada?.stacks.stocking ?? 0).toBe(0);
  });
});
