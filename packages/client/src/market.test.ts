import type { PlotSaleView } from "@terrakin/protocol";
import { BUY_ORDERS, SHOP_CATALOG } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import {
  asksFor,
  boughtLine,
  othersAsk,
  potAsks,
  potPrice,
  potPriceLine,
  suggestedPrice,
  townLine,
} from "./market-view";
import { listingAction } from "./market-words";
import {
  listingFacts,
  ownPlotLine,
  ownPlotTitle,
  plotMarketProblem,
  priceProblem,
  saleRows,
} from "./plot-market";

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

describe("what you bought (RFC 0047)", () => {
  it("names a pot by its finish, glaze and kind, and who made it", () => {
    const maker = { id: "r_w", name: "Wren", kind: "human" } as never;
    expect(
      boughtLine({
        kind: "vase",
        count: 1,
        name: "Crackle sea vase",
        goods: [{ id: "i_1", maker, madeDay: 1, glaze: "sea", finish: "crackle" }],
      }),
    ).toBe("You bought a crackle sea vase made by Wren.");
    expect(boughtLine({ kind: "lemon", count: 3, name: "3 lemons" })).toBe("You bought 3 lemons.");
  });
  it("holds Buy back while the world wouldn't sell to you, with its words", () => {
    const l = { price: 5, seller: { id: "bo" } };
    expect(listingAction(l, "me", 50, "You can buy in the market from your second day.")).toEqual({
      kind: "buy",
      text: "Not yet",
      can: false,
    });
    expect(listingAction(l, "me", 50).can).toBe(true);
  });
});

describe("a pot's price hint (RFC 0047)", () => {
  it("starts from a default by kind and finish, then from what sellers here ask", () => {
    expect(potPrice("bowl", "smooth", [])).toBe(10);
    expect(potPrice("vase", "crackle", [])).toBe(48);
    expect(potPrice("bowl", "speckled", [9, 14, 30])).toBe(14);
    expect(potPriceLine("bowl", "speckled", [])).toBe(
      "Speckled bowls usually go for about 15 coins. A crackle or iridescent finish fetches more.",
    );
    expect(potPriceLine("vase", "smooth", [20])).toBe(
      "Smooth vases listed here ask about 20 coins.",
    );
    const seller = (id: string) => ({ id });
    const listing = (finish: string, price: number, who = "bo") =>
      ({
        kind: "bowl",
        count: 1,
        price,
        seller: seller(who),
        goods: [{ id: "i_1", kind: "bowl", maker: who, finish }],
      }) as never;
    expect(
      potAsks(
        "bowl",
        "speckled",
        [listing("speckled", 12), listing("smooth", 8), listing("speckled", 20, "me")],
        "me",
      ),
    ).toEqual([12]);
  });
});

describe("plots for sale (RFC 0039)", () => {
  const rules = { listingFee: 25, settleDays: 14, priceMax: 100_000, feePercent: 5 };

  it("says every refusal in the page's words, and the world's plain ones as they are", () => {
    const cases: [code: string, message: string, move: "buy" | "list" | "unlist", says: string][] =
      [
        [
          "market_closed",
          "Plots aren't for sale in this world yet.",
          "buy",
          "Plots aren't on sale yet.",
        ],
        ["not_joined", "Join the world first.", "buy", "Join Terrakin to buy or sell a plot."],
        [
          "not_eligible",
          "Something is on display on that plot, and it stays whoever put it up. Take it down first.",
          "list",
          "Something is on display on that plot, and it stays whoever put it up. Take it down first.",
        ],
        [
          "not_eligible",
          "Townsfolk don't trade. Their plots are the town's.",
          "buy",
          "Townsfolk don't trade. Their plots are the town's.",
        ],
        [
          "out_of_bounds",
          "Name a plot by its px and py.",
          "list",
          "That plot isn't there anymore. Open the market again.",
        ],
        [
          "not_your_plot",
          "You can only sell a plot you own.",
          "list",
          "You can only sell a plot you own.",
        ],
        [
          "invalid_amount",
          "A price is a whole number of coins from 1 to 100000.",
          "list",
          "A price is a whole number of coins from 1 to 100,000 coins.",
        ],
        [
          "plot_listed",
          "That plot is already for sale. Take it back with unlist_plot to change its price.",
          "list",
          "This plot is already for sale. Take it back first to change its price.",
        ],
        [
          "unknown_listing",
          "That plot isn't for sale. GET /v1/plot-market lists the ones that are.",
          "buy",
          "That plot isn't for sale anymore. Someone bought it, or its owner took it back.",
        ],
        [
          "unknown_listing",
          "You have no plot for sale there. GET /v1/plot-market lists them.",
          "unlist",
          "That plot isn't for sale anymore.",
        ],
        [
          "own_listing",
          'That\'s your own plot. Take it back with {"type": "unlist_plot", "px": 0, "py": 0}.',
          "buy",
          "That's your own plot. Take it back from Your plots instead.",
        ],
        [
          "plot_limit",
          "You already own a plot, and a resident owns one here.",
          "buy",
          "You already own a plot, and a resident owns one here.",
        ],
        [
          "plot_limit",
          "You already own 3 plots, the most a resident can.",
          "buy",
          "You already own 3 plots, the most a resident can. Sell one first.",
        ],
        [
          "not_enough_coins",
          "That plot is 300 coins, and you have 120 coins.",
          "buy",
          "That plot is 300 coins, and you have 120 coins.",
        ],
      ];
    for (const [code, message, move, says] of cases) {
      const line = plotMarketProblem(code, message, rules, move);
      expect(line, `${code} ${move}`).toBe(says);
      expect(line, code).not.toMatch(/unlist_plot|\/v1\/|\bp[xy]\b|\{/);
    }
  });

  it("checks a price before it's sent", () => {
    for (const typed of ["", " ", "0", "-3", "2.5", "100001", "lots"]) {
      expect(priceProblem(typed, rules), typed).toBe(
        "A price is a whole number of coins from 1 to 100,000 coins.",
      );
    }
    for (const typed of ["1", "400", "100000"]) expect(priceProblem(typed, rules)).toBeNull();
  });

  it("says what stands on a plot for sale, and when it went up once the day is known", () => {
    expect(listingFacts({ blocks: 12, floors: 1, day: 100 }, 102)).toBe(
      "12 blocks and an upstairs. Listed 2 days ago.",
    );
    expect(listingFacts({ blocks: 1, day: 100 }, 100)).toBe("1 block. Listed today.");
    expect(listingFacts({ blocks: 30, floors: 2, day: 100 }, 101)).toBe(
      "30 blocks and 2 floors up. Listed yesterday.",
    );
    expect(listingFacts({ blocks: 0, day: 100 }, undefined)).toBe("Nothing built on it yet.");
    // Graded walls (RFC 0051), so a buyer sees what the home is made of.
    expect(listingFacts({ blocks: 20, day: 100, walls: { fine: 8, masterwork: 2 } }, 100)).toBe(
      "20 blocks. 8 fine walls, 2 masterwork walls. Listed today.",
    );
  });

  it("lays out what a dry run says a sale moves", () => {
    const sale: PlotSaleView = {
      px: 0,
      py: 0,
      price: 400,
      fee: 20,
      sellerGets: 380,
      listingFee: 25,
      balanceAfter: 75,
      clearsHearth: true,
      note: "x",
    };
    expect(saleRows({ ...sale, balanceAfter: 100 }, "buy", rules)).toEqual([
      { label: "Price", value: "400 coins" },
      { label: "Your coins after", value: "100 coins" },
    ]);
    expect(saleRows(sale, "list", rules)).toEqual([
      { label: "Listing costs now", value: "25 coins" },
      { label: "When it sells, after the town's 5%", value: "380 coins" },
      { label: "Your coins after", value: "75 coins" },
    ]);
  });

  it("gives each of your plots its line: for sale, ready to sell, or why not", () => {
    const plot = { px: 0, py: 0, canList: false, listed: true };
    expect(ownPlotLine(plot, { price: 400 }, rules)).toBe("For sale at 400 coins");
    expect(ownPlotLine({ ...plot, listed: false, canList: true }, undefined, rules)).toBeNull();
    const why =
      "A plot can be sold 14 days after it was claimed or bought. This one can be in 3 days.";
    expect(ownPlotLine({ ...plot, listed: false, why }, undefined, rules)).toBe(why);
  });

  it("names each of your plots so no two rows read the same", () => {
    const at = { px: 3, py: 2 };
    expect(ownPlotTitle(at, "Lemon Grove", true)).toEqual({
      title: "Lemon Grove",
      sell: "Sell Lemon Grove",
    });
    expect(ownPlotTitle(at, undefined, true)).toEqual({
      title: "Your home",
      sell: "Sell your home",
    });
    expect(ownPlotTitle(at, undefined, false)).toEqual({
      title: "Your plot at (3, 2)",
      sell: "Sell your plot at (3, 2)",
    });
    expect(ownPlotTitle({ px: 4, py: 2 }, undefined, false).title).not.toBe(
      ownPlotTitle(at, undefined, false).title,
    );
  });
});
