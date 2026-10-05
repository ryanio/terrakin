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
import { hashWorld } from "./hash";
import {
  CROP_INFO,
  GOOD_KINDS,
  ITEMS,
  inventoryOf,
  inventorySize,
  RECIPES,
  SEED_KINDS,
  type StackKind,
} from "./items";
import { replay } from "./replay";
import { stock } from "./test-support";
import { type Command, type Input, TOWN_ACTOR, type WorldConfig, type WorldEvent } from "./types";
import { createWorld } from "./world";

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
  [2, 2],
] as const;
const DAY = 20_000;

/**
 * A world and its log. Every rejection checks that nothing changed, and every input checks that
 * no inventory holds more than the cap or a stack at zero.
 */
function world(config = CONFIG) {
  const state = createWorld(config);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    else expect(hashWorld(state)).toBe(before);
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
  const day = (d: number) => ok(TOWN_ACTOR, { type: "new_day", day: d });
  const open = () => ok(TOWN_ACTOR, { type: "open_items" });
  const join = (name: string) => ok(name, { type: "join", name, kind: "human" });
  /** Join, settle the nth plot, and build a starter home, which sets a hearth where they stand. */
  const settle = (name: string, n: number) => {
    const [px, py] = PLOTS[n] ?? [0, 0];
    join(name);
    ok(name, { type: "settle", px, py });
    return ok(name, { type: "build_starter_home" });
  };
  /** Step off the hearth (south, inside the hut) and back onto it. */
  const homeAgain = (name: string) => {
    ok(name, { type: "move", dir: "s" });
    return ok(name, { type: "move", dir: "n" });
  };
  const has = (id: string, kind: StackKind) => state.items?.inventories[id]?.stacks[kind] ?? 0;
  const goods = (id: string) => state.items?.inventories[id]?.goods ?? [];
  return { state, log, send, ok, code, message, day, open, join, settle, homeAgain, has, goods };
}

/** A world counting days, items open, and Ada settled on plot (0, 0) with her starter kit. */
function garden() {
  const w = world();
  w.day(DAY);
  w.open();
  w.settle("ada", 0);
  // Inside the hut: a planter at (2, 2), a kitchen at (4, 2), a workbench at (4, 3).
  w.ok("ada", { type: "place", x: 2, y: 2, block: "planter" });
  w.ok("ada", { type: "place", x: 4, y: 2, block: "kitchen" });
  w.ok("ada", { type: "place", x: 4, y: 3, block: "workbench" });
  return w;
}

const inventoryEvents = (events: WorldEvent[]) => events.filter((e) => e.type === "inventory");

describe("old logs", () => {
  it("replay to the hashes they had before items", () => {
    expect(hashWorld(replay(PRE_TOWN_CONFIG, PRE_TOWN_LOG))).toBe(PRE_TOWN_HASH);
    expect(hashWorld(replay(PRE_ECONOMY_CONFIG, PRE_ECONOMY_LOG))).toBe(PRE_ECONOMY_HASH);
    expect(hashWorld(replay(POST_ECONOMY_CONFIG, POST_ECONOMY_LOG))).toBe(POST_ECONOMY_HASH);
  });

  it("leave no item fields behind, though residents come home", () => {
    const state = replay(POST_ECONOMY_CONFIG, POST_ECONOMY_LOG);
    expect(state.items).toBeUndefined();
  });

  it("a log with items replays to its pinned hash", () => {
    const state = replay(ITEMS_CONFIG, ITEMS_LOG);
    expect(hashWorld(state)).toBe(ITEMS_HASH);
    // It grew, harvested, made, and gave something.
    const items = state.items;
    expect(items).toBeDefined();
    expect(items?.nextId).toBeGreaterThan(1);
    expect(Object.values(items?.inventories ?? {}).some((i) => i.goods.length > 0)).toBe(true);
  });
});

describe("open_items", () => {
  it("only the server opens items, once the world counts days, and only once", () => {
    const w = world();
    w.join("ada");
    expect(w.code("ada", { type: "open_items" })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "open_items" })).toBe("not_due");
    w.day(DAY);
    expect(w.open()).toEqual([{ type: "items_opened" }]);
    expect(w.state.items).toEqual({
      nextId: 1,
      inventories: {},
      crops: {},
      pantry: {},
      today: { given: {}, received: {}, crafted: {} },
    });
    expect(w.code(TOWN_ACTOR, { type: "open_items" })).toBe("already_open");
  });

  it("every item action waits for it", () => {
    const w = world();
    w.day(DAY);
    w.settle("ada", 0);
    w.join("bob");
    expect(w.code("ada", { type: "plant", x: 2, y: 2, seed: "lemon" })).toBe("items_closed");
    expect(w.code("ada", { type: "harvest", x: 2, y: 2 })).toBe("items_closed");
    expect(w.code("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3 })).toBe("items_closed");
    expect(w.code("ada", { type: "give", item: "lemon", to: "bob" })).toBe("items_closed");
    // And nothing about items appears from coming home.
    w.homeAgain("ada");
    expect(w.state.items).toBeUndefined();
  });
});

describe("the pantry", () => {
  it("gives starter seeds and staples the first time you're on your hearth", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    expect(w.state.items?.inventories.ada).toBeUndefined();
    const events = w.ok("ada", { type: "build_starter_home" });
    const [kit] = inventoryEvents(events);
    expect(kit).toMatchObject({ type: "inventory", residentId: "ada", reason: "starter" });
    for (const seed of SEED_KINDS) expect(w.has("ada", seed)).toBe(ITEMS.starterSeeds);
    expect(w.has("ada", "sugar")).toBe(ITEMS.pantry.sugar);
    expect(w.has("ada", "jar")).toBe(ITEMS.pantry.jar);
    expect(w.state.items?.pantry.ada).toBe(DAY);
    // Once a day.
    expect(inventoryEvents(w.homeAgain("ada"))).toEqual([]);
  });

  it("tops up staples each day, never past the staple cap, and never twice a day", () => {
    const w = garden();
    const days = (ITEMS.stapleMax - ITEMS.pantry.sugar) / ITEMS.pantry.sugar;
    for (let d = 1; d <= days; d++) {
      w.day(DAY + d);
      const [pantry] = inventoryEvents(w.homeAgain("ada"));
      expect(pantry).toMatchObject({ reason: "pantry" });
      expect(inventoryEvents(w.homeAgain("ada"))).toEqual([]);
    }
    expect(w.has("ada", "sugar")).toBe(ITEMS.stapleMax);
    expect(w.has("ada", "jar")).toBe(ITEMS.stapleMax);
    // Seeds came only once.
    expect(w.has("ada", "lemon_seed")).toBe(ITEMS.starterSeeds);
    // At the cap there's nothing to add, so nothing is recorded and `home` has nothing to collect.
    w.day(DAY + days + 1);
    expect(inventoryEvents(w.homeAgain("ada"))).toEqual([]);
    expect(w.state.items?.pantry.ada).toBe(DAY + days);
    expect(w.code("ada", { type: "home" })).toBe("already_home");
  });

  it("never fills an inventory past the cap", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    // Three short of full: the first seeds fit, the rest of the kit waits for room.
    stock(w.state, "ada", { tomato: ITEMS.inventoryMax - 3 });
    const [kit] = inventoryEvents(w.ok("ada", { type: "build_starter_home" }));
    expect(kit).toMatchObject({
      reason: "starter",
      changes: [
        { kind: "lemon_seed", amount: 2 },
        { kind: "strawberry_seed", amount: 1 },
      ],
    });
    expect(inventorySize(w.state.items?.inventories.ada)).toBe(ITEMS.inventoryMax);
  });

  it("isn't for townsfolk, like the allowance", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem"] });
    w.settle("clem", 0);
    expect(w.state.items?.inventories.clem).toBeUndefined();
    expect(w.code("clem", { type: "home" })).toBe("already_home");
  });

  it("lets `home` on your hearth collect it, and refuses `home` once it's had", () => {
    const w = garden();
    w.day(DAY + 1);
    // Coins aren't open, so only the pantry is due.
    const events = w.ok("ada", { type: "home" });
    expect(inventoryEvents(events)).toHaveLength(1);
    expect(w.code("ada", { type: "home" })).toBe("already_home");
  });

  it("needs a hearth", () => {
    const w = world();
    w.day(DAY);
    w.open();
    w.join("ada");
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    w.ok("ada", { type: "move", dir: "n" });
    w.ok("ada", { type: "move", dir: "s" });
    expect(w.state.items?.inventories.ada).toBeUndefined();
    expect(w.state.items?.pantry.ada).toBeUndefined();
  });
});

describe("plant", () => {
  it("puts a seed in your planter and tells everyone when it will be ready", () => {
    const w = garden();
    const events = w.ok("ada", { type: "plant", x: 2, y: 2, seed: "lemon" });
    const readyDay = DAY + CROP_INFO.lemon.days;
    expect(events[0]).toEqual({
      type: "planted",
      x: 2,
      y: 2,
      crop: "lemon",
      by: "ada",
      plantedDay: DAY,
      readyDay,
    });
    expect(inventoryEvents(events)).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "plant",
        changes: [{ kind: "lemon_seed", amount: -1, count: ITEMS.starterSeeds - 1 }],
      },
    ]);
    expect(w.state.items?.crops["2,2"]).toEqual({
      crop: "lemon",
      by: "ada",
      plantedDay: DAY,
      readyDay,
    });
  });

  it("refuses what isn't a seed, out of reach, off your plot, without a planter, or full", () => {
    const w = garden();
    w.settle("bob", 1);
    expect(w.code("ada", { type: "plant", x: 2, y: 2, seed: "cactus" as "lemon" })).toBe(
      "unknown_item",
    );
    expect(w.code("ada", { type: "plant", x: 99, y: 2, seed: "lemon" })).toBe("out_of_bounds");
    expect(w.code("ada", { type: "plant", x: 7, y: 7, seed: "lemon" })).toBe("out_of_reach");
    // Bob's planter, on Bob's plot.
    w.ok("bob", { type: "place", x: 18, y: 2, block: "planter" });
    expect(w.code("ada", { type: "plant", x: 18, y: 2, seed: "lemon" })).toBe("out_of_reach");
    w.join("cy");
    expect(w.code("cy", { type: "plant", x: 18, y: 2, seed: "lemon" })).toBe("out_of_reach");
    expect(w.code("bob", { type: "plant", x: 4, y: 2, seed: "lemon" })).toBe("out_of_reach");
    // A kitchen isn't a planter, and neither is bare ground.
    expect(w.code("ada", { type: "plant", x: 4, y: 2, seed: "lemon" })).toBe("no_planter");
    expect(w.code("ada", { type: "plant", x: 3, y: 4, seed: "lemon" })).toBe("no_planter");
    w.ok("ada", { type: "plant", x: 2, y: 2, seed: "lemon" });
    expect(w.code("ada", { type: "plant", x: 2, y: 2, seed: "tomato" })).toBe("tile_occupied");
  });

  it("refuses on a plot you can't build on, and allows one shared with you", () => {
    const w = garden();
    w.join("cy");
    // Cy walks to Ada's door: (12, 12) is spawn; the doorway of Ada's hut is (3, 5).
    Object.assign(w.state.residents.cy ?? {}, { x: 3, y: 6 });
    stock(w.state, "cy", { lemon_seed: 1 });
    expect(w.code("cy", { type: "plant", x: 2, y: 4, seed: "lemon" })).toBe("not_your_plot");
    w.ok("ada", { type: "share_plot", with: "cy" });
    w.ok("ada", { type: "place", x: 2, y: 4, block: "planter" });
    w.ok("cy", { type: "plant", x: 2, y: 4, seed: "lemon" });
    expect(w.state.items?.crops["2,4"]?.by).toBe("cy");
  });

  it("needs a seed of that kind", () => {
    const w = garden();
    w.ok("ada", { type: "place", x: 2, y: 3, block: "planter" });
    w.ok("ada", { type: "plant", x: 2, y: 2, seed: "herb" });
    w.ok("ada", { type: "plant", x: 2, y: 3, seed: "herb" });
    w.ok("ada", { type: "place", x: 2, y: 4, block: "planter" });
    expect(w.code("ada", { type: "plant", x: 2, y: 4, seed: "herb" })).toBe("not_enough_items");
  });

  it("keeps the planter while something grows in it", () => {
    const w = garden();
    w.ok("ada", { type: "plant", x: 2, y: 2, seed: "herb" });
    expect(w.code("ada", { type: "remove", x: 2, y: 2 })).toBe("tile_occupied");
    w.day(DAY + CROP_INFO.herb.days);
    w.ok("ada", { type: "harvest", x: 2, y: 2 });
    w.ok("ada", { type: "remove", x: 2, y: 2 });
  });
});

describe("growing and harvest", () => {
  it("grows only as days start, and skipped days count", () => {
    const w = garden();
    w.ok("ada", { type: "plant", x: 2, y: 2, seed: "lemon" });
    expect(w.code("ada", { type: "harvest", x: 2, y: 2 })).toBe("not_ready");
    expect(w.message("ada", { type: "harvest", x: 2, y: 2 })).toContain("in 4 days");
    w.day(DAY + 1);
    expect(w.message("ada", { type: "harvest", x: 2, y: 2 })).toContain("in 3 days");
    // The server skips days it missed; growth counts them all the same.
    w.day(DAY + CROP_INFO.lemon.days + 5);
    const events = w.ok("ada", { type: "harvest", x: 2, y: 2 });
    expect(events[0]).toEqual({ type: "harvested", x: 2, y: 2, crop: "lemon", by: "ada" });
    // Ada is on her hearth, so the day's pantry comes with it.
    const harvest = inventoryEvents(events).filter((e) => e.reason === "harvest");
    expect(harvest).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "harvest",
        changes: [
          { kind: "lemon", amount: CROP_INFO.lemon.yield, count: CROP_INFO.lemon.yield },
          { kind: "lemon_seed", amount: 1, count: ITEMS.starterSeeds },
        ],
      },
    ]);
    expect(w.state.items?.crops["2,2"]).toBeUndefined();
  });

  it("is ready exactly on its ready day", () => {
    for (const crop of ["lemon", "strawberry", "tomato", "herb", "flower"] as const) {
      const w = garden();
      w.ok("ada", { type: "plant", x: 2, y: 2, seed: crop });
      w.day(DAY + CROP_INFO[crop].days - 1);
      expect(w.code("ada", { type: "harvest", x: 2, y: 2 })).toBe("not_ready");
      w.day(DAY + CROP_INFO[crop].days);
      w.ok("ada", { type: "harvest", x: 2, y: 2 });
      expect(w.has("ada", crop)).toBe(CROP_INFO[crop].yield);
    }
  });

  it("goes to whoever picks it, if they can build on the plot", () => {
    const w = garden();
    w.ok("ada", { type: "plant", x: 2, y: 2, seed: "flower" });
    w.join("cy");
    Object.assign(w.state.residents.cy ?? {}, { x: 3, y: 4 });
    w.ok("ada", { type: "share_plot", with: "cy" });
    w.day(DAY + CROP_INFO.flower.days);
    const events = w.ok("cy", { type: "harvest", x: 2, y: 2 });
    expect(events[0]).toEqual({ type: "harvested", x: 2, y: 2, crop: "flower", by: "cy" });
    expect(w.has("cy", "flower")).toBe(CROP_INFO.flower.yield);
    expect(w.has("ada", "flower")).toBe(0);
  });

  it("refuses an empty planter, out of reach, off your plot, and when you're full", () => {
    const w = garden();
    expect(w.code("ada", { type: "harvest", x: 2, y: 2 })).toBe("no_crop");
    expect(w.code("ada", { type: "harvest", x: 9, y: 9 })).toBe("out_of_reach");
    w.ok("ada", { type: "plant", x: 2, y: 2, seed: "flower" });
    w.day(DAY + CROP_INFO.flower.days);
    w.join("cy");
    Object.assign(w.state.residents.cy ?? {}, { x: 3, y: 4 });
    expect(w.code("cy", { type: "harvest", x: 2, y: 2 })).toBe("not_your_plot");
    const room = ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada);
    stock(w.state, "ada", { tomato: room - CROP_INFO.flower.yield });
    expect(w.code("ada", { type: "harvest", x: 2, y: 2 })).toBe("inventory_full");
  });
});

describe("craft", () => {
  /** Ada with a bouquet's worth of flowers and a jam's worth of lemons. */
  function stocked() {
    const w = garden();
    stock(w.state, "ada", { flower: 3, lemon: 3 });
    return w;
  }

  it("makes a signed thing at the right station and uses up what it needs", () => {
    const w = stocked();
    const events = w.ok("ada", {
      type: "craft",
      recipe: "lemon_jam",
      x: 4,
      y: 2,
      label: "Sunny jar",
    });
    const good = { id: "i_1", kind: "lemon_jam", maker: "ada", madeDay: DAY, label: "Sunny jar" };
    expect(events).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "craft",
        changes: [
          { kind: "lemon", amount: -3, count: 0 },
          { kind: "sugar", amount: -1, count: ITEMS.pantry.sugar - 1 },
          { kind: "jar", amount: -1, count: ITEMS.pantry.jar - 1 },
        ],
        gained: [good],
      },
    ]);
    expect(w.goods("ada")).toEqual([good]);
    expect(w.has("ada", "lemon")).toBe(0);
    expect(w.state.items?.nextId).toBe(2);
    // No label, no label field.
    w.ok("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3 });
    expect(w.goods("ada")[1]).toEqual({ id: "i_2", kind: "bouquet", maker: "ada", madeDay: DAY });
    expect(w.state.items?.today.crafted.ada).toBe(2);
  });

  it("refuses an unknown recipe, a long label, the wrong station, and missing things", () => {
    const w = stocked();
    expect(w.code("ada", { type: "craft", recipe: "pie" as "bouquet", x: 4, y: 3 })).toBe(
      "unknown_item",
    );
    expect(
      w.code("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3, label: "x".repeat(41) }),
    ).toBe("invalid_label");
    expect(w.code("ada", { type: "craft", recipe: "bouquet", x: 4, y: 2 })).toBe("no_station");
    expect(w.code("ada", { type: "craft", recipe: "bouquet", x: 3, y: 4 })).toBe("no_station");
    expect(w.code("ada", { type: "craft", recipe: "bouquet", x: 12, y: 12 })).toBe("out_of_reach");
    expect(w.message("ada", { type: "craft", recipe: "flower_wreath", x: 4, y: 3 })).toBe(
      "You need 1 flower, 2 bunches of herbs more.",
    );
    expect(w.code("ada", { type: "craft", recipe: "flower_wreath", x: 4, y: 3 })).toBe(
      "not_enough_items",
    );
  });

  it("works at anyone's station within reach", () => {
    const w = stocked();
    w.join("cy");
    Object.assign(w.state.residents.cy ?? {}, { x: 3, y: 4 });
    stock(w.state, "cy", { flower: 3 });
    w.ok("cy", { type: "craft", recipe: "bouquet", x: 4, y: 3 });
    expect(w.goods("cy")[0]?.maker).toBe("cy");
  });

  it("stops at the daily limit and starts over the next day", () => {
    const w = stocked();
    stock(w.state, "ada", { flower: 3 * (ITEMS.craftPerDay + 1) });
    for (let i = 0; i < ITEMS.craftPerDay; i++) {
      w.ok("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3 });
    }
    expect(w.code("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3 })).toBe("craft_limit");
    w.day(DAY + 1);
    w.ok("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3 });
  });

  it("has a recipe for every made thing, and every recipe uses something", () => {
    for (const kind of GOOD_KINDS) {
      expect(Object.values(RECIPES[kind].needs).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("give", () => {
  /** Ada (plot 0) and Bob (plot 1), both with starter kits, and Ada with a jam and a bouquet. */
  function friends() {
    const w = garden();
    w.settle("bob", 1);
    stock(w.state, "ada", { flower: 3, lemon: 3 });
    w.ok("ada", { type: "craft", recipe: "lemon_jam", x: 4, y: 2 });
    w.ok("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3 });
    return w;
  }

  it("moves a stack, with a private event each side and a public one", () => {
    const w = friends();
    const events = w.ok("ada", {
      type: "give",
      item: "tomato_seed",
      to: "bob",
      count: 2,
      note: "plant these",
    });
    expect(events).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "gift_out",
        changes: [{ kind: "tomato_seed", amount: -2, count: 0 }],
        with: "bob",
        note: "plant these",
      },
      {
        type: "inventory",
        residentId: "bob",
        reason: "gift_in",
        changes: [{ kind: "tomato_seed", amount: 2, count: ITEMS.starterSeeds + 2 }],
        with: "ada",
        note: "plant these",
      },
      { type: "item_given", from: "ada", to: "bob", kind: "tomato_seed" },
    ]);
  });

  it("moves a made thing by id, keeping its maker", () => {
    const w = friends();
    const [jam] = w.goods("ada");
    const events = w.ok("ada", { type: "give", item: "i_1", to: "bob" });
    expect(inventoryEvents(events)).toEqual([
      { type: "inventory", residentId: "ada", reason: "gift_out", lost: ["i_1"], with: "bob" },
      {
        type: "inventory",
        residentId: "bob",
        reason: "gift_in",
        gained: [jam],
        with: "ada",
      },
    ]);
    expect(w.goods("bob")).toEqual([{ id: "i_1", kind: "lemon_jam", maker: "ada", madeDay: DAY }]);
    expect(w.goods("ada").map((g) => g.id)).toEqual(["i_2"]);
    // Bob can pass it on; Ada stays its maker.
    w.join("cy");
    w.ok("bob", { type: "give", item: "i_1", to: "cy" });
    expect(w.goods("cy")[0]?.maker).toBe("ada");
  });

  it("moves your oldest made things of a kind", () => {
    const w = friends();
    stock(w.state, "ada", { flower: 3 });
    w.ok("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3 });
    w.ok("ada", { type: "give", item: "bouquet", to: "bob" });
    expect(w.goods("bob").map((g) => g.id)).toEqual(["i_2"]);
    expect(w.code("ada", { type: "give", item: "bouquet", to: "bob", count: 2 })).toBe(
      "not_enough_items",
    );
  });

  it("refuses bad gifts", () => {
    const w = friends();
    expect(w.code("ada", { type: "give", item: "lemon_seed", to: "nobody" })).toBe(
      "unknown_resident",
    );
    expect(w.code("ada", { type: "give", item: "lemon_seed", to: "ada" })).toBe("invalid_gift");
    expect(
      w.code("ada", { type: "give", item: "lemon_seed", to: "bob", note: "x".repeat(141) }),
    ).toBe("invalid_gift");
    expect(w.code("ada", { type: "give", item: "lemon_seed", to: "bob", count: 0 })).toBe(
      "invalid_amount",
    );
    expect(w.code("ada", { type: "give", item: "lemon_seed", to: "bob", count: 1.5 })).toBe(
      "invalid_amount",
    );
    expect(w.code("ada", { type: "give", item: "lemon_seed", to: "bob", count: 21 })).toBe(
      "invalid_amount",
    );
    expect(w.code("ada", { type: "give", item: "i_1", to: "bob", count: 2 })).toBe(
      "invalid_amount",
    );
    expect(w.code("ada", { type: "give", item: "i_99", to: "bob" })).toBe("not_enough_items");
    expect(w.code("ada", { type: "give", item: "lemon_seed", to: "bob", count: 3 })).toBe(
      "not_enough_items",
    );
    expect(w.code("ada", { type: "give", item: "lemon", to: "bob" })).toBe("not_enough_items");
    expect(w.code("ada", { type: "give", item: "rocks", to: "bob" })).toBe("unknown_item");
  });

  it("caps what you give and what they receive in a day, and resets at new_day", () => {
    const w = friends();
    stock(w.state, "ada", { lemon: 100 });
    w.ok("ada", { type: "give", item: "lemon", to: "bob", count: 15 });
    expect(w.code("ada", { type: "give", item: "lemon", to: "bob", count: 6 })).toBe("gift_limit");
    w.ok("ada", { type: "give", item: "lemon", to: "bob", count: 5 });
    expect(w.code("ada", { type: "give", item: "lemon", to: "bob" })).toBe("gift_limit");
    // Bob's receive cap: refused only once he's had that many today.
    const items = w.state.items;
    if (!items) throw new Error("items");
    items.today.received.bob = ITEMS.receiveCap;
    w.join("cy");
    stock(w.state, "cy", { lemon: 5 });
    expect(w.code("cy", { type: "give", item: "lemon", to: "bob" })).toBe("gift_limit");
    w.day(DAY + 1);
    w.ok("cy", { type: "give", item: "lemon", to: "bob" });
    w.ok("ada", { type: "give", item: "lemon", to: "bob", count: 20 });
  });

  it("skips the caps between an owner pair from the day after they link", () => {
    const w = friends();
    stock(w.state, "ada", { lemon: 100 });
    w.ok(TOWN_ACTOR, { type: "add_owner_pair", pair: ["ada", "bob"] });
    // Linked before the economy opened counts from day 0, so the caps are already off.
    w.ok("ada", { type: "give", item: "lemon", to: "bob", count: 20 });
    w.ok("ada", { type: "give", item: "lemon", to: "bob", count: 20 });
    expect(w.state.items?.today.given.ada).toBeUndefined();
  });

  it("keeps the caps for a pair linked today, until tomorrow", () => {
    const w = friends();
    stock(w.state, "ada", { lemon: 100 });
    // Coins open first, so a new link waits a day (decision 0039), for things as for coins.
    w.ok(TOWN_ACTOR, { type: "open_economy" });
    w.ok(TOWN_ACTOR, { type: "add_owner_pair", pair: ["ada", "bob"] });
    w.ok("ada", { type: "give", item: "lemon", to: "bob", count: 20 });
    expect(w.code("ada", { type: "give", item: "lemon", to: "bob" })).toBe("gift_limit");
    w.day(DAY + 1);
    w.ok("ada", { type: "give", item: "lemon", to: "bob", count: 20 });
    w.ok("ada", { type: "give", item: "lemon", to: "bob", count: 20 });
  });

  it("refuses when they have no room", () => {
    const w = friends();
    const room = ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.bob);
    stock(w.state, "bob", { tomato: room });
    expect(w.code("ada", { type: "give", item: "lemon_seed", to: "bob" })).toBe("inventory_full");
  });
});

describe("replay", () => {
  it("rebuilds a world with items from its log", () => {
    const w = garden();
    w.settle("bob", 1);
    w.ok("ada", { type: "plant", x: 2, y: 2, seed: "strawberry" });
    w.day(DAY + 2);
    w.homeAgain("ada");
    w.day(DAY + 3);
    w.ok("ada", { type: "harvest", x: 2, y: 2 });
    w.ok("ada", { type: "craft", recipe: "strawberry_jam", x: 4, y: 2, label: "for Bob" });
    w.ok("ada", { type: "give", item: "strawberry_jam", to: "bob", note: "enjoy" });
    const copy = replay(CONFIG, w.log);
    expect(hashWorld(copy)).toBe(hashWorld(w.state));
    expect(inventoryOf(copy, "bob")?.goods[0]).toMatchObject({ label: "for Bob", maker: "ada" });
  });
});

describe("inventoryOf", () => {
  it("is null before items open, and shows stacks in catalog order", () => {
    const w = world();
    w.day(DAY);
    w.join("ada");
    expect(inventoryOf(w.state, "ada")).toBeNull();
    w.open();
    expect(inventoryOf(w.state, "ada")).toMatchObject({ stacks: [], goods: [], size: 0 });
    const g = garden();
    const read = inventoryOf(g.state, "ada");
    expect(read?.stacks.map((s) => s.kind)).toEqual([...SEED_KINDS, "sugar", "jar"]);
    expect(read?.pantryToday).toBe(true);
    expect(read?.size).toBe(SEED_KINDS.length * ITEMS.starterSeeds + 4);
  });
});
