import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { biomeAt } from "./biome";
import { FISHING_CONFIG } from "./fixtures/fishing-log";
import { KILN_CONFIG, KILN_HASH, KILN_LOG } from "./fixtures/kiln-log";
import { gatherableAt } from "./gather";
import { hashWorld } from "./hash";
import { ITEMS, inventorySize } from "./items";
import { FINISHES, finishOf, GLAZE_COSTS, POTTERY, readyKilns } from "./pottery";
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
  if (clay) ok(state, TOWN_ACTOR, { type: "open_clay" });
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
    const wrong: string[] = [];
    let bare = 0;
    let clay = 0;
    for (let day = 20_000; day < 20_180; day += 3) {
      for (let y = 0; y < FISHING_CONFIG.height; y++) {
        for (let x = 0; x < FISHING_CONFIG.width; x++) {
          const before = gatherableAt(FISHING_CONFIG, x, y, day, true, true);
          const after = gatherableAt(FISHING_CONFIG, x, y, day, true, true, 1, true);
          const biome = biomeAt(FISHING_CONFIG, x, y);
          if (before !== null && after !== before) wrong.push(`${x},${y} on ${day}: ${before}`);
          if (after === "clay" && biome !== "meadow" && biome !== "sand") wrong.push(`${biome}`);
          // With finds out or not, clay never lies where a find would.
          const findsOff = gatherableAt(FISHING_CONFIG, x, y, day, false, false, 1, true);
          if (findsOff === "clay" && after !== "clay") wrong.push(`${x},${y} on ${day} moved`);
          if (before === null && (biome === "meadow" || biome === "sand")) {
            bare += 1;
            if (after === "clay") clay += 1;
          }
        }
      }
    }
    expect(wrong).toEqual([]);
    // About a quarter of bare meadow and sand holds clay on a day.
    expect(clay / bare).toBeGreaterThan(POTTERY.clayChance - 0.03);
    expect(clay / bare).toBeLessThan(POTTERY.clayChance + 0.03);
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

describe("a kiln", () => {
  it("costs four stone, and gives them back to whoever takes it up", () => {
    const state = town();
    stock(state, "ada", { stone: POTTERY.kilnStone - 1 });
    refused(state, "ada", { type: "place", ...KILN_AT, block: "kiln" }, "not_enough_items");
    stock(state, "ada", { stone: 1 });
    ok(state, "ada", { type: "place", ...KILN_AT, block: "kiln" });
    expect(held(state, "ada", "stone")).toBe(0);
    ok(state, "ada", { type: "remove", ...KILN_AT });
    expect(held(state, "ada", "stone")).toBe(POTTERY.kilnStone);
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
