import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { FISH_KINDS } from "./catalog";
import { ECONOMY } from "./economy";
import { biting, CATCHES, type CatchChance, catchOf, FISHING, FISHING_ROD } from "./fishing";
import { FISHING_CONFIG, FISHING_HASH, FISHING_LOG } from "./fixtures/fishing-log";
import { hashWorld } from "./hash";
import { ITEMS, inventorySize, POND } from "./items";
import { replay } from "./replay";
import { dayOfDate, SEASONS, type Season } from "./season";
import { BUY_ORDERS, SEASON_BUYS } from "./shop";
import { expectSupplyHolds, stock } from "./test-support";
import { TIMES_OF_DAY, type TimeOfDay } from "./time-of-day";
import {
  type Command,
  type RejectionCode,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { WEATHERS, type Weather } from "./weather";
import { createWorld } from "./world";

/**
 * Fishing (RFC 0023): ponds paid for in stone, a cast from beside one with a rod, what bites by
 * season, time of day, and weather, the day's casts, and the coins the town pays for a season's
 * fish, with every refusal leaving the world as it was.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const AUTUMN = dayOfDate(2026, 10, 10);
const WINTER = dayOfDate(2026, 12, 10);

/** Ada's and Bob's plots. The Commons is (1, 1). */
const HOMES = { ada: [0, 0], bob: [2, 0] } as const;
/** Inside Ada's hut: her hearth, the pond north of it, and her workbench. */
const ADA_HEARTH = { x: 3, y: 3 };
const ADA_POND = { x: 3, y: 2 };
const ADA_BENCH = { x: 2, y: 2 };

function send(state: WorldState, actor: string, command: Command) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  if (!result.ok) expect(hashWorld(state)).toBe(before);
  expectSupplyHolds(state);
  return result;
}

function ok(state: WorldState, actor: string, command: Command): WorldEvent[] {
  const result = send(state, actor, command);
  if (!result.ok) {
    throw new Error(`${actor} ${JSON.stringify(command)}: ${result.rejection.message}`);
  }
  return result.events;
}

/** A refusal with this code that leaves the world exactly as it was. Its message. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
  return result.ok ? "" : result.rejection.message;
}

const cast = (roll: number, weather: Weather, timeOfDay: TimeOfDay): Command => ({
  type: "fish",
  roll,
  weather,
  timeOfDay,
});

/** A roll that brings up nothing in autumn at noon in the sun, past everything biting then. */
const EMPTY = FISHING.outOf - 1;

/** A town on `day` with coins, items, and the shop open, and Ada and Bob home in starter huts. */
function town(day = AUTUMN): WorldState {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
  ] as Command[]) {
    ok(state, TOWN_ACTOR, command);
  }
  for (const [id, [px, py]] of Object.entries(HOMES)) {
    ok(state, id, { type: "join", name: id, kind: "human" });
    ok(state, id, { type: "settle", px, py });
    ok(state, id, { type: "build_starter_home" });
  }
  return state;
}

/** Ada with a rod she made and a tile of pond beside her hearth, standing on it. */
function angler(day = AUTUMN): WorldState {
  const state = town(day);
  stock(state, "ada", { wood: 3, stone: POND.stone });
  ok(state, "ada", { type: "place", ...ADA_BENCH, block: "workbench" });
  ok(state, "ada", { type: "craft", recipe: FISHING_ROD, ...ADA_BENCH });
  ok(state, "ada", { type: "place", ...ADA_POND, block: "pond" });
  return state;
}

const held = (state: WorldState, id: string, kind: string) =>
  (state.items?.inventories[id]?.stacks as Record<string, number> | undefined)?.[kind] ?? 0;

/** Put a resident on a tile, as a walk there would. */
function standAt(state: WorldState, id: string, x: number, y: number) {
  const r = state.residents[id];
  if (!r) throw new Error(`${id} isn't here`);
  r.x = x;
  r.y = y;
}

describe("the fishing log", () => {
  it("replays to its pinned hash, with every coin accounted for", () => {
    const state = replay(FISHING_CONFIG, FISHING_LOG);
    expect(hashWorld(state)).toBe(FISHING_HASH);
    expectSupplyHolds(state);
  });
});

describe("ponds", () => {
  it("take two stone a tile from whoever digs one, and give it back to whoever takes one up", () => {
    const state = town();
    stock(state, "ada", { stone: 3 });
    const placed = ok(state, "ada", { type: "place", ...ADA_POND, block: "pond" });
    expect(placed).toContainEqual({ type: "block_placed", ...ADA_POND, block: "pond", by: "ada" });
    expect(held(state, "ada", "stone")).toBe(1);
    // Bob shares the plot and takes it up: the stone is his now, as decor would be.
    ok(state, "ada", { type: "share_plot", with: "bob" });
    standAt(state, "bob", 3, 4);
    ok(state, "bob", { type: "remove", ...ADA_POND });
    expect(held(state, "bob", "stone")).toBe(POND.stone);
    expect(held(state, "ada", "stone")).toBe(1);
  });

  it("aren't dug without the stone, or taken up without room for it", () => {
    const state = town();
    stock(state, "ada", { stone: 1 });
    const message = refused(
      state,
      "ada",
      { type: "place", ...ADA_POND, block: "pond" },
      "not_enough_items",
    );
    expect(message).toContain("you need 1 stone more");
    stock(state, "ada", { stone: 1 });
    ok(state, "ada", { type: "place", ...ADA_POND, block: "pond" });
    stock(state, "ada", {
      sugar: ITEMS.inventoryMax - 1 - inventorySize(state.items?.inventories.ada),
    });
    refused(state, "ada", { type: "remove", ...ADA_POND }, "inventory_full");
  });

  it("stop walkers, and never go into a starter home", () => {
    const state = angler();
    refused(state, "ada", { type: "move", dir: "n" }, "blocked");
    refused(state, "bob", { type: "build_starter_home", walls: "pond" }, "unknown_item");
  });

  it("cost their stone in a build plan, and give it back when the plan takes one away", () => {
    const state = town();
    stock(state, "ada", { stone: POND.stone });
    const plan = (command: Partial<Extract<Command, { type: "build" }>>): Command => ({
      type: "build",
      px: 0,
      py: 0,
      ...command,
    });
    const two = [
      { ...ADA_POND, block: "pond" as const },
      { x: 4, y: 2, block: "pond" as const },
    ];
    expect(refused(state, "ada", plan({ blocks: two }), "not_enough_items")).toContain("2 stone");
    ok(state, "ada", plan({ blocks: [two[0] as (typeof two)[number]] }));
    expect(held(state, "ada", "stone")).toBe(0);
    // Moving it is free: the tile taken away pays for the one dug.
    ok(state, "ada", plan({ remove: [ADA_POND], blocks: [two[1] as (typeof two)[number]] }));
    expect(held(state, "ada", "stone")).toBe(0);
    ok(state, "ada", plan({ remove: [{ x: 4, y: 2 }] }));
    expect(held(state, "ada", "stone")).toBe(POND.stone);
  });
});

describe("casting", () => {
  it("needs a rod, water right beside you, a cast left today, and room for a catch", () => {
    const state = town();
    stock(state, "ada", { wood: 3, stone: POND.stone });
    ok(state, "ada", { type: "place", ...ADA_BENCH, block: "workbench" });
    expect(refused(state, "ada", cast(0, "clear", "day"), "no_rod")).toContain("3 wood");
    ok(state, "ada", { type: "craft", recipe: FISHING_ROD, ...ADA_BENCH });
    expect(refused(state, "ada", cast(0, "clear", "day"), "no_water")).toContain(
      "none within 12 tiles",
    );
    // Water out past her door isn't beside her: the refusal says where it is.
    ok(state, "ada", { type: "place", x: 3, y: 6, block: "pond" });
    expect(refused(state, "ada", cast(0, "clear", "day"), "no_water")).toContain(
      "The nearest pond is at x 3, y 6.",
    );
    // Beside her, diagonals included.
    stock(state, "ada", { stone: POND.stone });
    ok(state, "ada", { type: "place", x: 4, y: 4, block: "pond" });
    for (let i = 0; i < FISHING.castsPerDay; i++) ok(state, "ada", cast(EMPTY, "clear", "day"));
    expect(refused(state, "ada", cast(EMPTY, "clear", "day"), "cast_limit")).toContain(
      `${FISHING.castsPerDay} times today`,
    );
    // A new day, and a full inventory: nothing to lose, but nowhere to put a catch.
    ok(state, TOWN_ACTOR, { type: "new_day", day: AUTUMN + 1 });
    stock(state, "ada", {
      sugar: ITEMS.inventoryMax - inventorySize(state.items?.inventories.ada),
    });
    refused(state, "ada", cast(EMPTY, "clear", "day"), "inventory_full");
  });

  it("is refused with items closed, and with a roll, weather, or time the server never logs", () => {
    const closed = createWorld(CONFIG);
    ok(closed, TOWN_ACTOR, { type: "new_day", day: AUTUMN });
    ok(closed, "ada", { type: "join", name: "Ada", kind: "human" });
    refused(closed, "ada", cast(0, "clear", "day"), "items_closed");
    const state = angler();
    for (const command of [
      cast(-1, "clear", "day"),
      cast(FISHING.outOf, "clear", "day"),
      cast(0.5, "clear", "day"),
      cast(0, "hail" as Weather, "day"),
      cast(0, "clear", "noon" as TimeOfDay),
      { type: "fish" } as Command,
    ]) {
      refused(state, "ada", command, "server_only");
    }
  });

  it("counts every cast, whatever comes up, and starts over each day", () => {
    const state = angler();
    // A boot and nothing each use up a cast, like a fish.
    for (let i = 0; i < FISHING.castsPerDay; i++) {
      ok(state, "ada", cast(i % 2 === 0 ? 0 : EMPTY, "clear", "day"));
    }
    refused(state, "ada", cast(EMPTY, "clear", "day"), "cast_limit");
    ok(state, TOWN_ACTOR, { type: "new_day", day: AUTUMN + 1 });
    ok(state, "ada", cast(EMPTY, "clear", "day"));
  });

  it("puts a fish in your things, and throws a boot back, telling everyone what came up", () => {
    const state = angler();
    const before = inventorySize(state.items?.inventories.ada);
    expect(ok(state, "ada", cast(500, "clear", "day"))).toEqual([
      { type: "fished", by: "ada", ...ADA_POND, caught: "minnow" },
      {
        type: "inventory",
        residentId: "ada",
        reason: "caught",
        changes: [{ kind: "minnow", amount: 1, count: 1 }],
      },
    ]);
    expect(ok(state, "ada", cast(0, "clear", "day"))).toEqual([
      { type: "fished", by: "ada", ...ADA_POND, caught: "boot" },
    ]);
    expect(ok(state, "ada", cast(EMPTY, "clear", "day"))).toEqual([
      { type: "fished", by: "ada", ...ADA_POND, caught: "nothing" },
    ]);
    expect(inventorySize(state.items?.inventories.ada)).toBe(before + 1);
  });
});

/** Every season, time of day, and weather there is, snow only in winter as the sky has it. */
const SKIES: [Season, TimeOfDay, Weather][] = SEASONS.flatMap((season) =>
  TIMES_OF_DAY.flatMap((time) =>
    WEATHERS.filter((w) => w !== "snow" || season === "winter").map(
      (weather): [Season, TimeOfDay, Weather] => [season, time, weather],
    ),
  ),
);

describe("what bites", () => {
  it("is the frozen table decision 0123 records, since every logged cast replays through it", () => {
    expect(CATCHES).toEqual([
      { kind: "boot", chance: 500 },
      { kind: "minnow", chance: 3000 },
      { kind: "perch", chance: 1500, times: ["dawn", "day"] },
      { kind: "carp", chance: 1500 },
      { kind: "catfish", chance: 1500, times: ["dusk", "night"] },
      { kind: "eel", chance: 1000, times: ["night"], weathers: ["rain", "fog"] },
      {
        kind: "trout",
        chance: 1200,
        seasons: ["spring", "summer"],
        times: ["dawn", "day"],
        weathers: ["clear", "cloudy"],
      },
      { kind: "smelt", chance: 1200, seasons: ["spring"], times: ["dusk", "night"] },
      { kind: "sunfish", chance: 1200, seasons: ["summer"], times: ["day"], weathers: ["clear"] },
      { kind: "salmon", chance: 1200, seasons: ["autumn"] },
      {
        kind: "pike",
        chance: 800,
        seasons: ["autumn", "winter"],
        times: ["dawn", "dusk", "night"],
      },
      { kind: "char", chance: 1000, seasons: ["winter"], weathers: ["cloudy", "fog", "snow"] },
      { kind: "golden_koi", chance: 40, times: ["dawn", "day"], weathers: ["clear", "cloudy"] },
      { kind: "moonfish", chance: 120, times: ["night"], weathers: ["rain", "fog", "snow"] },
    ]);
  });

  it("names every fish once, and every fish bites under some sky", () => {
    const fish = CATCHES.map((c) => c.kind).filter((k) => k !== "boot");
    expect([...fish].sort()).toEqual([...FISH_KINDS].sort());
    for (const kind of FISH_KINDS) {
      expect(
        SKIES.some(([s, t, w]) => biting(s, t, w).some((c) => c.kind === kind)),
        kind,
      ).toBe(true);
    }
  });

  it("always leaves room for the boot first and for nothing last, under every sky", () => {
    for (const [season, time, weather] of SKIES) {
      const now = biting(season, time, weather);
      const total = now.reduce((sum, c) => sum + c.chance, 0);
      expect(now[0]?.kind, `${season} ${time} ${weather}`).toBe("boot");
      expect(total, `${season} ${time} ${weather}`).toBeLessThan(FISHING.outOf);
      expect(catchOf(FISHING.outOf - 1, season, time, weather)).toBe("nothing");
    }
  });

  it("picks the first kind whose running total covers the roll", () => {
    // Autumn, at night in the rain: the boot, minnows, carp, catfish, eels, salmon, pike, and the
    // moonfish, which bites in nothing gentler.
    const at = (roll: number) => catchOf(roll, "autumn", "night", "rain");
    const edges: [number, string][] = [
      [0, "boot"],
      [499, "boot"],
      [500, "minnow"],
      [3499, "minnow"],
      [3500, "carp"],
      [5000, "catfish"],
      [6500, "eel"],
      [7500, "salmon"],
      [8700, "pike"],
      [9500, "moonfish"],
      [9619, "moonfish"],
      [9620, "nothing"],
    ];
    for (const [roll, kind] of edges) expect(at(roll), String(roll)).toBe(kind);
  });

  it("changes with the season, the time of day, and the weather", () => {
    const bites = (kind: string, season: Season, time: TimeOfDay, weather: Weather) =>
      biting(season, time, weather).some((c: CatchChance) => c.kind === kind);
    const cases: [string, Season, TimeOfDay, Weather, boolean][] = [
      ["salmon", "autumn", "day", "clear", true],
      ["salmon", "winter", "day", "clear", false],
      ["perch", "spring", "day", "fog", true],
      ["perch", "spring", "night", "fog", false],
      ["eel", "summer", "night", "rain", true],
      ["eel", "summer", "night", "clear", false],
      ["moonfish", "winter", "night", "snow", true],
      ["moonfish", "winter", "dusk", "snow", false],
      ["moonfish", "autumn", "night", "cloudy", false],
      ["golden_koi", "summer", "dawn", "cloudy", true],
      ["golden_koi", "summer", "dawn", "rain", false],
      ["char", "winter", "dusk", "snow", true],
      ["char", "winter", "dusk", "clear", false],
    ];
    for (const [kind, season, time, weather, want] of cases) {
      expect(bites(kind, season, time, weather), `${kind} ${season} ${time} ${weather}`).toBe(want);
    }
  });
});

describe("fairness", () => {
  it("reads only the logged roll, weather, and time, and the season: never who casts, when, or after whom", () => {
    // No stock lies in the water, so casting first, fast, or often takes nothing from anyone, and
    // the log's order and seq change no catch.
    const rolls = [0, 500, 3600, 5100, 6600, 7710, 9000];
    const catches = (state: WorldState, who: string) =>
      rolls.map((roll) => {
        const events = ok(state, who, cast(roll, "clear", "day"));
        return events[0]?.type === "fished" ? events[0].caught : undefined;
      });
    const state = angler();
    const first = catches(state, "ada");
    // Bob casts the same rolls into Ada's pond after her, a few inputs later.
    standAt(state, "bob", ADA_HEARTH.x + 1, ADA_HEARTH.y);
    ok(state, "bob", { type: "profile", note: "Fishing at Ada's" });
    stock(state, "bob", { wood: 3 });
    ok(state, "bob", { type: "craft", recipe: FISHING_ROD, ...ADA_BENCH });
    expect(catches(state, "bob")).toEqual(first);
    expect(first).toEqual(["boot", "minnow", "perch", "carp", "salmon", "golden_koi", "nothing"]);
  });
});

describe("coins for fish", () => {
  it("come from each season's own fish, 2 a day at 2 coins each, as decision 0123 records", () => {
    const fishBuys = (season: Season) =>
      SEASON_BUYS[season].filter((k) => (FISH_KINDS as readonly string[]).includes(k));
    expect(Object.fromEntries(SEASONS.map((s) => [s, fishBuys(s)]))).toEqual({
      spring: ["trout"],
      summer: ["sunfish"],
      autumn: ["salmon"],
      winter: ["char"],
    });
    for (const season of SEASONS) {
      for (const kind of fishBuys(season)) {
        expect(BUY_ORDERS[kind], kind).toEqual({ price: 2, perDay: 2 });
      }
    }
  });

  it("never pay one resident more in a day than half the allowance", () => {
    // Decision 0039's rule: a cast costs nothing but time, so fish must never mint coins faster
    // than coming home does.
    for (const season of SEASONS) {
      const most = SEASON_BUYS[season]
        .filter((k) => (FISH_KINDS as readonly string[]).includes(k))
        .reduce((sum, k) => sum + BUY_ORDERS[k].price * BUY_ORDERS[k].perDay, 0);
      expect(most, season).toBeLessThanOrEqual(ECONOMY.allowance / 2);
    }
  });

  it("stop at the day's count, and the town buys a season's fish only in its season", () => {
    const state = angler();
    stock(state, "ada", { salmon: 3, char: 1 });
    const coins = () => state.economy?.coins.ada ?? 0;
    const before = coins();
    ok(state, "ada", { type: "sell_to_town", item: "salmon", count: 2 });
    expect(coins()).toBe(before + 2 * BUY_ORDERS.salmon.price);
    refused(state, "ada", { type: "sell_to_town", item: "salmon" }, "sell_limit");
    refused(state, "ada", { type: "sell_to_town", item: "char" }, "not_buying");
    ok(state, TOWN_ACTOR, { type: "new_day", day: WINTER });
    refused(state, "ada", { type: "sell_to_town", item: "salmon" }, "not_buying");
    ok(state, "ada", { type: "sell_to_town", item: "char" });
  });
});
