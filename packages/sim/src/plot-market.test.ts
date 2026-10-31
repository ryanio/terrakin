import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import {
  PLOT_MARKET_CONFIG,
  PLOT_MARKET_DAY,
  PLOT_MARKET_HASH,
  PLOT_MARKET_LOG,
  PLOT_MARKET_SETUP,
} from "./fixtures/plot-market-log";
import { hashWorld } from "./hash";
import { PLOTS, plotListing } from "./plot-market";
import { replay } from "./replay";
import { expectSupplyHolds, fund } from "./test-support";
import { type Command, type Input, type RejectionCode, TOWN_ACTOR, type WorldState } from "./types";
import { route, worldGround } from "./walk";
import { createWorld, plotsOwnedBy } from "./world";

/**
 * The plot market (RFC 0039, decision 0344). It moves the largest sums in the game between
 * residents and loosens one money guard (a sale skips the gift caps), so what these protect is:
 * that a listed plot is frozen against every rule that changes a plot, that the household refusal
 * runs, that coins are conserved through a sale, and that a refusal leaves the world as it was.
 */

/** The fixture's world on the first day Ada may list, nothing listed yet. */
function world(): WorldState {
  return replay(PLOT_MARKET_CONFIG, PLOT_MARKET_SETUP);
}

function ok(state: WorldState, actor: string, command: Command) {
  const result = apply(state, { actor, command });
  if (!result.ok)
    throw new Error(`${actor} ${JSON.stringify(command)}: ${result.rejection.message}`);
  expectSupplyHolds(state);
  return result.events;
}

function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(
    result.ok ? "accepted" : result.rejection.code,
    `${actor} ${JSON.stringify(command)}`,
  ).toBe(code);
  expect(hashWorld(state)).toBe(before);
}

/** Walks a resident to a tile, around whatever stands between. */
function walkTo(state: WorldState, actor: string, to: { x: number; y: number }) {
  const me = state.residents[actor];
  if (!me) throw new Error(`no ${actor}`);
  for (const dir of route(worldGround(state), me, to)) ok(state, actor, { type: "move", dir });
  expect({ x: me.x, y: me.y }).toEqual(to);
}

const list = (price = 300): Command => ({ type: "list_plot", px: 0, py: 0, price });
const buy: Command = { type: "buy_plot", px: 0, py: 0, price: 300 };

describe("opening the plot market", () => {
  it("waits for the item market and for a second land, so free land exists whenever prices do", () => {
    const state = createWorld(PLOT_MARKET_CONFIG);
    for (const command of [
      { type: "new_day", day: PLOT_MARKET_DAY },
      { type: "open_economy" },
      { type: "open_items" },
      { type: "open_shop" },
    ] as Command[]) {
      ok(state, TOWN_ACTOR, command);
    }
    refused(state, TOWN_ACTOR, { type: "open_plot_market", maxPlotsPerResident: 3 }, "not_due");
    ok(state, TOWN_ACTOR, { type: "open_market" });
    refused(state, TOWN_ACTOR, { type: "open_plot_market", maxPlotsPerResident: 3 }, "not_due");
  });

  it("raises the plot cap in the same input, and never lowers it", () => {
    const state = replay(
      PLOT_MARKET_CONFIG,
      PLOT_MARKET_SETUP.filter((i) => i.command.type !== "open_plot_market"),
    );
    const open = (cap: number): Command => ({ type: "open_plot_market", maxPlotsPerResident: cap });
    refused(state, TOWN_ACTOR, open(0), "invalid_amount");
    refused(state, TOWN_ACTOR, open(2.5), "invalid_amount");
    refused(state, TOWN_ACTOR, open(PLOTS.capMax + 1), "invalid_amount");
    expect(ok(state, TOWN_ACTOR, open(3))).toEqual([
      { type: "plot_market_opened", maxPlotsPerResident: 3 },
    ]);
    expect(state.config.maxPlotsPerResident).toBe(3);
    refused(state, TOWN_ACTOR, open(3), "already_open");
  });

  it("refuses every plot command before it opens", () => {
    const state = replay(PLOT_MARKET_CONFIG, PLOT_MARKET_SETUP.slice(0, 6));
    refused(state, TOWN_ACTOR, { type: "remove_plot_listing", px: 0, py: 0 }, "market_closed");
  });
});

describe("listing a plot", () => {
  it("refuses a plot that isn't yours, one claimed too lately, one on the island, and a bad price", () => {
    const state = world();
    refused(state, "bob", list(), "not_your_plot");
    // Eve shares the plot, but only its owner sells it.
    refused(state, "eve", list(), "not_your_plot");
    refused(state, "ada", list(0), "invalid_amount");
    refused(state, "ada", list(1.5), "invalid_amount");
    refused(state, "dee", { type: "list_plot", px: 4, py: 0, price: 300 }, "not_eligible");
    const early = replay(PLOT_MARKET_CONFIG, [
      ...PLOT_MARKET_SETUP.slice(0, -1),
      {
        actor: TOWN_ACTOR,
        command: { type: "new_day", day: PLOT_MARKET_DAY + PLOTS.settleDays - 1 },
      },
    ]);
    refused(early, "ada", list(), "not_yet");
  });

  it("refuses a plot with a pot set down on it, which stays whoever set it down's (RFC 0047)", () => {
    const state = world();
    const items = state.items;
    if (!items) throw new Error("no items");
    const good = {
      id: "i_99",
      kind: "vase" as const,
      maker: "ada",
      madeDay: 0,
      glaze: "sea" as const,
    };
    items.pots = { "6,6": { good, by: "ada", day: 0 } };
    refused(state, "ada", list(), "not_eligible");
    delete items.pots;
    ok(state, "ada", list());
  });

  it("burns the listing fee, and refuses a second listing or one its seller can't pay for", () => {
    const state = world();
    const burned = state.economy?.burned ?? 0;
    // Ada's first act of the day also pays her allowance, so the fee is read from its own line.
    const events = ok(state, "ada", list());
    expect(state.economy?.burned).toBe(burned + PLOTS.listingFee);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "coins",
        residentId: "ada",
        amount: -PLOTS.listingFee,
        reason: "plot_listing_fee",
      }),
    );
    expect(plotListing(state, 0, 0)).toMatchObject({ seller: "ada", price: 300 });
    refused(state, "ada", list(400), "plot_listed");
    // Taking it back keeps the fee burned.
    ok(state, "ada", { type: "unlist_plot", px: 0, py: 0 });
    expect(state.economy?.burned).toBe(burned + PLOTS.listingFee);
    const broke = world();
    const econ = broke.economy;
    if (!econ) throw new Error("no economy");
    econ.burned += econ.coins.ada ?? 0;
    delete econ.coins.ada;
    refused(broke, "ada", list(), "not_enough_coins");
  });
});

describe("a listed plot is frozen", () => {
  // Every rule that changes a plot, tried on a listed one by its owner, a co-owner, and staff. A
  // rule that forgets to ask compiles and passes everything else, so a new one belongs here.
  // `set_circle_hall` asks too and is the one left out, because only a formed circle has a hall
  // and forming takes three households.
  const frozen: [actor: string, command: Command][] = [
    ["ada", { type: "place", x: 2, y: 2, block: "wood" }],
    ["eve", { type: "name_plot", px: 0, py: 0, name: "Eve's Corner" }],
    ["ada", { type: "remove", x: 1, y: 1 }],
    ["ada", { type: "lay", x: 3, y: 6, ground: "dirt" }],
    ["ada", { type: "lift", x: 3, y: 6 }],
    ["ada", { type: "build", px: 0, py: 0, remove: [{ x: 1, y: 1 }] }],
    ["ada", { type: "build_starter_home" }],
    ["ada", { type: "add_floor", px: 0, py: 0 }],
    ["ada", { type: "set_roof", px: 0, py: 0, style: "gable", material: "wood" }],
    ["ada", { type: "set_hearth", x: 2, y: 3 }],
    ["ada", { type: "share_plot", with: "bob" }],
    ["ada", { type: "unshare_plot", with: "eve" }],
    ["ada", { type: "release" }],
    ["ada", { type: "plant", x: 2, y: 2, seed: "herb" }],
    ["ada", { type: "harvest", x: 2, y: 2 }],
    ["ada", { type: "set_gallery", px: 0, py: 0, open: true }],
    ["ada", { type: "name_plot", px: 0, py: 0, name: "Ada's Corner" }],
    ["ada", { type: "display", item: "i_1", x: 2, y: 2 }],
    ["ada", { type: "put_on", x: 2, y: 2, item: "candle" }],
    ["ada", { type: "take_off", x: 2, y: 2 }],
    ["ada", { type: "hang", x: 2, y: 2, side: "n", item: "mirror" }],
    ["ada", { type: "unhang", x: 2, y: 2, side: "n" }],
    // Walls between tiles (RFC 0050).
    ["ada", { type: "place", x: 2, y: 2, side: "n", block: "wood" }],
    ["ada", { type: "remove", x: 2, y: 2, side: "n" }],
    ["ada", { type: "build", px: 0, py: 0, edges: [{ x: 2, y: 2, side: "n", block: "wood" }] }],
    ["ada", { type: "slim_walls", px: 0, py: 0, remove: [{ x: 1, y: 1 }], edges: [] }],
    [
      "ada",
      {
        type: "schedule_event",
        kind: "gathering",
        title: "Tea",
        px: 0,
        py: 0,
        startsAt: (PLOT_MARKET_DAY + 15) * 86_400_000 + 18 * 3_600_000,
        minutes: 60,
      },
    ],
    [TOWN_ACTOR, { type: "clear_block", x: 1, y: 1 }],
    [TOWN_ACTOR, { type: "clear_block", x: 2, y: 2, side: "n" }],
    [TOWN_ACTOR, { type: "open_way", tiles: [[0, 7]] }],
    [
      TOWN_ACTOR,
      { type: "rebuild_home", px: 0, py: 0, blocks: [{ x: 0, y: 7, block: "door" }], remove: [] },
    ],
  ] as [string, Command][];

  it.each(frozen)("%s %j is refused with plot_listed", (actor, command) => {
    const state = world();
    ok(state, "ada", list());
    refused(state, actor, command, "plot_listed");
  });

  it("thaws when its owner takes it back", () => {
    const state = world();
    ok(state, "ada", list());
    ok(state, "ada", { type: "unlist_plot", px: 0, py: 0 });
    ok(state, "ada", { type: "place", x: 2, y: 2, block: "wood" });
  });

  it("thaws when staff take it off the market, and the fee stays burned", () => {
    const state = world();
    ok(state, "ada", list());
    const burned = state.economy?.burned;
    expect(ok(state, TOWN_ACTOR, { type: "remove_plot_listing", px: 0, py: 0 })).toEqual([
      { type: "plot_listing_removed", px: 0, py: 0, seller: "ada" },
    ]);
    expect(state.economy?.burned).toBe(burned);
    ok(state, "ada", { type: "place", x: 2, y: 2, block: "wood" });
  });
});

describe("buying a plot", () => {
  it("refuses a sale inside one household, which is the guard the gift caps' exemption leans on", () => {
    const state = world();
    ok(state, "ada", list());
    // Cy is Ada's AI, with the coins to pay.
    refused(state, "cy", buy, "not_eligible");
  });

  it("pays only the price the buyer sent, so a plot listed again at another price is refused", () => {
    const state = world();
    ok(state, "ada", list(300));
    ok(state, "ada", { type: "unlist_plot", px: 0, py: 0 });
    ok(state, "ada", list(900));
    // Bob saw it at 300 and has the coins for 900: he pays neither.
    refused(state, "bob", buy, "price_changed");
    refused(state, "bob", { type: "buy_plot", px: 0, py: 0, price: 1000 }, "price_changed");
    refused(state, "bob", { type: "buy_plot", px: 0, py: 0 } as Command, "invalid_amount");
    ok(state, "bob", { type: "buy_plot", px: 0, py: 0, price: 900 });
  });

  it("refuses your own plot, a buyer at the plot cap, one who can't pay, and a plot not for sale", () => {
    const state = world();
    refused(state, "bob", buy, "unknown_listing");
    ok(state, "ada", list());
    refused(state, "ada", buy, "own_listing");
    refused(state, "eve", buy, "not_enough_coins");
  });

  it("moves the plot as it stands and the coins less the fee, and clears what was a person's", () => {
    const state = world();
    ok(state, "ada", list());
    const blocks = JSON.stringify(state.blocks);
    const econ = state.economy;
    if (!econ) throw new Error("no economy");
    const before = { ada: econ.coins.ada ?? 0, bob: econ.coins.bob ?? 0, treasury: econ.treasury };
    const events = ok(state, "bob", buy);
    expect(state.plots["0,0"]?.ownerId).toBe("bob");
    expect(state.plots["0,0"]?.coOwners).toBeUndefined();
    expect(JSON.stringify(state.blocks)).toBe(blocks);
    expect(state.residents.ada?.hearth).toBeNull();
    expect(econ.coins.bob).toBe(before.bob - 300);
    expect(econ.coins.ada).toBe(before.ada + 285);
    expect(econ.treasury).toBe(before.treasury + 15);
    expect(plotListing(state, 0, 0)).toBeUndefined();
    expect(events).toContainEqual({ type: "plot_unshared", px: 0, py: 0, residentId: "eve" });
    expect(events).toContainEqual({ type: "hearth_cleared", residentId: "ada" });
    expect(events.at(-1)).toEqual({
      type: "plot_sold",
      px: 0,
      py: 0,
      seller: "ada",
      buyer: "bob",
      price: 300,
    });
    // A bought plot waits out the cooling-off like a claimed one, so it can't be flipped at once.
    refused(state, "bob", list(), "not_yet");
  });

  it("leaves a co-owner who buys the plot they live on their hearth, and clears the seller's", () => {
    const state = world();
    walkTo(state, "eve", { x: 2, y: 4 });
    ok(state, "eve", { type: "set_hearth", x: 2, y: 3 });
    fund(state, "eve", 300);
    ok(state, "ada", list());
    const events = ok(state, "eve", buy);
    expect(state.plots["0,0"]?.ownerId).toBe("eve");
    expect(state.residents.eve?.hearth).toEqual({ x: 2, y: 3 });
    expect(state.residents.ada?.hearth).toBeNull();
    expect(events.filter((e) => e.type === "hearth_cleared")).toEqual([
      { type: "hearth_cleared", residentId: "ada" },
    ]);
  });

  it("is the only way to a second plot: claim and settle take only a first one, before the switch and after it", () => {
    // Ada owns plot (0, 0) and stands in plot (1, 0), which nobody has claimed.
    const free = { x: 9, y: 2 };
    const before = replay(
      PLOT_MARKET_CONFIG,
      PLOT_MARKET_SETUP.filter((i) => i.command.type !== "open_plot_market"),
    );
    walkTo(before, "ada", free);
    refused(before, "ada", { type: "claim" }, "plot_limit");
    const after = world();
    expect(after.config.maxPlotsPerResident).toBe(3);
    walkTo(after, "ada", free);
    refused(after, "ada", { type: "claim" }, "plot_limit");
    refused(after, "ada", { type: "settle", px: 1, py: 0 }, "plot_limit");
    // A first plot is still free: Bob, who has none, claims one, and is refused a second.
    walkTo(after, "bob", { x: 17, y: 2 });
    ok(after, "bob", { type: "claim" });
    walkTo(after, "bob", { x: 17, y: 10 });
    refused(after, "bob", { type: "claim" }, "plot_limit");

    // Fay and Gus settle downtown and wait out the cooling-off; then Ada, Fay and Gus list, and
    // Dee, who lives on the island, buys two plots and is refused a third.
    const town = (command: Command): Input => ({ actor: TOWN_ACTOR, command });
    const later = replay(PLOT_MARKET_CONFIG, [
      ...PLOT_MARKET_SETUP,
      { actor: "fay", command: { type: "join", name: "Fay", kind: "human" } },
      { actor: "fay", command: { type: "settle", px: 2, py: 0 } },
      { actor: "gus", command: { type: "join", name: "Gus", kind: "human" } },
      { actor: "gus", command: { type: "settle", px: 0, py: 2 } },
      town({ type: "test_grant", to: "fay", coins: 100 }),
      town({ type: "test_grant", to: "gus", coins: 100 }),
      town({ type: "test_grant", to: "dee", coins: 2000 }),
      town({ type: "new_day", day: PLOT_MARKET_DAY + 28 }),
    ]);
    ok(later, "ada", list(300));
    ok(later, "fay", { type: "list_plot", px: 2, py: 0, price: 300 });
    ok(later, "gus", { type: "list_plot", px: 0, py: 2, price: 300 });
    ok(later, "dee", buy);
    ok(later, "dee", { type: "buy_plot", px: 2, py: 0, price: 300 });
    expect(plotsOwnedBy(later, "dee")).toHaveLength(3);
    refused(later, "dee", { type: "buy_plot", px: 0, py: 2, price: 300 }, "plot_limit");
  });

  it("replays its fixture to the hash pinned when it landed", () => {
    const state = createWorld(PLOT_MARKET_CONFIG);
    for (const input of PLOT_MARKET_LOG) {
      const result = apply(state, input);
      expect(result.ok, `${input.actor} ${input.command.type}`).toBe(true);
      expectSupplyHolds(state);
    }
    expect(hashWorld(state)).toBe(PLOT_MARKET_HASH);
  });
});
