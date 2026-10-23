import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { biomeAt } from "./biome";
import { FISHING_CONFIG } from "./fixtures/fishing-log";
import { FLOORS_CONFIG, FLOORS_LOG } from "./fixtures/floors-log";
import { KILN_CONFIG, KILN_HASH, KILN_LOG } from "./fixtures/kiln-log";
import { byWater, gatherableAt, pickupLeft, pickupsInReach } from "./gather";
import { hashWorld } from "./hash";
import { ITEMS, inventorySize } from "./items";
import {
  type ClayRule,
  FINISHES,
  finishOf,
  GLAZE_COSTS,
  type Glaze,
  POTTERY,
  potAt,
  potsOf,
  readyKilns,
} from "./pottery";
import { knows, onShelf, shelfOn } from "./recipes";
import { replay } from "./replay";
import { dayOfDate } from "./season";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type Command,
  type RejectionCode,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

/**
 * Pottery (RFC 0047, phase 1): clay on the ground, a kiln for stone, pots loaded with `craft` and
 * taken out the next day with `harvest` at the server's roll, all behind `open_clay`. Every refusal
 * leaves the world as it was.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DAY = dayOfDate(2026, 10, 25);
/** Inside Ada's starter hut on plot (0, 0): her hearth, and the kiln north of it. */
const KILN_AT = { x: 3, y: 2 };

function ok(state: WorldState, actor: string, command: Command): WorldEvent[] {
  const result = apply(state, { actor, command });
  if (!result.ok) {
    throw new Error(`${actor} ${JSON.stringify(command)}: ${result.rejection.message}`);
  }
  expectSupplyHolds(state);
  return result.events;
}

/** A refusal with this code that leaves the world exactly as it was. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
}

/** Ada and Bob home in starter huts, and Cy sharing Ada's plot, with or without clay out. */
function town(clay = true): WorldState {
  const state = createWorld(CONFIG);
  for (const type of ["open_economy", "open_items", "open_shop"] as const) {
    if (type === "open_economy") ok(state, TOWN_ACTOR, { type: "new_day", day: DAY });
    ok(state, TOWN_ACTOR, { type });
  }
  for (const [id, px] of [
    ["ada", 0],
    ["bob", 2],
  ] as const) {
    ok(state, id, { type: "join", name: id, kind: "human" });
    ok(state, id, { type: "settle", px, py: 0 });
    ok(state, id, { type: "build_starter_home" });
  }
  ok(state, "cy", { type: "join", name: "cy", kind: "human" });
  ok(state, "ada", { type: "share_plot", with: "cy" });
  if (clay) ok(state, TOWN_ACTOR, { type: "open_clay", water: true });
  return state;
}

/** Ada's world with a kiln north of her hearth and what three pots take in her things. */
function potter(): WorldState {
  const state = town();
  stock(state, "ada", { stone: POTTERY.kilnStone, clay: 12, wood: 2, lemon: 1 });
  ok(state, "ada", { type: "place", ...KILN_AT, block: "kiln" });
  return state;
}

const load = (recipe: "bowl" | "vase" | "teapot", glaze?: string): Command =>
  ({ type: "craft", recipe, ...KILN_AT, ...(glaze ? { glaze } : {}) }) as Command;
const open = (roll?: number): Command => ({
  type: "harvest",
  ...KILN_AT,
  ...(roll === undefined ? {} : { roll }),
});
const held = (state: WorldState, id: string, kind: string) =>
  (state.items?.inventories[id]?.stacks as Record<string, number> | undefined)?.[kind] ?? 0;
const goods = (state: WorldState, id: string) => state.items?.inventories[id]?.goods ?? [];

describe("the kiln log", () => {
  it("replays to its pinned hash, with every coin accounted for", () => {
    const state = replay(KILN_CONFIG, KILN_LOG);
    expect(hashWorld(state)).toBe(KILN_HASH);
    expectSupplyHolds(state);
    // The teapot stands on its pedestal in its glaze and finish, and the vase is in the market.
    expect(state.items?.displays?.["3,2"]).toMatchObject({
      good: { kind: "teapot", glaze: "sea", finish: "plain" },
    });
    expect(Object.values(state.market?.listings ?? {}).at(-1)?.goods?.[0]).toMatchObject({
      kind: "vase",
      finish: "speckled",
    });
  });
});

describe("before open_clay", () => {
  it("leaves every pickup where it lay, and lays clay only where nothing else would", () => {
    // Every tile of the fishing world for two seasons of days: clay changes no answer but a bare
    // tile's, and only on meadow or sand, so no logged gather replays differently.
    // Under both rules: the first one's, on meadow and sand, and beside water, asked of every tile
    // as if water lay beside it.
    const wrong: string[] = [];
    const bare = { meadow_and_sand: 0, by_water: 0 };
    const clay = { meadow_and_sand: 0, by_water: 0 };
    const at = (x: number, y: number, day: number, finds: boolean, rule: ClayRule, water = true) =>
      gatherableAt(FISHING_CONFIG, x, y, day, finds, finds, 1, rule, water);
    for (let day = 20_000; day < 20_180; day += 3) {
      for (let y = 0; y < FISHING_CONFIG.height; y++) {
        for (let x = 0; x < FISHING_CONFIG.width; x++) {
          const before = gatherableAt(FISHING_CONFIG, x, y, day, true, true);
          const biome = biomeAt(FISHING_CONFIG, x, y);
          for (const rule of ["meadow_and_sand", "by_water"] as const) {
            const after = at(x, y, day, true, rule);
            if (before !== null && after !== before) wrong.push(`${x},${y} on ${day}: ${before}`);
            // With finds out or not, clay never lies where a find would.
            if (at(x, y, day, false, rule) === "clay" && after !== "clay") {
              wrong.push(`${x},${y} on ${day} moved under ${rule}`);
            }
            const ground = rule === "by_water" || biome === "meadow" || biome === "sand";
            if (after === "clay" && !ground) wrong.push(`${biome} under ${rule}`);
            if (before === null && ground) {
              bare[rule] += 1;
              if (after === "clay") clay[rule] += 1;
            }
          }
          // Beside water only: a dry tile holds none.
          if (at(x, y, day, true, "by_water", false) === "clay") wrong.push(`${x},${y} dry`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // About a quarter of bare meadow and sand holds clay on a day under the first rule, and about
    // a fifth of bare ground beside water under the second.
    const share = (rule: keyof typeof bare) => clay[rule] / bare[rule];
    expect(Math.abs(share("meadow_and_sand") - POTTERY.clayChance)).toBeLessThan(0.03);
    expect(Math.abs(share("by_water") - POTTERY.clayByWaterChance)).toBeLessThan(0.03);
  });

  it("refuses every part of pottery, and keeps the pots off the shelf and out of what anyone knows", () => {
    const state = town(false);
    stock(state, "ada", { stone: POTTERY.kilnStone, clay: 4 });
    refused(state, "ada", { type: "place", ...KILN_AT, block: "kiln" }, "pottery_closed");
    refused(
      state,
      "ada",
      { type: "build", px: 0, py: 0, blocks: [{ ...KILN_AT, block: "kiln" }] },
      "pottery_closed",
    );
    ok(state, "ada", { type: "place", ...KILN_AT, block: "workbench" });
    refused(state, "ada", load("bowl"), "pottery_closed");
    expect(knows(state, "ada", "bowl")).toBe(false);
    expect(shelfOn(DAY).some((r) => r === "vase" || r === "teapot")).toBe(false);
    expect(onShelf("vase", DAY, true)).toBe(true);
    refused(state, "ada", { type: "open_clay" }, "server_only");
  });
});

describe("open_clay", () => {
  it("comes once, from the town, after items open", () => {
    const state = createWorld(CONFIG);
    refused(state, TOWN_ACTOR, { type: "open_clay" }, "items_closed");
    const opened = town();
    refused(opened, TOWN_ACTOR, { type: "open_clay" }, "already_open");
    expect(opened.items?.clayOpen).toBe(true);
    expect(knows(opened, "ada", "bowl")).toBe(true);
  });
});

describe("clay beside water", () => {
  /** Ada's world with clay beside water, a pond east of her hut, and the first day clay lies by it. */
  function byThePond() {
    const state = town(false);
    ok(state, TOWN_ACTOR, { type: "open_clay", water: true });
    const pond = { x: 6, y: 3 };
    stock(state, "ada", { stone: 2 });
    ok(state, "ada", { type: "place", ...pond, block: "pond" });
    const ada = state.residents.ada;
    if (!ada) throw new Error("no Ada");
    Object.assign(ada, { x: 6, y: 5 });
    for (let day = DAY + 1; day < DAY + 200; day++) {
      ok(state, TOWN_ACTOR, { type: "new_day", day });
      const lying = pickupsInReach(
        state.config,
        ada,
        (x, y) => pickupLeft(state, x, y),
        () => true,
      );
      if (lying.filter((p) => p.kind === "clay").length >= 2) return { state, pond, lying };
    }
    throw new Error("no day with clay beside the pond");
  }

  it("lies only on tiles beside a pond or the sea", () => {
    const { state, lying } = byThePond();
    const wet = (x: number, y: number) => byWater(state, x, y);
    expect(lying.filter((p) => p.kind === "clay").every((p) => wet(p.x, p.y))).toBe(true);
    // Nowhere dry in the whole world holds any.
    const dry: string[] = [];
    for (let y = 0; y < CONFIG.height; y++) {
      for (let x = 0; x < CONFIG.width; x++) {
        if (pickupLeft(state, x, y) === "clay" && !wet(x, y)) dry.push(`${x},${y}`);
      }
    }
    expect(dry).toEqual([]);
    expect(state.items?.clayByWater).toBe(true);
    refused(state, TOWN_ACTOR, { type: "open_clay", water: true }, "already_open");
  });

  it(`picks up at most ${POTTERY.clayPerDay} a day, leaving the rest where it lies`, () => {
    const { state } = byThePond();
    const items = state.items;
    if (!items) throw new Error("no items");
    // Up to one short of the day's most, so one more fits and the next is refused.
    items.today.clay = { ada: POTTERY.clayPerDay - 1 };
    ok(state, "ada", { type: "gather" });
    expect(held(state, "ada", "clay")).toBe(1);
    expect(items.today.clay).toEqual({ ada: POTTERY.clayPerDay });
    const left = pickupsInReach(
      state.config,
      { x: 6, y: 5 },
      (x, y) => pickupLeft(state, x, y),
      () => true,
    ).find((p) => p.kind === "clay");
    if (!left) throw new Error("no clay left");
    refused(state, "ada", { type: "gather" }, "clay_limit");
    refused(state, "ada", { type: "gather", x: left.x, y: left.y }, "clay_limit");
    // Tomorrow the count starts again.
    ok(state, TOWN_ACTOR, { type: "new_day", day: (state.day ?? 0) + 1 });
    expect(items.today.clay).toBeUndefined();
  });
});

describe("a kiln", () => {
  it("costs two stone, four by the first clay rule, and gives them back to whoever takes it up", () => {
    const cases = [
      [{ type: "open_clay", water: true }, POTTERY.kilnStone],
      [{ type: "open_clay" }, POTTERY.kilnStoneFirstRule],
    ] as const;
    expect(cases.map(([, n]) => n)).toEqual([2, 4]);
    for (const [open, stone] of cases) {
      const state = town(false);
      ok(state, TOWN_ACTOR, open);
      stock(state, "ada", { stone: stone - 1 });
      refused(state, "ada", { type: "place", ...KILN_AT, block: "kiln" }, "not_enough_items");
      stock(state, "ada", { stone: 1 });
      ok(state, "ada", { type: "place", ...KILN_AT, block: "kiln" });
      expect(held(state, "ada", "stone")).toBe(0);
      ok(state, "ada", { type: "remove", ...KILN_AT });
      expect(held(state, "ada", "stone")).toBe(stone);
    }
  });

  it("fires one pot overnight, made at loading, and its loader takes it out at the server's roll", () => {
    const state = potter();
    const loaded = ok(state, "ada", { ...load("bowl", "honey"), label: "Sunny" } as Command);
    expect(loaded[0]).toEqual({ type: "kiln_loaded", ...KILN_AT, by: "ada", readyDay: DAY + 1 });
    // Two clay and a lemon for the honey glaze, and the day's craft count.
    expect([held(state, "ada", "clay"), held(state, "ada", "lemon")]).toEqual([10, 0]);
    expect(state.items?.today.crafted.ada).toBe(1);
    refused(state, "ada", load("vase"), "tile_occupied");
    refused(state, "ada", open(0), "not_ready");
    refused(state, "ada", { type: "remove", ...KILN_AT }, "tile_occupied");
    // Nor can staff clear it from under the pot, which would leave the pot with no way out.
    refused(state, TOWN_ACTOR, { type: "clear_block", ...KILN_AT }, "tile_occupied");
    ok(state, TOWN_ACTOR, { type: "new_day", day: DAY + 1 });
    expect(readyKilns(state, "ada")).toHaveLength(1);
    refused(state, "ada", open(), "server_only");
    refused(state, "ada", open(POTTERY.outOf), "server_only");
    const out = ok(state, "ada", open(1500));
    expect(out[0]).toEqual({ type: "kiln_emptied", ...KILN_AT, by: "ada" });
    expect(goods(state, "ada")).toEqual([
      {
        id: "i_1",
        kind: "bowl",
        maker: "ada",
        madeDay: DAY,
        label: "Sunny",
        glaze: "honey",
        finish: "crackle",
      },
    ]);
    expect(state.items?.firings).toBeUndefined();
    refused(state, "ada", open(0), "no_crop");
  });

  it("refuses what a pot can't be: a glaze off the list or not held, a glaze on anything else", () => {
    const state = potter();
    refused(state, "ada", load("bowl", "gold"), "unknown_item");
    // Bob stands within reach of Ada's kiln, but it isn't his to load: he could never open it.
    const bob = state.residents.bob;
    if (!bob) throw new Error("no Bob");
    stock(state, "bob", { clay: 2 });
    Object.assign(bob, { x: KILN_AT.x, y: KILN_AT.y + 1 });
    refused(state, "bob", load("bowl"), "not_your_plot");
    refused(state, "ada", load("bowl", "sea"), "not_enough_items");
    ok(state, "ada", { type: "place", x: 4, y: 3, block: "workbench" });
    refused(
      state,
      "ada",
      { type: "craft", recipe: "chair", x: 4, y: 3, glaze: "bare" } as Command,
      "unknown_item",
    );
    refused(state, "ada", { type: "craft", recipe: "bowl", x: 4, y: 3 }, "no_station");
    refused(state, "ada", { type: "harvest", x: 4, y: 3, roll: 1 }, "server_only");
    // Every glaze costs the one thing the RFC names, or nothing for bare.
    expect(GLAZE_COSTS).toEqual({
      bare: null,
      cream: "seashell",
      sea: "sea_glass",
      crystal: "crystal",
      rose: "flower",
      honey: "lemon",
      berry: "strawberry",
      moss: "herb",
    });
  });

  it("gives the pot to whoever loaded it, held aside when a co-owner opens it for a full loader", () => {
    const state = potter();
    ok(state, "ada", load("teapot"));
    ok(state, TOWN_ACTOR, { type: "new_day", day: DAY + 1 });
    // Cy shares the plot, so Cy may open it, and the teapot is Ada's.
    const cy = state.residents.cy;
    if (!cy) throw new Error("no Cy");
    Object.assign(cy, { x: 3, y: 3, online: true });
    stock(state, "ada", { wood: ITEMS.inventoryMax - inventorySize(state.items?.inventories.ada) });
    refused(state, "ada", open(9000), "inventory_full");
    ok(state, "cy", open(9000));
    expect(goods(state, "cy")).toEqual([]);
    expect(state.items?.heldAside).toMatchObject([{ by: "ada", good: { kind: "teapot" } }]);
    // Bob has no share of the plot, so the kiln isn't his to open.
    ok(state, "ada", load("bowl"));
    refused(state, "bob", open(0), "out_of_reach");
  });

  it("takes a card for the vase and the teapot once recipes are learned, and none for the bowl", () => {
    const state = potter();
    fund(state, "ada", 100);
    ok(state, TOWN_ACTOR, { type: "open_recipes" });
    ok(state, "eve", { type: "join", name: "eve", kind: "human" });
    ok(state, "ada", { type: "share_plot", with: "eve" });
    const eve = state.residents.eve;
    if (!eve) throw new Error("no Eve");
    Object.assign(eve, { x: 3, y: 3 });
    stock(state, "eve", { clay: 3 });
    refused(state, "eve", load("vase"), "recipe_unknown");
    ok(state, "eve", load("bowl"));
    expect(onShelf("vase", DAY, true) && onShelf("teapot", DAY, true)).toBe(true);
  });
});

/** A pot straight into a resident's things, as the kiln would have fired it. */
function hand(state: WorldState, id: string, kind: "bowl" | "vase" | "teapot", glaze = "sea") {
  const items = state.items;
  if (!items) throw new Error("no items");
  const good = {
    id: `i_${items.nextId}`,
    kind,
    maker: id,
    madeDay: DAY,
    glaze: glaze as Glaze,
    finish: "speckled" as const,
  };
  items.nextId += 1;
  const inv = items.inventories[id] ?? { stacks: {}, goods: [] };
  inv.goods.push(good);
  items.inventories[id] = inv;
  return good;
}

describe("a pot set down", () => {
  /** On Ada's plot, east of her hut and within reach of her hearth. */
  const SPOT = { x: 6, y: 3 };
  const setDown = (item: string, extra: Partial<Command> = {}): Command =>
    ({ type: "place", ...SPOT, block: "pot", item, ...extra }) as Command;

  it("stands on its tile as itself, keeps its maker, and comes back when taken up", () => {
    const state = town();
    const bowl = hand(state, "ada", "bowl", "honey");
    const events = ok(state, "ada", setDown(bowl.id));
    expect(events[0]).toEqual({
      type: "block_placed",
      ...SPOT,
      block: "pot",
      by: "ada",
      pot: bowl,
    });
    expect(state.blocks["6,3"]).toBe("pot");
    expect(potAt(state, SPOT.x, SPOT.y)).toEqual({ good: bowl, by: "ada", day: DAY });
    expect(goods(state, "ada")).toEqual([]);
    expectSupplyHolds(state);
    // Nobody clears it or plans it away from under its owner.
    refused(state, TOWN_ACTOR, { type: "clear_block", ...SPOT }, "tile_occupied");
    ok(state, "ada", { type: "remove", ...SPOT });
    expect(goods(state, "ada")).toEqual([bowl]);
    expect(state.blocks["6,3"]).toBeUndefined();
    expect(state.items?.pots).toBeUndefined();
  });

  it("puts a flower from your things in a vase, which keeps it", () => {
    const state = town();
    const vase = hand(state, "ada", "vase");
    stock(state, "ada", { tulip: 1 });
    ok(state, "ada", setDown(vase.id, { flower: "tulip" } as Partial<Command>));
    expect(held(state, "ada", "tulip")).toBe(0);
    expect(potAt(state, SPOT.x, SPOT.y)?.good.flower).toBe("tulip");
    ok(state, "ada", { type: "remove", ...SPOT });
    expect(goods(state, "ada")).toEqual([{ ...vase, flower: "tulip" }]);
    // It holds one already, so another goes nowhere.
    stock(state, "ada", { flower: 1 });
    refused(
      state,
      "ada",
      setDown(vase.id, { flower: "flower" } as Partial<Command>),
      "already_set",
    );
  });

  it("refuses what isn't a pot of yours, a flower it can't hold, and a pot anywhere but place", () => {
    const state = town();
    const bowl = hand(state, "ada", "bowl");
    const vase = hand(state, "ada", "vase");
    const bobs = hand(state, "bob", "teapot");
    const cases: [Command, RejectionCode][] = [
      [{ type: "place", ...SPOT, block: "pot" }, "unknown_item"],
      [setDown(bobs.id), "not_enough_items"],
      [setDown("i_999"), "not_enough_items"],
      [setDown(bowl.id, { flower: "tulip" } as Partial<Command>), "unknown_item"],
      [setDown(vase.id, { flower: "herb" } as Partial<Command>), "unknown_item"],
      [setDown(vase.id, { flower: "tulip" } as Partial<Command>), "not_enough_items"],
      [{ type: "place", ...SPOT, block: "wood", item: bowl.id } as Command, "unknown_item"],
      [{ type: "place", x: 17, y: 3, block: "pot", item: bowl.id } as Command, "out_of_reach"],
      [{ type: "build", px: 0, py: 0, blocks: [{ ...SPOT, block: "pot" }] }, "unknown_item"],
    ];
    for (const [command, code] of cases) refused(state, "ada", command, code);
    // Not before pottery opens, though the pot itself came from somewhere.
    const shut = town(false);
    refused(shut, "ada", setDown(hand(shut, "ada", "bowl").id), "pottery_closed");
  });

  it("goes back to whoever set it down, held aside when a co-owner takes it up for a full owner", () => {
    const state = town();
    const bowl = hand(state, "ada", "bowl");
    ok(state, "ada", setDown(bowl.id));
    const cy = state.residents.cy;
    if (!cy) throw new Error("no Cy");
    Object.assign(cy, { x: 5, y: 3, online: true });
    stock(state, "ada", { wood: ITEMS.inventoryMax - inventorySize(state.items?.inventories.ada) });
    refused(state, "ada", { type: "remove", ...SPOT }, "inventory_full");
    ok(state, "cy", { type: "remove", ...SPOT });
    expect(goods(state, "cy")).toEqual([]);
    expect(state.items?.heldAside).toEqual([{ good: bowl, by: "ada", day: DAY }]);
  });

  it("stands upstairs too, keyed by its floor", () => {
    const state = replay(FLOORS_CONFIG, FLOORS_LOG);
    ok(state, TOWN_ACTOR, { type: "open_clay", water: true });
    ok(state, "dee", { type: "move", dir: "up" });
    const teapot = hand(state, "dee", "teapot");
    const loft = { x: 11, y: 3, floor: 1 };
    ok(state, "dee", { type: "place", ...loft, block: "pot", item: teapot.id });
    expect(state.floors?.["1"]?.blocks["11,3"]).toBe("pot");
    expect(potsOf(state)).toEqual([
      { x: 11, y: 3, floor: 1, pot: { good: teapot, by: "dee", day: state.day } },
    ]);
    expect(potAt(state, 11, 3)).toBeUndefined();
    ok(state, "dee", { type: "remove", ...loft });
    expect(goods(state, "dee").at(-1)).toEqual(teapot);
  });
});

describe("a pot of tea", () => {
  it("is brewed at a kitchen in a teapot you hold and keep, and only once pottery is open", () => {
    const brew: Command = { type: "craft", recipe: "pot_of_tea", x: 3, y: 2 };
    const shut = town(false);
    stock(shut, "ada", { herb: 2 });
    ok(shut, "ada", { type: "place", x: 3, y: 2, block: "kitchen" });
    refused(shut, "ada", brew, "pottery_closed");
    expect(knows(shut, "ada", "pot_of_tea")).toBe(false);
    const state = town();
    stock(state, "ada", { herb: 2 });
    ok(state, "ada", { type: "place", x: 3, y: 2, block: "kitchen" });
    refused(state, "ada", brew, "not_enough_items");
    const teapot = hand(state, "ada", "teapot");
    ok(state, "ada", brew);
    expect(goods(state, "ada").map((g) => g.kind)).toEqual(["teapot", "pot_of_tea"]);
    expect(goods(state, "ada")[0]).toEqual(teapot);
    expect(held(state, "ada", "herb")).toBe(0);
    expect(knows(state, "bob", "pot_of_tea")).toBe(true);
  });
});

describe("the finish", () => {
  it("is read from the roll through the frozen table: one in five has one, one in a hundred shines", () => {
    expect(FINISHES).toEqual([
      { finish: "speckled", chance: 1500 },
      { finish: "crackle", chance: 500 },
      { finish: "iridescent", chance: 100 },
    ]);
    const at = [0, 1499, 1500, 1999, 2000, 2099, 2100, POTTERY.outOf - 1].map(finishOf);
    expect(at).toEqual([
      "speckled",
      "speckled",
      "crackle",
      "crackle",
      "iridescent",
      "iridescent",
      "plain",
      "plain",
    ]);
  });
});
