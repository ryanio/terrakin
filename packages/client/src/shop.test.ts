import { SHOP_ITEMS } from "@terrakin/protocol";
import { dayOfDate } from "@terrakin/sim";
import { listOf } from "@terrakin/ui/format";
import { describe, expect, it } from "vitest";
import { buyLabel, holidayHint, SHELVES, sellable, shelvesOf, stockTag } from "./shop-view";

const lantern = { sku: "lantern", price: 40, section: "decor" } as const;
const hat = { sku: "top_hat", price: 80, section: "wear" } as const;

describe("the shop page", () => {
  it("puts every item on a shelf", () => {
    const shelved = new Set(SHELVES.map((s) => s.section));
    for (const item of SHOP_ITEMS) expect(shelved.has(item.section)).toBe(true);
  });

  it("says what a buy button does, from your purse and your wear", () => {
    expect(buyLabel(lantern, 100, [])).toEqual({ text: "Buy for 40 coins", can: true });
    expect(buyLabel(lantern, 40, [])).toEqual({ text: "Buy for 40 coins", can: true });
    expect(buyLabel(lantern, 39, [])).toEqual({ text: "1 coin short", can: false });
    expect(buyLabel(hat, 200, ["top_hat"])).toEqual({ text: "Yours", can: false });
    // A visitor sees the price and nothing to press.
    expect(buyLabel(lantern, null, [])).toEqual({ text: "40 coins", can: false });
  });

  it("offers to sell what's left today, up to what you hold", () => {
    const order = { kind: "herb", name: "Bunches of herbs", price: 1, perDay: 3 } as const;
    expect(sellable({ ...order, left: 3 }, 5)).toBe(3);
    expect(sellable({ ...order, left: 2 }, 1)).toBe(1);
    expect(sellable({ ...order, left: 0 }, 5)).toBe(0);
    // Without a token there's no `left`, and nothing to sell.
    expect(sellable(order, 5)).toBe(0);
  });

  it("tags seasonal stock with its season and holiday stock with its holiday, and nothing else", () => {
    expect(stockTag({ season: "autumn" })).toEqual({
      text: "This autumn",
      tone: "sun",
      className: "shop-season",
    });
    expect(stockTag({ season: "winter" })?.text).toBe("This winter");
    expect(stockTag({ holiday: "halloween" })).toEqual({
      text: "Halloween",
      tone: "moss",
      className: "shop-holiday",
    });
    expect(stockTag({ holiday: "midwinter" })?.text).toBe("Midwinter");
    // A holiday this client doesn't know yet is still tagged, by its id.
    expect(stockTag({ holiday: "spring_fair" as "halloween" })?.text).toBe("spring_fair");
    expect(stockTag({})).toBeNull();
  });

  it("puts a holiday's stock on its own shelf first, and off its section's shelf", () => {
    const lastDay = dayOfDate(2026, 11, 1);
    const items = [
      { sku: "lantern", name: "Paper lantern", price: 40, section: "decor" },
      { sku: "pumpkin_seed", name: "Pumpkin seed", price: 4, section: "garden", season: "autumn" },
      { sku: "cat_ears", name: "Cat ears", price: 40, section: "wear", holiday: "halloween" },
    ] as const;
    const shelves = shelvesOf({ items: [...items], holiday: { id: "halloween", lastDay } });
    expect(shelves.map((s) => s.key)).toEqual(["holiday", "decor", "wear", "garden", "pantry"]);
    expect(shelves[0]).toMatchObject({
      title: "For Halloween",
      hint: holidayHint("halloween", lastDay),
    });
    const skus = (key: string) => shelves.find((s) => s.key === key)?.items.map((i) => i.sku);
    expect(skus("holiday")).toEqual(["cat_ears"]);
    expect(skus("wear")).toEqual([]);
    // Seasonal stock stays on its section's shelf, tagged.
    expect(skus("garden")).toEqual(["pumpkin_seed"]);
    expect(skus("decor")).toEqual(["lantern"]);
    // Midwinter names its shelf too, and without a holiday there is no holiday shelf.
    expect(
      shelvesOf({ items: [], holiday: { id: "midwinter", lastDay: dayOfDate(2026, 12, 31) } })[0]
        ?.title,
    ).toBe("For Midwinter");
    expect(shelvesOf({ items: [...items] }).map((s) => s.key)).toEqual(
      SHELVES.map((s) => s.section),
    );
  });

  it("puts the Recipes shelf after a holiday's and before the sections, once there are cards", () => {
    const card = { kind: "lemonade" } as never;
    expect(shelvesOf({ items: [], recipes: [card] }).map((s) => s.key)[0]).toBe("recipes");
    expect(shelvesOf({ items: [], recipes: [] }).some((s) => s.key === "recipes")).toBe(false);
  });

  it("says when a holiday's shelf goes, and what a kitchen makes for it any day", () => {
    expect(holidayHint("halloween", dayOfDate(2026, 11, 1))).toBe(
      "Sold until November 1 (UTC). Costumes and decor are yours for good, and a kitchen makes candy any day.",
    );
    expect(holidayHint("midwinter", dayOfDate(2026, 12, 31))).toBe(
      "Sold until December 31 (UTC). A kitchen makes candy canes any day, five from a bunch of herbs and a bag of sugar.",
    );
    // A holiday this client doesn't know yet still says when.
    expect(holidayHint("spring_fair", dayOfDate(2027, 4, 2))).toBe("Sold until April 2 (UTC).");
  });
});

describe("listOf", () => {
  it("joins names in plain English", () => {
    expect(listOf([])).toBe("");
    expect(listOf(["lemons"])).toBe("lemons");
    expect(listOf(["lemons", "jam"])).toBe("lemons and jam");
    expect(listOf(["lemons", "jam", "tea"])).toBe("lemons, jam, and tea");
  });
});
