import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { ITEMS_CONFIG, ITEMS_HASH, ITEMS_LOG } from "./fixtures/items-log";
import {
  POST_ECONOMY_CONFIG,
  POST_ECONOMY_HASH,
  POST_ECONOMY_LOG,
} from "./fixtures/post-economy-log";
import { PRE_ECONOMY_CONFIG, PRE_ECONOMY_HASH, PRE_ECONOMY_LOG } from "./fixtures/pre-economy-log";
import { PRE_TOWN_CONFIG, PRE_TOWN_HASH, PRE_TOWN_LOG } from "./fixtures/pre-town-log";
import { SHOP_CONFIG, SHOP_HASH, SHOP_LOG } from "./fixtures/shop-log";
import { hashWorld } from "./hash";
import {
  CROPS,
  GOOD_KINDS,
  type GoodKind,
  ITEMS,
  inventorySize,
  isCrop,
  RECIPES,
  RESOURCE_KINDS,
  type StackKind,
} from "./items";
import { SHOP_WEAR } from "./looks";
import { replay } from "./replay";
import { SEASONS, seasonOf } from "./season";
import {
  BUY_ORDERS,
  ROTATION_CROPS,
  ROTATION_GOODS,
  SEASON_BUYS,
  type SellKind,
  SHOP,
  SHOP_CATALOG,
  SHOP_SKUS,
  type ShopSku,
  shopFor,
  shopOf,
  stockSeason,
  townBuys,
} from "./shop";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type Command,
  DECOR_BLOCKS,
  type Input,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { createWorld, isShopTile, shopTiles, townHallTiles } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1,1). Settling lands on the plot's center, where the
// starter home puts its hearth: (3, 3) on plot (0, 0), inside a hut from (1, 1) to (5, 5).
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
 * A world and its log. Every input checks the supply identity afterwards, every rejection checks
 * that nothing changed, and no inventory goes past the cap or keeps a stack at zero.
 */
function world() {
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
  const message = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? "" : result.rejection.message;
  };
  const town = (command: Command) => ok(TOWN_ACTOR, command);
  const settle = (name: string, n: number) => {
    const [px, py] = PLOTS[n] ?? [0, 0];
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  };
  const coins = (id: string) => state.economy?.coins[id] ?? 0;
  const has = (id: string, kind: StackKind) => state.items?.inventories[id]?.stacks[kind] ?? 0;
  return { state, log, send, ok, code, message, town, settle, coins, has };
}

/** Days counting, coins, items, and the shop open, with Ada and Bob settled. */
function shop(day = DAY) {
  const w = world();
  w.town({ type: "new_day", day });
  w.town({ type: "open_economy" });
  w.town({ type: "open_items" });
  w.town({ type: "open_shop" });
  w.settle("ada", 0);
  w.settle("bob", 1);
  return w;
}

/** The first day on or after `from` that the town buys `kind`. */
function dayBuying(kind: SellKind, from = DAY) {
  for (let d = from; d < from + 40; d++) if (townBuys(d).includes(kind)) return d;
  throw new Error(`the town never buys ${kind}`);
}

describe("old logs", () => {
  it("replay to the hashes they had before the shop", () => {
    expect(hashWorld(replay(PRE_TOWN_CONFIG, PRE_TOWN_LOG))).toBe(PRE_TOWN_HASH);
    expect(hashWorld(replay(PRE_ECONOMY_CONFIG, PRE_ECONOMY_LOG))).toBe(PRE_ECONOMY_HASH);
    expect(hashWorld(replay(POST_ECONOMY_CONFIG, POST_ECONOMY_LOG))).toBe(POST_ECONOMY_HASH);
    expect(hashWorld(replay(ITEMS_CONFIG, ITEMS_LOG))).toBe(ITEMS_HASH);
  });

  it("replay the shop log to its pinned hash", () => {
    const state = replay(SHOP_CONFIG, SHOP_LOG);
    expect(hashWorld(state)).toBe(SHOP_HASH);
    expectSupplyHolds(state);
  });

  it("have no shop until open_shop", () => {
    expect(replay(ITEMS_CONFIG, ITEMS_LOG).shop).toBeUndefined();
  });
});

describe("open_shop", () => {
  it("needs the server, days, coins, and items, and opens once", () => {
    const w = world();
    expect(w.code("ada", { type: "open_shop" })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "open_shop" })).toBe("not_due");
    w.town({ type: "new_day", day: DAY });
    w.town({ type: "open_economy" });
    expect(w.code(TOWN_ACTOR, { type: "open_shop" })).toBe("not_due");
    w.town({ type: "open_items" });
    expect(w.town({ type: "open_shop" })).toEqual([{ type: "shop_opened" }]);
    expect(w.code(TOWN_ACTOR, { type: "open_shop" })).toBe("already_open");
    expect(w.state.shop).toEqual({ wardrobe: {}, today: { sold: {} } });
  });

  it("refuses shopping before it opens", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    w.town({ type: "open_economy" });
    w.town({ type: "open_items" });
    w.settle("ada", 0);
    expect(w.code("ada", { type: "shop_buy", sku: "fence" })).toBe("shop_closed");
    expect(w.code("ada", { type: "sell_to_town", item: "herb" })).toBe("shop_closed");
  });
});

describe("the catalog", () => {
  it("prices every sku in whole coins, and sells no free wear", () => {
    for (const sku of SHOP_SKUS) {
      const { price } = SHOP_CATALOG[sku];
      expect(Number.isInteger(price) && price >= 1).toBe(true);
    }
    for (const wear of SHOP_WEAR) expect(SHOP_SKUS).toContain(wear);
    for (const block of DECOR_BLOCKS) expect(SHOP_SKUS).toContain(block);
    expect(Object.keys(SHOP_CATALOG).sort()).toEqual([...SHOP_SKUS].sort());
  });

  it("sends 5% of shop spending to the treasury, as decision 0052 records", () => {
    expect(SHOP.treasuryShare).toBe(5);
  });

  it("has the prices decision 0052 records", () => {
    // Seasonal stock has its own decision (0079), pinned in seasons.test.ts.
    const allYear = SHOP_SKUS.filter((s) => stockSeason(s) === undefined);
    const prices = Object.fromEntries(allYear.map((s) => [s, SHOP_CATALOG[s].price]));
    expect(prices).toEqual({
      lantern: 40,
      frame: 30,
      fence: 3,
      bench: 25,
      top_hat: 80,
      raincoat: 90,
      umbrella: 60,
      lemon_seed: 4,
      strawberry_seed: 4,
      tomato_seed: 4,
      herb_seed: 3,
      flower_seed: 3,
      sugar: 3,
      jar: 3,
    });
  });

  it("buys only its rotation and each season's buys, a few kinds a day", () => {
    // A kind joins what the town buys by a decision of its own, never by joining the catalog.
    const orders = Object.keys(BUY_ORDERS).sort();
    const seasonal = SEASONS.flatMap((s) => SEASON_BUYS[s]);
    expect(orders).toEqual([...ROTATION_GOODS, ...ROTATION_CROPS, ...seasonal].sort());
    const turn = SHOP.goodsPerDay + SHOP.producePerDay;
    for (let d = DAY; d < DAY + 400; d++) {
      const today = townBuys(d);
      // Today's turn of the rotation, then whatever the season adds (RFC 0017).
      expect(today).toHaveLength(turn + SEASON_BUYS[seasonOf(d)].length);
      expect(today.slice(turn)).toEqual(SEASON_BUYS[seasonOf(d)]);
      expect(new Set(today).size).toBe(today.length);
      expect(townBuys(d)).toEqual(today); // the same day always buys the same kinds
    }
    // Every kind in the rotation comes up at least once in any eight days in a row.
    for (const kind of [...ROTATION_GOODS, ...ROTATION_CROPS]) {
      expect(dayBuying(kind) - DAY).toBeLessThan(8);
    }
  });

  it("pays a resident at most this much in a day for the rotation, however much they make", () => {
    let most = 0;
    for (let d = DAY; d < DAY + 40; d++) {
      const day = townBuys(d)
        .slice(0, SHOP.goodsPerDay + SHOP.producePerDay)
        .reduce((sum, k) => sum + BUY_ORDERS[k].price * BUY_ORDERS[k].perDay, 0);
      most = Math.max(most, day);
    }
    // Three made things at one each and three of one crop: decision 0052. A season's buys come on
    // top (seasons.test.ts).
    expect(most).toBe(17);
  });

  it("never pays more for a made thing than its staples cost at the shop and its produce fetches", () => {
    // So buying sugar and jars to sell to the town never beats selling the produce as it is.
    for (const kind of GOOD_KINDS.filter((k): k is GoodKind & SellKind => k in BUY_ORDERS)) {
      let cost = 0;
      for (const [need, n] of Object.entries(RECIPES[kind].needs) as [StackKind, number][]) {
        cost +=
          n *
          (isCrop(need) ? BUY_ORDERS[need as SellKind].price : SHOP_CATALOG[need as ShopSku].price);
      }
      expect(BUY_ORDERS[kind].price, kind).toBeLessThanOrEqual(cost);
    }
  });

  it("never pays more for a made thing than the produce in it would fetch, plus a margin", () => {
    // A jar of jam beats selling its three lemons, so making is worth it, but the jam is capped.
    expect(BUY_ORDERS.lemon_jam.price).toBeGreaterThan(3 * BUY_ORDERS.lemon.price);
    // Buying the sugar and the jar to make jam for the town loses coins: the pantry's free staples
    // are what make selling pay.
    expect(BUY_ORDERS.lemon_jam.price).toBeLessThan(
      SHOP_CATALOG.sugar.price + SHOP_CATALOG.jar.price + 3 * BUY_ORDERS.lemon.price,
    );
  });
});

describe("shop_buy", () => {
  it("takes the price, sends half to the treasury, burns the rest, and hands it over", () => {
    const w = shop();
    fund(w.state, "ada", 100);
    const before = w.coins("ada");
    const treasury = w.state.economy?.treasury ?? 0;
    const events = w.ok("ada", { type: "shop_buy", sku: "lantern" });
    expect(w.coins("ada")).toBe(before - 40);
    expect(w.state.economy?.treasury).toBe(treasury + 20);
    expect(w.state.economy?.burned).toBe(20);
    expect(w.has("ada", "lantern")).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "coins", residentId: "ada", amount: -40, reason: "shop" }),
    );
    // The treasury's line doesn't say who bought.
    const line = events.find((e) => e.type === "treasury");
    expect(line).toEqual({ type: "treasury", amount: 20, balance: treasury + 20, reason: "shop" });
    expect(events).toContainEqual({
      type: "inventory",
      residentId: "ada",
      reason: "bought",
      changes: [{ kind: "lantern", amount: 1, count: 1 }],
    });
  });

  it("rounds the treasury's half down and burns the odd coin", () => {
    const w = shop();
    fund(w.state, "ada", 100);
    const treasury = w.state.economy?.treasury ?? 0;
    w.ok("ada", { type: "shop_buy", sku: "fence", count: 3 }); // 9 coins
    expect(w.state.economy?.treasury).toBe(treasury + 4);
    expect(w.state.economy?.burned).toBe(5);
    expect(w.has("ada", "fence")).toBe(3);
    w.ok("ada", { type: "shop_buy", sku: "sugar" }); // 3 coins: 1 to the treasury, 2 burned
    expect(w.state.economy?.treasury).toBe(treasury + 5);
    expect(w.state.economy?.burned).toBe(7);
  });

  it("switches to the share set_shop_share logs, leaving earlier purchases as they were", () => {
    const w = shop();
    fund(w.state, "ada", 200);
    const econ = () => w.state.economy;
    const treasury = econ()?.treasury ?? 0;
    w.ok("ada", { type: "shop_buy", sku: "lantern" }); // 40 at the opening share: 20 and 20
    expect(econ()?.treasury).toBe(treasury + 20);
    expect(econ()?.burned).toBe(20);
    expect(w.town({ type: "set_shop_share", percent: SHOP.treasuryShare })).toEqual([
      { type: "shop_share_set", percent: SHOP.treasuryShare },
    ]);
    w.ok("ada", { type: "shop_buy", sku: "lantern" }); // 40 at 5%: 2 to the treasury, 38 burned
    expect(econ()?.treasury).toBe(treasury + 22);
    expect(econ()?.burned).toBe(58);
    // Under 20 coins, 5% rounds down to nothing: all of it is burned, and no treasury line.
    const events = w.ok("ada", { type: "shop_buy", sku: "fence", count: 3 });
    expect(events.some((e) => e.type === "treasury")).toBe(false);
    expect(econ()?.burned).toBe(67);
  });

  it("takes set_shop_share only from the server, once the shop is open, as a new whole percent", () => {
    const w = world();
    w.town({ type: "new_day", day: DAY });
    expect(w.code(TOWN_ACTOR, { type: "set_shop_share", percent: 5 })).toBe("shop_closed");
    w.town({ type: "open_economy" });
    w.town({ type: "open_items" });
    w.town({ type: "open_shop" });
    expect(w.code("ada", { type: "set_shop_share", percent: 5 })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "set_shop_share", percent: 50 })).toBe("server_only");
    for (const percent of [-1, 101, 2.5]) {
      expect(w.code(TOWN_ACTOR, { type: "set_shop_share", percent })).toBe("server_only");
    }
    w.town({ type: "set_shop_share", percent: 0 });
    expect(w.state.shop?.treasuryShare).toBe(0);
  });

  it("refuses what it can't sell, odd counts, and empty purses", () => {
    const w = shop();
    fund(w.state, "ada", 30);
    expect(w.code("ada", { type: "shop_buy", sku: "lemon_jam" })).toBe("unknown_item");
    expect(w.code("ada", { type: "shop_buy", sku: "straw_hat" })).toBe("unknown_item");
    expect(w.code("ada", { type: "shop_buy", sku: "fence", count: 0 })).toBe("invalid_amount");
    expect(w.code("ada", { type: "shop_buy", sku: "fence", count: SHOP.countMax + 1 })).toBe(
      "invalid_amount",
    );
    expect(w.code("ada", { type: "shop_buy", sku: "fence", count: 1.5 })).toBe("invalid_amount");
    const have = w.coins("ada");
    expect(w.message("ada", { type: "shop_buy", sku: "lantern", count: 3 })).toBe(
      `That's 120 coins, and you have ${have} coins. Come home each day for your allowance.`,
    );
    expect(w.code("nobody", { type: "shop_buy", sku: "fence" })).toBe("not_joined");
    // With today's allowance not yet collected, the refusal says how to get it.
    w.town({ type: "new_day", day: DAY + 1 });
    expect(w.message("ada", { type: "shop_buy", sku: "lantern", count: 3 })).toContain(
      "Today's allowance is waiting: send home first.",
    );
  });

  it("refuses when your things are full", () => {
    const w = shop();
    fund(w.state, "ada", 1_000);
    const room = ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada);
    stock(w.state, "ada", { fence: room - 1 });
    expect(w.code("ada", { type: "shop_buy", sku: "fence", count: 2 })).toBe("inventory_full");
    w.ok("ada", { type: "shop_buy", sku: "fence" });
    // Wear doesn't take up room.
    w.ok("ada", { type: "shop_buy", sku: "top_hat" });
  });

  it("keeps townsfolk out", () => {
    const w = shop();
    w.ok("clem", { type: "join", name: "Clem", kind: "agent" });
    w.town({ type: "set_townsfolk", ids: ["clem"] });
    fund(w.state, "clem", 100);
    expect(w.code("clem", { type: "shop_buy", sku: "fence" })).toBe("not_eligible");
    expect(w.code("clem", { type: "sell_to_town", item: "herb" })).toBe("not_eligible");
  });
});

describe("shop wear", () => {
  it("is bought once, kept for good, and only then worn", () => {
    const w = shop();
    fund(w.state, "ada", 200);
    expect(w.code("ada", { type: "profile", wear: ["top_hat"] })).toBe("not_owned");
    expect(w.code("ada", { type: "shop_buy", sku: "top_hat", count: 2 })).toBe("invalid_amount");
    const events = w.ok("ada", { type: "shop_buy", sku: "top_hat" });
    expect(events).toContainEqual({ type: "wear_bought", residentId: "ada", wear: "top_hat" });
    expect(w.code("ada", { type: "shop_buy", sku: "top_hat" })).toBe("already_have");
    w.ok("ada", { type: "profile", wear: ["top_hat", "scarf"] });
    expect(w.state.residents.ada?.wear).toEqual(["top_hat", "scarf"]);
    w.ok("ada", { type: "shop_buy", sku: "umbrella" });
    expect(shopFor(w.state, "ada")?.wardrobe).toEqual(["top_hat", "umbrella"]);
    // Free wear stays free, for anyone.
    w.ok("bob", { type: "profile", wear: ["straw_hat"] });
    expect(w.code("bob", { type: "profile", wear: ["top_hat"] })).toBe("not_owned");
  });

  it("can't be put on by joining in it", () => {
    const w = shop();
    expect(w.code("cy", { type: "join", name: "Cy", kind: "human", wear: ["raincoat"] })).toBe(
      "not_owned",
    );
    w.ok("cy", { type: "join", name: "Cy", kind: "human", wear: ["apron"] });
  });
});

describe("decor", () => {
  it("is placed from your things and taken back up into them", () => {
    const w = shop();
    fund(w.state, "ada", 100);
    expect(w.message("ada", { type: "place", x: 2, y: 2, block: "lantern" })).toBe(
      "You have no paper lanterns. Buy one at the town shop with shop_buy.",
    );
    w.ok("ada", { type: "shop_buy", sku: "lantern" });
    const placed = w.ok("ada", { type: "place", x: 2, y: 2, block: "lantern" });
    expect(placed).toEqual([
      { type: "block_placed", x: 2, y: 2, block: "lantern", by: "ada" },
      {
        type: "inventory",
        residentId: "ada",
        reason: "placed",
        changes: [{ kind: "lantern", amount: -1, count: 0 }],
      },
    ]);
    expect(w.has("ada", "lantern")).toBe(0);
    expect(w.code("ada", { type: "place", x: 2, y: 3, block: "lantern" })).toBe("not_enough_items");
    const removed = w.ok("ada", { type: "remove", x: 2, y: 2 });
    expect(removed).toContainEqual({
      type: "inventory",
      residentId: "ada",
      reason: "picked_up",
      changes: [{ kind: "lantern", amount: 1, count: 1 }],
    });
    // Free blocks are still free, and touch nobody's things.
    expect(w.ok("ada", { type: "place", x: 2, y: 2, block: "wood" })).toHaveLength(1);
    expect(w.ok("ada", { type: "remove", x: 2, y: 2 })).toHaveLength(1);
  });

  it("can't be taken up with no room for it", () => {
    const w = shop();
    stock(w.state, "ada", { bench: 1 });
    w.ok("ada", { type: "place", x: 2, y: 2, block: "bench" });
    const room = ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada);
    stock(w.state, "ada", { fence: room });
    expect(w.code("ada", { type: "remove", x: 2, y: 2 })).toBe("inventory_full");
  });

  it("goes back to whoever takes it up on a shared plot", () => {
    const w = shop();
    stock(w.state, "ada", { frame: 1 });
    w.ok("ada", { type: "place", x: 2, y: 2, block: "frame" });
    w.ok("ada", { type: "share_plot", with: "bob" });
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("no bob");
    bob.x = 3;
    bob.y = 3;
    w.ok("bob", { type: "remove", x: 2, y: 2 });
    expect(w.has("bob", "frame")).toBe(1);
    expect(w.has("ada", "frame")).toBe(0);
  });

  it("isn't what a starter home is built from", () => {
    const w = shop();
    w.ok("cy", { type: "join", name: "Cy", kind: "human" });
    w.ok("cy", { type: "settle", px: 0, py: 2 });
    expect(w.code("cy", { type: "build_starter_home", walls: "fence" })).toBe("unknown_item");
    expect(w.code("cy", { type: "build_starter_home", windows: "lantern" })).toBe("unknown_item");
    w.ok("cy", { type: "build_starter_home" });
  });

  it("needs items open, like everything you hold", () => {
    const w = world();
    w.ok("ada", { type: "join", name: "Ada", kind: "human" });
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    expect(w.code("ada", { type: "place", x: 2, y: 2, block: "lantern" })).toBe("items_closed");
  });
});

describe("sell_to_town", () => {
  it("buys only today's kinds, mints the price, and takes the things", () => {
    const day = dayBuying("herb");
    const w = shop(day);
    stock(w.state, "ada", { herb: 7, lemon: 2 });
    const minted = w.state.economy?.minted ?? 0;
    const before = w.coins("ada");
    const events = w.ok("ada", { type: "sell_to_town", item: "herb", count: 2 });
    expect(w.coins("ada")).toBe(before + 2 * BUY_ORDERS.herb.price);
    expect(w.state.economy?.minted).toBe(minted + 2 * BUY_ORDERS.herb.price);
    expect(w.has("ada", "herb")).toBe(5);
    expect(events).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "sold",
        changes: [{ kind: "herb", amount: -2, count: 5 }],
      },
      {
        type: "coins",
        residentId: "ada",
        amount: 2 * BUY_ORDERS.herb.price,
        balance: before + 2 * BUY_ORDERS.herb.price,
        reason: "sold",
      },
    ]);
    const notToday = CROPS.find((c) => !(townBuys(day) as string[]).includes(c)) ?? "lemon";
    stock(w.state, "ada", { [notToday]: 1 });
    expect(w.code("ada", { type: "sell_to_town", item: notToday })).toBe("not_buying");
    expect(w.code("ada", { type: "sell_to_town", item: "fence" })).toBe("not_buying");
    expect(w.code("ada", { type: "sell_to_town", item: "nonsense" })).toBe("unknown_item");
  });

  it("never buys gathered wood or stone, so gathering mints no coins (decision 0063)", () => {
    for (const kind of RESOURCE_KINDS) expect(Object.keys(BUY_ORDERS)).not.toContain(kind);
    for (let d = DAY; d < DAY + 60; d++) {
      for (const kind of RESOURCE_KINDS) expect(townBuys(d)).not.toContain(kind);
    }
    const w = shop();
    stock(w.state, "ada", { wood: 3, stone: 3 });
    const before = w.coins("ada");
    expect(w.code("ada", { type: "sell_to_town", item: "wood" })).toBe("not_buying");
    expect(w.code("ada", { type: "sell_to_town", item: "stone", count: 2 })).toBe("not_buying");
    expect(w.coins("ada")).toBe(before);
  });

  it("buys up to each kind's daily count, then again after new_day", () => {
    const day = dayBuying("herb");
    const w = shop(day);
    const { perDay } = BUY_ORDERS.herb;
    stock(w.state, "ada", { herb: perDay * 3 });
    w.ok("ada", { type: "sell_to_town", item: "herb", count: perDay - 1 });
    expect(w.message("ada", { type: "sell_to_town", item: "herb", count: 2 })).toBe(
      `The town buys ${perDay} bunches of herbs from each resident a day. You can sell 1 more today.`,
    );
    w.ok("ada", { type: "sell_to_town", item: "herb" });
    expect(w.code("ada", { type: "sell_to_town", item: "herb" })).toBe("sell_limit");
    expect(shopFor(w.state, "ada")?.sold).toEqual({ herb: perDay });
    // Bob's count is his own.
    stock(w.state, "bob", { herb: 1 });
    w.ok("bob", { type: "sell_to_town", item: "herb" });
    // A day the town buys herbs again, the count starts over.
    const next = dayBuying("herb", day + 1);
    w.town({ type: "new_day", day: next });
    expect(shopFor(w.state, "ada")?.sold).toEqual({});
    w.ok("ada", { type: "sell_to_town", item: "herb", count: perDay });
  });

  it("takes made things oldest first, or the one you name", () => {
    const day = dayBuying("herb_tea");
    const w = shop(day);
    // Ada makes three teas at a kitchen in her hut.
    w.ok("ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    stock(w.state, "ada", { herb: 6, jar: 3 });
    for (let i = 0; i < 3; i++) {
      w.ok("ada", { type: "craft", recipe: "herb_tea", x: 4, y: 2 });
    }
    const ids = (w.state.items?.inventories.ada?.goods ?? []).map((g) => g.id);
    const [first, second, third] = ids;
    expect(w.ok("ada", { type: "sell_to_town", item: third ?? "" })).toContainEqual({
      type: "inventory",
      residentId: "ada",
      reason: "sold",
      lost: [third],
    });
    // One tea a day: the next day the town buys tea, sell by kind.
    expect(w.code("ada", { type: "sell_to_town", item: "herb_tea" })).toBe("sell_limit");
    w.town({ type: "new_day", day: dayBuying("herb_tea", day + 1) });
    expect(w.ok("ada", { type: "sell_to_town", item: "herb_tea" })).toContainEqual({
      type: "inventory",
      residentId: "ada",
      reason: "sold",
      lost: [first],
    });
    expect(w.state.items?.inventories.ada?.goods.map((g) => g.id)).toEqual([second]);
    expect(w.code("ada", { type: "sell_to_town", item: "i_999" })).toBe("not_enough_items");
    expect(w.code("ada", { type: "sell_to_town", item: second ?? "", count: 2 })).toBe(
      "invalid_amount",
    );
  });

  it("refuses more than you have", () => {
    const day = dayBuying("herb");
    const w = shop(day);
    stock(w.state, "ada", { herb: 1 });
    expect(w.code("ada", { type: "sell_to_town", item: "herb", count: 2 })).toBe(
      "not_enough_items",
    );
  });
});

describe("the pantry once the shop is open", () => {
  it("gives one sugar and one jar a day, up to six of each", () => {
    const w = shop();
    // Ada's first pantry came with settling: the starter seeds and one of each staple.
    expect(w.has("ada", "sugar")).toBe(ITEMS.shopPantry.sugar);
    expect(w.has("ada", "jar")).toBe(ITEMS.shopPantry.jar);
    for (let d = 1; d <= 8; d++) {
      w.town({ type: "new_day", day: DAY + d });
      w.ok("ada", { type: "move", dir: "s" });
      w.ok("ada", { type: "move", dir: "n" });
    }
    expect(w.has("ada", "sugar")).toBe(ITEMS.shopStapleMax);
    expect(w.has("ada", "jar")).toBe(ITEMS.shopStapleMax);
    expect(ITEMS.shopPantry).toEqual({ sugar: 1, jar: 1 });
    expect(ITEMS.shopStapleMax).toBe(6);
  });
});

describe("the shop's tiles", () => {
  it("stand on the Commons' south edge, clear of the Town Hall", () => {
    const tiles = shopTiles(CONFIG);
    expect(tiles).toHaveLength(6);
    for (const t of tiles) {
      expect(Math.floor(t.x / 8)).toBe(1);
      expect(Math.floor(t.y / 8)).toBe(1);
      expect(isShopTile(CONFIG, t.x, t.y)).toBe(true);
    }
    expect(Math.max(...tiles.map((t) => t.y))).toBe(15);
    const hall = new Set(townHallTiles(CONFIG).map((t) => `${t.x},${t.y}`));
    for (const t of tiles) expect(hall.has(`${t.x},${t.y}`)).toBe(false);
  });

  it("show in what everyone reads once it's open", () => {
    const w = shop(dayBuying("lemon"));
    const read = shopOf(w.state);
    expect(read?.buying.map((b) => b.kind)).toEqual(townBuys(w.state.day ?? 0));
    expect(read?.buying.find((b) => b.kind === "lemon")).toEqual({
      kind: "lemon",
      ...BUY_ORDERS.lemon,
    });
    expect(shopOf(world().state)).toBeNull();
  });
});

describe("a busy month", () => {
  it("keeps the supply identity through buying, selling, and placing", () => {
    const w = shop();
    const skus: ShopSku[] = ["fence", "lantern", "jar", "herb_seed", "bench"];
    for (let d = 0; d < 30; d++) {
      w.town({ type: "new_day", day: DAY + d + 1 });
      for (const id of ["ada", "bob"]) {
        w.ok(id, { type: "move", dir: "s" });
        w.ok(id, { type: "move", dir: "n" });
        stock(w.state, id, { herb: 2, flower: 2, lemon: 2 });
        for (const kind of townBuys(DAY + d + 1)) {
          w.send(id, { type: "sell_to_town", item: kind, count: 2 });
        }
        w.send(id, { type: "shop_buy", sku: skus[d % skus.length] as ShopSku });
      }
    }
    // The helper checked the identity after every input; it holds at the end too.
    expectSupplyHolds(w.state);
    expect(w.state.economy?.burned).toBeGreaterThan(0);
  });
});
