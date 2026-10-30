import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { RECIPE_NAMES } from "./catalog";
import { hashWorld } from "./hash";
import { blockNeeds, ITEMS, isHeldBlock } from "./items";
import { isMaterialKind, MATERIAL_KINDS, MATERIAL_RECIPES } from "./materials";
import { expectMaterialsHold, expectSupplyHolds, stock } from "./test-support";
import {
  BUILDING_BLOCKS,
  type Command,
  FREE_BLOCKS,
  MATERIAL_BLOCKS,
  type RejectionCode,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

/**
 * Made materials (RFC 0041): walls and windows made at a workbench from what you gather and find,
 * held and placed like furniture, so a home can look like somewhere rather than like every other
 * home. What these protect is the part that is easy to break by accident: that they cost what they
 * say, that the four free blocks stay free, that a material holds a floor up, and that none of it
 * is knowledge anyone has to buy.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

function ok(state: WorldState, actor: string, command: Command): WorldEvent[] {
  const result = expectMaterialsHold(state, () => apply(state, { actor, command }));
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

/** Ada at home on plot (0, 0) with a workbench beside her, in a world with items open. */
function town(): { state: WorldState; bench: { x: number; y: number } } {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day: 1 },
    { type: "open_economy" },
    { type: "open_items" },
  ] as Command[]) {
    ok(state, TOWN_ACTOR, command);
  }
  ok(state, "ada", { type: "join", name: "ada", kind: "human" });
  ok(state, "ada", { type: "settle", px: 0, py: 0 });
  const ada = state.residents.ada;
  if (!ada) throw new Error("no ada");
  const bench = { x: ada.x + 1, y: ada.y };
  stock(state, "ada", { wood: 20, stone: 40, driftwood: 9, sea_glass: 6 });
  ok(state, "ada", { type: "place", block: "workbench", ...bench });
  return { state, bench };
}

const craft = (recipe: string, at: { x: number; y: number }) =>
  ({ type: "craft", recipe, ...at }) as Command;

describe("what a made material is", () => {
  it("is a block you hold, like furniture, and never one of the free ones", () => {
    expect(MATERIAL_KINDS.length).toBeGreaterThan(0);
    for (const kind of MATERIAL_KINDS) {
      expect(isMaterialKind(kind)).toBe(true);
      // Held, so placing takes one of itself and taking it up gives it back.
      expect(isHeldBlock(kind), kind).toBe(true);
      expect(blockNeeds(kind), kind).toEqual([[kind, 1]]);
      // The four free blocks are untouched: nothing a newcomer builds got more expensive.
      expect(FREE_BLOCKS as readonly string[], kind).not.toContain(kind);
      expect(BUILDING_BLOCKS as readonly string[], kind).not.toContain(kind);
    }
    expect([...BUILDING_BLOCKS]).toEqual(["wood", "stone", "glass", "leaf"]);
  });

  it("is made at a workbench and never learned, so no card stands in front of a wall", () => {
    for (const kind of MATERIAL_KINDS) {
      expect(MATERIAL_RECIPES[kind].station, kind).toBe("workbench");
      // Several a craft: a day holds so many crafts, and a wall is far more tiles than that.
      const makes = MATERIAL_RECIPES[kind].makes ?? 1;
      expect(makes, kind).toBeGreaterThan(1);
      expect(makes * ITEMS.craftPerDay, kind).toBeGreaterThanOrEqual(64);
      // Not a recipe anyone learns (RFC 0024), so there is no card, page or lesson for it.
      expect(RECIPE_NAMES as readonly string[], kind).not.toContain(kind);
    }
  });
});

describe("making and placing one", () => {
  it("takes what the recipe says, makes several, and places into the wall", () => {
    const { state, bench } = town();
    const made = ok(state, "ada", craft("brickwork", bench));
    const inventory = made.find((e) => e.type === "inventory");
    expect(inventory).toMatchObject({
      residentId: "ada",
      reason: "craft",
      changes: expect.arrayContaining([
        { kind: "stone", amount: -2, count: 38 },
        { kind: "wood", amount: -1, count: 19 },
        { kind: "brickwork", amount: 4, count: 4 },
      ]),
    });

    // Placing one takes it from her things; taking it up hands it back.
    const ada = state.residents.ada;
    if (!ada) throw new Error("no ada");
    const at = { x: ada.x, y: ada.y - 1 };
    ok(state, "ada", { type: "place", block: "brickwork", ...at });
    expect(state.items?.inventories.ada?.stacks.brickwork).toBe(3);
    expect(state.blocks[`${at.x},${at.y}`]).toBe("brickwork");
    ok(state, "ada", { type: "remove", ...at });
    expect(state.items?.inventories.ada?.stacks.brickwork).toBe(4);
  });

  it("is refused with nothing to build from, and the world is untouched", () => {
    const { state, bench } = town();
    // Driftwood comes off the shore, so a material of it is refused inland until she has walked.
    const items = state.items;
    if (!items) throw new Error("no items");
    const inv = items.inventories.ada;
    if (!inv) throw new Error("no inventory");
    inv.stacks.driftwood = 1;
    refused(state, "ada", craft("driftwood_plank", bench), "not_enough_items");
    // And placing one she doesn't hold is refused the same way, naming the workbench.
    refused(state, "ada", { type: "place", block: "plaster", x: 1, y: 1 }, "not_enough_items");
  });

  it("takes no label, since it stacks with others like it", () => {
    const { state, bench } = town();
    refused(
      state,
      "ada",
      { ...craft("plaster", bench), label: "mine" } as Command,
      "invalid_label",
    );
  });
});

describe("a material as a wall", () => {
  it("holds up the flooring above it, as wood and stone do", () => {
    const { state, bench } = town();
    ok(state, "ada", craft("plaster", bench));
    const ada = state.residents.ada;
    if (!ada) throw new Error("no ada");
    // Pay for the upstairs, then wall a tile in plaster and floor the tile above it.
    const economy = state.economy;
    if (!economy) throw new Error("no economy");
    economy.coins.ada = (economy.coins.ada ?? 0) + 500;
    economy.minted += 500;
    ok(state, "ada", { type: "add_floor", px: 0, py: 0 });
    const at = { x: ada.x, y: ada.y - 1 };
    ok(state, "ada", { type: "place", block: "plaster", ...at });
    stock(state, "ada", { wood: 4 });
    ok(state, "ada", { type: "lay", ground: "planks", floor: 1, ...at });
    expect(state.floors?.["1"]?.ground?.[`${at.x},${at.y}`]).toBe("planks");
    // And it is now load-bearing: taking the wall away would drop the floor above it.
    refused(state, "ada", { type: "remove", ...at }, "holds_up");
  });

  it("lists every material as a block the world knows", () => {
    for (const kind of MATERIAL_BLOCKS) {
      expect(MATERIAL_KINDS as readonly string[]).toContain(kind);
    }
  });
});
