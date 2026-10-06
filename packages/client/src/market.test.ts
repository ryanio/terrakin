import { BUY_ORDERS, SHOP_CATALOG } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { listingAction, suggestedPrice } from "./market-view";

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

  it("starts a price at what the town pays, else the shop's price, else 3 a thing", () => {
    expect(suggestedPrice("lemon_jam", 2)).toBe(BUY_ORDERS.lemon_jam.price * 2);
    expect(suggestedPrice("lantern", 1)).toBe(SHOP_CATALOG.lantern.price);
    expect(suggestedPrice("jar", 3)).toBe(SHOP_CATALOG.jar.price * 3);
  });
});
