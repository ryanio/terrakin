import { SHOP_ITEMS } from "@terrakin/protocol";
import { dayOfDate } from "@terrakin/sim";
import { listOf } from "@terrakin/ui/format";
import { describe, expect, it } from "vitest";
import { buyLabel, holidayHint, SHELVES, sellable } from "./shop-view";

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
