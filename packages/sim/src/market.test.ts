import { describe, expect, it } from "vitest";
import { apply, prepare } from "./apply";
import { MARKET_CONFIG, MARKET_HASH, MARKET_LOG } from "./fixtures/market-log";
import { hashWorld } from "./hash";
import { type GoodKind, ITEMS, inventorySize } from "./items";
import { listingsOf, MARKET, marketFee, stallOf, takenDownOf } from "./market";
import { replay } from "./replay";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type Command,
  type Good,
  type Input,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const PLOTS = [
  [0, 0],
  [2, 0],
  [0, 2],
] as const;
const DAY = 20_000;

/**
 * A world with coins, items, the shop, and the market open, and Ada and Bob settled. Every input
 * checks the supply identity, every rejection that nothing changed, and every inventory its cap.
 */
function market() {
  const state = createWorld(CONFIG);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    else expect(hashWorld(state)).toBe(before);
    expectSupplyHolds(state);
    for (const inv of Object.values(state.items?.inventories ?? {})) {
      expect(inventorySize(inv)).toBeLessThanOrEqual(ITEMS.inventoryMax);
      for (const n of Object.values(inv.stacks)) expect(n).toBeGreaterThan(0);
    }
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const code = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? null : result.rejection.code;
  };
  const town = (command: Command) => ok(TOWN_ACTOR, command);
  const settle = (name: string, n: number) => {
    const [px, py] = PLOTS[n] ?? [0, 0];
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  };
  town({ type: "new_day", day: DAY });
  town({ type: "open_economy" });
  town({ type: "open_items" });
  town({ type: "open_shop" });
  town({ type: "open_market" });
  settle("ada", 0);
  settle("bob", 1);
  // Their second day: nobody buys in the market on their first.
  town({ type: "new_day", day: DAY + 1 });
  // Collect the day's allowance now, so it doesn't land in the middle of a trade.
  ok("ada", { type: "home" });
  ok("bob", { type: "home" });
  const coins = (id: string) => state.economy?.coins[id] ?? 0;
  const has = (id: string, kind: "lemon" | "lantern") =>
    state.items?.inventories[id]?.stacks[kind] ?? 0;
  const goods = (id: string) => state.items?.inventories[id]?.goods ?? [];
  return { state, log, send, ok, code, town, settle, coins, has, goods };
}

/** Put a made thing straight into someone's things, as crafting would. */
function make(state: WorldState, id: string, kind: GoodKind, label?: string): Good {
  const items = state.items;
  if (!items) throw new Error("open items first");
  const good: Good = {
    id: `i_${items.nextId++}`,
    kind,
    maker: id,
    madeDay: state.day ?? 0,
    ...(label ? { label } : {}),
  };
  const inv = items.inventories[id] ?? { stacks: {}, goods: [] };
  inv.goods.push(good);
  items.inventories[id] = inv;
  return good;
}

const list = (item: string, price: number, count?: number): Command => ({
  type: "list_item",
  item,
  price,
  ...(count === undefined ? {} : { count }),
});

describe("open_market", () => {
  it("only comes from the server, once, after the shop", () => {
    const state = createWorld(CONFIG);
    const send = (actor: string, command: Command) => apply(state, { actor, command });
    send(TOWN_ACTOR, { type: "new_day", day: DAY });
    send(TOWN_ACTOR, { type: "open_economy" });
    send(TOWN_ACTOR, { type: "open_items" });
    expect(send(TOWN_ACTOR, { type: "open_market" })).toMatchObject({
      ok: false,
      rejection: { code: "not_due" },
    });
    send(TOWN_ACTOR, { type: "open_shop" });
    send("ada", { type: "join", name: "ada", kind: "human" });
    expect(send("ada", { type: "open_market" })).toMatchObject({
      ok: false,
      rejection: { code: "server_only" },
    });
    expect(send(TOWN_ACTOR, { type: "open_market" })).toMatchObject({
      ok: true,
      events: [{ type: "market_opened" }],
    });
    expect(state.market).toEqual({ nextId: 1, listings: {} });
    expect(send(TOWN_ACTOR, { type: "open_market" })).toMatchObject({
      ok: false,
      rejection: { code: "already_open" },
    });
  });

  it("replays a log with trades to the hash pinned when the market landed", () => {
    const state = replay(MARKET_CONFIG, MARKET_LOG);
    expect(hashWorld(state)).toBe(MARKET_HASH);
    expect(state.market?.nextId).toBe(3);
    expect(state.items?.inventories.bob?.stacks.fence).toBe(1);
  });

  it("refuses every market action while it's closed", () => {
    const state = createWorld(CONFIG);
    apply(state, { actor: TOWN_ACTOR, command: { type: "new_day", day: DAY } });
    apply(state, { actor: "ada", command: { type: "join", name: "ada", kind: "human" } });
    for (const command of [
      list("lemon", 5),
      { type: "unlist_item", listing: "l_1" },
      { type: "buy_listing", listing: "l_1" },
    ] as Command[]) {
      expect(apply(state, { actor: "ada", command })).toMatchObject({
        rejection: { code: "market_closed" },
      });
    }
  });
});

describe("list_item", () => {
  it("holds a stack in the listing and burns the listing fee", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 8 });
    const before = w.coins("ada");
    const burned = w.state.economy?.burned ?? 0;
    const events = w.ok("ada", list("lemon", 12, 6));
    expect(w.has("ada", "lemon")).toBe(2);
    expect(w.coins("ada")).toBe(before - MARKET.listingFee);
    expect(w.state.economy?.burned).toBe(burned + MARKET.listingFee);
    const listing = { id: "l_1", seller: "ada", kind: "lemon", count: 6, price: 12, day: DAY + 1 };
    expect(listingsOf(w.state)).toEqual([listing]);
    expect(events).toEqual([
      expect.objectContaining({ type: "coins", residentId: "ada", reason: "listing_fee" }),
      {
        type: "inventory",
        residentId: "ada",
        reason: "listed",
        changes: [{ kind: "lemon", amount: -6, count: 2 }],
      },
      { type: "listed", listing },
    ]);
  });

  it("holds made things, by id or by kind (oldest first), with their makers and labels", () => {
    const w = market();
    const first = make(w.state, "ada", "lemon_jam", "Sunny");
    const second = make(w.state, "ada", "lemon_jam");
    const tea = make(w.state, "ada", "herb_tea");
    w.ok("ada", list(tea.id, 9));
    w.ok("ada", list("lemon_jam", 20, 1));
    expect(w.goods("ada")).toEqual([second]);
    expect(stallOf(w.state, "ada")).toEqual([
      expect.objectContaining({ id: "l_1", kind: "herb_tea", count: 1, goods: [tea] }),
      expect.objectContaining({ id: "l_2", kind: "lemon_jam", count: 1, goods: [first] }),
    ]);
  });

  it("refuses bad counts and prices, missing things, no hearth, no coins, and townsfolk", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 3 });
    const jam = make(w.state, "ada", "lemon_jam");
    expect(w.code("ada", list("lemon", 0))).toBe("invalid_amount");
    expect(w.code("ada", list("lemon", MARKET.priceMax + 1))).toBe("invalid_amount");
    expect(w.code("ada", list("lemon", 1.5))).toBe("invalid_amount");
    expect(w.code("ada", list("lemon", 5, MARKET.countMax + 1))).toBe("invalid_amount");
    expect(w.code("ada", list("lemon", 5, 4))).toBe("not_enough_items");
    expect(w.code("ada", list("herb_tea", 5))).toBe("not_enough_items");
    expect(w.code("ada", list("i_999", 5))).toBe("not_enough_items");
    expect(w.code("ada", list(jam.id, 5, 2))).toBe("invalid_amount");
    expect(w.code("ada", list("pebble", 5))).toBe("unknown_item");
    // No hearth.
    w.ok("cy", { type: "join", name: "cy", kind: "human" });
    expect(w.code("cy", list("lemon", 5))).toBe("no_hearth");
    // No coins for the fee.
    const econ = w.state.economy;
    if (!econ) throw new Error("coins closed");
    econ.minted -= econ.coins.ada ?? 0;
    delete econ.coins.ada;
    expect(w.code("ada", list("lemon", 5))).toBe("not_enough_coins");
    // Townsfolk don't trade.
    w.town({ type: "set_townsfolk", ids: ["bob"] });
    expect(w.code("bob", list("lemon", 5))).toBe("not_eligible");
  });

  it("allows 20 open listings each", () => {
    const w = market();
    stock(w.state, "ada", { lemon: MARKET.listingsMax + 1 });
    for (let i = 0; i < MARKET.listingsMax; i++) w.ok("ada", list("lemon", 3));
    expect(w.code("ada", list("lemon", 3))).toBe("listing_limit");
    w.ok("ada", { type: "unlist_item", listing: "l_1" });
    w.ok("ada", list("lemon", 3));
  });
});

describe("unlist_item", () => {
  it("gives the lot back, keeps the fee, and only to its seller", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 4 });
    const jam = make(w.state, "ada", "lemon_jam", "Sunny");
    w.ok("ada", list("lemon", 10, 4));
    w.ok("ada", list(jam.id, 10));
    const coins = w.coins("ada");
    expect(w.code("bob", { type: "unlist_item", listing: "l_1" })).toBe("not_eligible");
    expect(w.code("ada", { type: "unlist_item", listing: "l_9" })).toBe("unknown_listing");
    expect(w.ok("ada", { type: "unlist_item", listing: "l_1" })).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "unlisted",
        changes: [{ kind: "lemon", amount: 4, count: 4 }],
      },
      { type: "unlisted", listing: "l_1", seller: "ada" },
    ]);
    w.ok("ada", { type: "unlist_item", listing: "l_2" });
    expect(w.goods("ada")).toEqual([jam]);
    expect(w.coins("ada")).toBe(coins);
    expect(listingsOf(w.state)).toEqual([]);
  });

  it("waits for room in your things", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 5 });
    w.ok("ada", list("lemon", 10, 5));
    stock(w.state, "ada", {
      herb: ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada),
    });
    expect(w.code("ada", { type: "unlist_item", listing: "l_1" })).toBe("inventory_full");
  });
});

describe("buy_listing", () => {
  it("pays the seller the price less the fee, the fee to the treasury, and moves the lot", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 6 });
    w.ok("ada", list("lemon", 40, 6));
    fund(w.state, "bob", 100);
    const ada = w.coins("ada");
    const bob = w.coins("bob");
    const treasury = w.state.economy?.treasury ?? 0;
    const fee = marketFee(40);
    expect(fee).toBe(2);
    const events = w.ok("bob", { type: "buy_listing", listing: "l_1" });
    expect(w.coins("bob")).toBe(bob - 40);
    expect(w.coins("ada")).toBe(ada + 40 - fee);
    expect(w.state.economy?.treasury).toBe(treasury + fee);
    expect(w.has("bob", "lemon")).toBe(6);
    expect(listingsOf(w.state)).toEqual([]);
    expect(events).toEqual([
      expect.objectContaining({
        residentId: "bob",
        amount: -40,
        reason: "market_buy",
        with: "ada",
      }),
      {
        type: "coins",
        residentId: "ada",
        amount: 40 - fee,
        balance: ada + 40 - fee,
        reason: "market_sale",
      },
      expect.objectContaining({ type: "treasury", amount: fee, reason: "market_fee" }),
      expect.objectContaining({ type: "inventory", residentId: "bob", reason: "market" }),
      { type: "listing_sold", listing: "l_1", seller: "ada", kind: "lemon", count: 6, price: 40 },
    ]);
    // The treasury's line names nobody.
    expect(w.state.economy?.treasuryLedger.at(-1)).not.toHaveProperty("with");
  });

  it("takes at least a coin, so a 1-coin sale goes all to the treasury", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 1 });
    w.ok("ada", list("lemon", 1));
    fund(w.state, "bob", 5);
    const ada = w.coins("ada");
    w.ok("bob", { type: "buy_listing", listing: "l_1" });
    expect(w.coins("ada")).toBe(ada);
    expect(marketFee(19)).toBe(1);
    expect(marketFee(20)).toBe(1);
    expect(marketFee(100)).toBe(5);
  });

  it("moves made things with their makers and labels", () => {
    const w = market();
    const jam = make(w.state, "ada", "lemon_jam", "Sunny");
    w.ok("ada", list(jam.id, 15));
    fund(w.state, "bob", 15);
    w.ok("bob", { type: "buy_listing", listing: "l_1" });
    expect(w.goods("bob")).toEqual([jam]);
  });

  it("refuses your own listing, an unknown one, too few coins, a full bag, and townsfolk", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 2 });
    w.ok("ada", list("lemon", 30, 2));
    expect(w.code("ada", { type: "buy_listing", listing: "l_1" })).toBe("own_listing");
    expect(w.code("bob", { type: "buy_listing", listing: "l_2" })).toBe("unknown_listing");
    const econ = w.state.economy;
    if (!econ) throw new Error("coins closed");
    econ.minted -= (econ.coins.bob ?? 0) - 29;
    econ.coins.bob = 29;
    expect(w.code("bob", { type: "buy_listing", listing: "l_1" })).toBe("not_enough_coins");
    fund(w.state, "bob", 1);
    stock(w.state, "bob", {
      herb: ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.bob) - 1,
    });
    expect(w.code("bob", { type: "buy_listing", listing: "l_1" })).toBe("inventory_full");
    w.town({ type: "set_townsfolk", ids: ["bob"] });
    expect(w.code("bob", { type: "buy_listing", listing: "l_1" })).toBe("not_eligible");
  });

  it("can't sell a lot twice", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 1 });
    w.ok("ada", list("lemon", 3));
    fund(w.state, "bob", 10);
    w.ok("bob", { type: "buy_listing", listing: "l_1" });
    expect(w.code("bob", { type: "buy_listing", listing: "l_1" })).toBe("unknown_listing");
    expect(w.code("ada", { type: "unlist_item", listing: "l_1" })).toBe("unknown_listing");
  });
});

describe("the market and the gift caps", () => {
  it("lets nobody buy on their first day", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 1 });
    w.ok("ada", list("lemon", 3));
    w.ok("cy", { type: "join", name: "cy", kind: "human" });
    fund(w.state, "cy", 10);
    expect(w.code("cy", { type: "buy_listing", listing: "l_1" })).toBe("gift_limit");
  });

  it("counts a seller's proceeds toward the coins they take in a day", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 2 });
    w.ok("ada", list("lemon", 600));
    w.ok("ada", list("lemon", 5));
    fund(w.state, "bob", 1_000);
    w.ok("bob", { type: "buy_listing", listing: "l_1" });
    expect(w.state.economy?.today.received.ada).toBe(600 - marketFee(600));
    expect(w.code("bob", { type: "buy_listing", listing: "l_2" })).toBe("gift_limit");
    // The cap resets with the day.
    w.town({ type: "new_day", day: DAY + 2 });
    w.ok("bob", { type: "buy_listing", listing: "l_2" });
  });

  it("counts a lot toward the things a buyer takes in a day", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 40, herb: 20 });
    w.ok("ada", list("lemon", 1, 20));
    w.ok("ada", list("lemon", 1, 20));
    w.ok("ada", list("herb", 1, 20));
    fund(w.state, "bob", 10);
    w.ok("bob", { type: "buy_listing", listing: "l_1" });
    w.ok("bob", { type: "buy_listing", listing: "l_2" });
    w.ok("bob", { type: "buy_listing", listing: "l_3" });
    expect(w.state.items?.today.received.bob).toBe(60);
    stock(w.state, "ada", { lemon: 1 });
    w.ok("ada", list("lemon", 1));
    expect(w.code("bob", { type: "buy_listing", listing: "l_4" })).toBe("gift_limit");
  });

  it("lets a person and their AI trade past the caps, as with gifts", () => {
    const w = market();
    w.town({ type: "set_owner_pairs", pairs: [["ada", "bob"]] });
    w.town({ type: "new_day", day: DAY + 2 });
    stock(w.state, "ada", { lemon: 1 });
    w.ok("ada", list("lemon", 600));
    fund(w.state, "bob", 700);
    w.ok("bob", { type: "buy_listing", listing: "l_1" });
    expect(w.state.economy?.today.received.ada).toBeUndefined();
  });

  it("lets someone who joined the townsfolk take their listings back", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 1 });
    w.ok("ada", list("lemon", 3));
    w.town({ type: "set_townsfolk", ids: ["ada"] });
    expect(w.code("ada", list("lemon", 3))).toBe("not_eligible");
    w.ok("ada", { type: "unlist_item", listing: "l_1" });
  });
});

describe("remove_listing", () => {
  const remove = (listing: string): Command => ({ type: "remove_listing", listing });

  it("only comes from the server", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 1 });
    w.ok("ada", list("lemon", 3));
    expect(w.code("ada", remove("l_1"))).toBe("server_only");
    expect(w.code("bob", remove("l_1"))).toBe("server_only");
    expect(listingsOf(w.state)).toHaveLength(1);
  });

  it("gives the lot back to its seller with its labels, and keeps the listing fee burned", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 4 });
    const jam = make(w.state, "ada", "lemon_jam", "Rude words");
    w.ok("ada", list("lemon", 10, 4));
    w.ok("ada", list(jam.id, 10));
    const coins = w.coins("ada");
    const burned = w.state.economy?.burned;
    const treasury = w.state.economy?.treasury;
    expect(w.town(remove("l_2"))).toEqual([
      { type: "inventory", residentId: "ada", reason: "taken_down", gained: [jam] },
      { type: "listing_removed", listing: "l_2", seller: "ada" },
    ]);
    expect(w.goods("ada")).toEqual([jam]);
    expect(w.town(remove("l_1"))).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "taken_down",
        changes: [{ kind: "lemon", amount: 4, count: 4 }],
      },
      { type: "listing_removed", listing: "l_1", seller: "ada" },
    ]);
    expect(w.has("ada", "lemon")).toBe(4);
    expect(listingsOf(w.state)).toEqual([]);
    expect(w.state.market?.listings).toEqual({});
    // No coins move: the fee stays burned and the seller's purse is as it was.
    expect(w.coins("ada")).toBe(coins);
    expect(w.state.economy?.burned).toBe(burned);
    expect(w.state.economy?.treasury).toBe(treasury);
  });

  it("holds the lot out of the market when the seller's things are full, until they take it back", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 5 });
    w.ok("ada", list("lemon", 10, 5));
    stock(w.state, "ada", {
      herb: ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada),
    });
    const size = inventorySize(w.state.items?.inventories.ada);
    expect(w.town(remove("l_1"))).toEqual([
      { type: "listing_removed", listing: "l_1", seller: "ada" },
    ]);
    // Nothing went past the cap, and nothing was lost: the lot waits for Ada alone.
    expect(inventorySize(w.state.items?.inventories.ada)).toBe(size);
    expect(listingsOf(w.state)).toEqual([]);
    expect(stallOf(w.state, "ada")).toEqual([]);
    expect(takenDownOf(w.state, "ada")).toEqual([
      expect.objectContaining({ id: "l_1", kind: "lemon", count: 5, takenDown: true }),
    ]);
    expect(takenDownOf(w.state, "bob")).toEqual([]);
    fund(w.state, "bob", 50);
    expect(w.code("bob", { type: "buy_listing", listing: "l_1" })).toBe("unknown_listing");
    expect(w.code(TOWN_ACTOR, remove("l_1"))).toBe("unknown_listing");
    expect(w.code("bob", { type: "unlist_item", listing: "l_1" })).toBe("not_eligible");
    expect(w.code("ada", { type: "unlist_item", listing: "l_1" })).toBe("inventory_full");
    // A held lot isn't a listing: it doesn't count toward the 20 Ada may have open.
    w.ok("ada", list("herb", 1, 5));
    w.ok("ada", { type: "unlist_item", listing: "l_2" });
    // Made room, Ada takes it back.
    w.ok("ada", { type: "give", item: "herb", to: "bob", count: 5 });
    w.ok("ada", { type: "unlist_item", listing: "l_1" });
    expect(w.has("ada", "lemon")).toBe(5);
    expect(w.state.market?.listings).toEqual({});
  });

  it("refuses an unknown listing, a sold one, and a closed market", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 1 });
    w.ok("ada", list("lemon", 3));
    fund(w.state, "bob", 10);
    w.ok("bob", { type: "buy_listing", listing: "l_1" });
    expect(w.code(TOWN_ACTOR, remove("l_1"))).toBe("unknown_listing");
    expect(w.code(TOWN_ACTOR, remove("l_9"))).toBe("unknown_listing");
    // Ids that name what every object inherits find nothing, and touch nothing.
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect(w.code(TOWN_ACTOR, remove(id))).toBe("unknown_listing");
      expect(w.code("bob", { type: "buy_listing", listing: id })).toBe("unknown_listing");
      expect(w.code("ada", { type: "unlist_item", listing: id })).toBe("unknown_listing");
    }
    expect(({} as { takenDown?: true }).takenDown).toBeUndefined();
    const closed = createWorld(CONFIG);
    expect(apply(closed, { actor: TOWN_ACTOR, command: remove("l_1") })).toMatchObject({
      ok: false,
      rejection: { code: "market_closed" },
    });
  });
});

describe("the market and replay", () => {
  it("changes nothing until commit, for every market input", () => {
    const w = market();
    stock(w.state, "ada", { lemon: 4 });
    fund(w.state, "bob", 50);
    const inputs: Input[] = [
      { actor: "ada", command: list("lemon", 10, 2) },
      { actor: "ada", command: list("lemon", 10, 2) },
      { actor: "ada", command: { type: "unlist_item", listing: "l_2" } },
      { actor: "bob", command: { type: "buy_listing", listing: "l_1" } },
      { actor: "ada", command: list("lemon", 10, 1) },
      { actor: TOWN_ACTOR, command: { type: "remove_listing", listing: "l_3" } },
    ];
    for (const input of inputs) {
      const before = hashWorld(w.state);
      const prepared = prepare(w.state, input);
      expect(prepared.ok).toBe(true);
      expect(hashWorld(w.state)).toBe(before);
      if (prepared.ok) prepared.commit();
      expectSupplyHolds(w.state);
    }
    expect(w.state.market?.nextId).toBe(4);
  });
});
