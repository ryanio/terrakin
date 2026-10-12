import { BUY_ORDERS, SHOP_CATALOG } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { asksFor, listingAction, othersAsk, suggestedPrice, townLine } from "./market-view";

describe("the market page", () => {
  const listing = { price: 12, seller: { id: "r_ada" } };

  it("offers Buy, Take back on your own, and nothing when signed out", () => {
    expect(listingAction(listing, null, null)).toEqual({ kind: "none", text: "", can: false });
    expect(listingAction(listing, "r_ada", 50)).toEqual({
      kind: "take",
      text: "Take back",
      can: true,
    });
    expect(listingAction(listing, "r_bob", 50)).toEqual({
      kind: "buy",
      text: "Buy for 12 coins",
      can: true,
    });
    expect(listingAction(listing, "r_bob", 10)).toEqual({
      kind: "buy",
      text: "2 coins short",
      can: false,
    });
  });

  it("says whether the town buys the picked thing today, some days, or never", () => {
    const lemons = { kind: "lemon" as const, name: "Lemons", price: 2, perDay: 5 };
    const jars = { sku: "jar" as const, name: "Jar", price: 3, section: "pantry" as const };
    const buying = (...orders: (typeof lemons & { left?: number })[]) => ({
      buying: orders,
      items: [jars],
    });
    expect(townLine("lemon", null)).toBeNull();
    expect(townLine("lemon", buying({ ...lemons, left: 3 }))).toEqual({
      text: "The town buys lemons today for 2 coins each, 3 more from you. That pays now, where a listing waits for a neighbor.",
      sell: true,
    });
    expect(townLine("lemon", buying(lemons))?.sell).toBe(true);
    expect(townLine("lemon", buying({ ...lemons, left: 0 }))).toEqual({
      text: "You've sold the town all the lemons it takes from you today.",
      sell: false,
    });
    // Lemons have a buy order but aren't on today's list; acorns and jars have none at all.
    expect(townLine("lemon", buying())).toEqual({
      text: "The town buys lemons on some days, not today.",
      sell: false,
    });
    expect(townLine("acorn", buying(lemons))).toEqual({
      text: "The town never buys acorns, so the market is where they find a new home.",
      sell: false,
    });
    expect(townLine("jar", buying(lemons))).toEqual({
      text: "The town never buys jars, and the shop sells them for 3 coins each, so a neighbor won't pay more than that here.",
      sell: false,
    });
  });

  it("says what other sellers ask a thing, leaving out your own listings", () => {
    const lot = (kind: "acorn" | "wood", count: number, price: number, seller = "r_bob") => ({
      kind,
      count,
      price,
      seller: { id: seller },
    });
    const asks = (...lots: ReturnType<typeof lot>[]) => asksFor("acorn", lots, "r_ada");
    expect(asks(lot("acorn", 1, 4), lot("acorn", 3, 2))).toEqual([2 / 3, 4]);
    expect(othersAsk("acorn", asks())).toBe("Nobody else has acorns listed right now.");
    expect(othersAsk("acorn", asks(lot("acorn", 1, 9, "r_ada"), lot("wood", 1, 2)))).toBe(
      "Nobody else has acorns listed right now.",
    );
    expect(othersAsk("acorn", asks(lot("acorn", 2, 2)))).toBe(
      "One other listing asks 1 coin each.",
    );
    expect(othersAsk("acorn", asks(lot("acorn", 3, 2), lot("acorn", 1, 4)))).toBe(
      "2 other listings ask 0.7 to 4 coins each.",
    );
  });

  it("starts a price at what the town pays, else the shop's, else the cheapest ask, else 3 a thing", () => {
    expect(suggestedPrice("lemon_jam", 2, [1])).toBe(BUY_ORDERS.lemon_jam.price * 2);
    expect(suggestedPrice("lantern", 1)).toBe(SHOP_CATALOG.lantern.price);
    expect(suggestedPrice("jar", 3)).toBe(SHOP_CATALOG.jar.price * 3);
    expect(suggestedPrice("acorn", 3, [2 / 3, 4])).toBe(2);
    expect(suggestedPrice("acorn", 1, [0.4])).toBe(1);
    expect(suggestedPrice("acorn", 2)).toBe(6);
  });
});
