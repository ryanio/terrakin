import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { edgeAt } from "./edges";
import { CLEAR_BLOCK_CONFIG, CLEAR_BLOCK_HASH, CLEAR_BLOCK_LOG } from "./fixtures/clear-block-log";
import { hashWorld } from "./hash";
import { held, ITEMS } from "./items";
import { tileKey } from "./keys";
import { replay } from "./replay";
import { stock } from "./test-support";
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
 * `clear_block` (decision 0343): staff take one block off a plot to open a home nobody can walk
 * out of. What matters is that the owner loses nothing they couldn't get back by taking the block
 * up themselves, that staff can never do what the owner's own `remove` would refuse, and that a
 * refusal leaves the world as it was.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

function ok(state: WorldState, actor: string, command: Command): WorldEvent[] {
  const result = apply(state, { actor, command });
  if (!result.ok)
    throw new Error(`${actor} ${JSON.stringify(command)}: ${result.rejection.message}`);
  return result.events;
}

function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
}

/** Ada in her starter hut on plot (0, 0), walls from (1, 1) to (5, 5), hearth at (3, 3). */
function town(): WorldState {
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
  ok(state, "ada", { type: "build_starter_home" });
  return state;
}

const clear = (x: number, y: number): Command => ({ type: "clear_block", x, y });

describe("staff clearing a block off a plot", () => {
  it("takes a free wall away and gives nothing back, since it cost nothing", () => {
    const state = town();
    expect(state.blocks[tileKey(1, 1)]).toBeDefined();
    const things = JSON.stringify(state.items?.inventories.ada);
    expect(ok(state, TOWN_ACTOR, clear(1, 1))).toEqual([
      { type: "block_removed", x: 1, y: 1, by: TOWN_ACTOR },
    ]);
    expect(state.blocks[tileKey(1, 1)]).toBeUndefined();
    expect(JSON.stringify(state.items?.inventories.ada)).toBe(things);
  });

  it("gives a held block back to the plot's owner, not to whoever is near", () => {
    const state = town();
    stock(state, "ada", { chair: 1 });
    ok(state, "ada", { type: "place", x: 2, y: 2, block: "chair" });
    expect(state.items?.inventories.ada?.stacks.chair ?? 0).toBe(0);
    const events = ok(state, TOWN_ACTOR, clear(2, 2));
    expect(events[0]).toEqual({ type: "block_removed", x: 2, y: 2, by: TOWN_ACTOR });
    expect(events[1]).toMatchObject({ type: "inventory", residentId: "ada" });
    expect(state.items?.inventories.ada?.stacks.chair).toBe(1);
  });

  it("refuses what the owner's own remove would, and leaves the world as it was", () => {
    const state = town();
    refused(state, TOWN_ACTOR, clear(99, 99), "out_of_bounds");
    // Plot (1, 1) is nobody's.
    refused(state, TOWN_ACTOR, clear(12, 12), "no_plot");
    // The hearth's own tile holds no block.
    refused(state, TOWN_ACTOR, clear(3, 3), "no_block");
    // An owner with no room for what comes back keeps their block.
    stock(state, "ada", { chair: 1 });
    ok(state, "ada", { type: "place", x: 2, y: 2, block: "chair" });
    stock(state, "ada", { wood: ITEMS.inventoryMax });
    refused(state, TOWN_ACTOR, clear(2, 2), "inventory_full");
  });

  it("is staff's alone: a resident sending it is refused", () => {
    const state = town();
    refused(state, "ada", clear(1, 1), "server_only");
  });

  it("with a side, takes the wall on that line instead of the block, back to the owner as her own remove would", () => {
    const state = town();
    stock(state, "ada", { plaster: 1, mirror: 1 });
    // A plaster line inside the hut, east of the hearth, with a mirror hung facing the hearth.
    ok(state, "ada", { type: "place", x: 3, y: 3, side: "e", block: "plaster" });
    ok(state, "ada", { type: "hang", x: 3, y: 3, side: "e", item: "mirror" });
    // A line on the inside of the hut's north wall, which also has a block on its tile.
    ok(state, "ada", { type: "place", x: 2, y: 2, side: "n", block: "wood" });
    expect(held(state.items?.inventories.ada, "plaster")).toBe(0);
    expect(held(state.items?.inventories.ada, "mirror")).toBe(0);

    const events = ok(state, TOWN_ACTOR, { type: "clear_block", x: 3, y: 3, side: "e" });
    expect(events[0]).toEqual({ type: "edge_removed", x: 4, y: 3, side: "w", by: TOWN_ACTOR });
    expect(events).toContainEqual({ type: "unhung", x: 3, y: 3, side: "e", by: TOWN_ACTOR });
    expect(edgeAt(state, 3, 3, "e")).toBeUndefined();
    expect(held(state.items?.inventories.ada, "plaster")).toBe(1);
    expect(held(state.items?.inventories.ada, "mirror")).toBe(1);

    // The side picks the line; without one, the block on the tile.
    ok(state, TOWN_ACTOR, { type: "clear_block", x: 2, y: 1, side: "s" });
    expect(edgeAt(state, 2, 2, "n")).toBeUndefined();
    expect(state.blocks[tileKey(2, 1)]).toBeDefined();
    ok(state, TOWN_ACTOR, clear(2, 1));
    expect(state.blocks[tileKey(2, 1)]).toBeUndefined();
  });

  it("with a side, refuses what the owner's own remove of that line would", () => {
    const state = town();
    // No line stands there, and a side that isn't one.
    refused(state, TOWN_ACTOR, { type: "clear_block", x: 3, y: 3, side: "s" }, "no_block");
    refused(
      state,
      TOWN_ACTOR,
      { type: "clear_block", x: 3, y: 3, side: "up" as never },
      "out_of_bounds",
    );
    // A line holding up the flooring above it stays until the flooring is lifted. Bob's plot
    // (2, 0) is bare, so that line is all that holds his upstairs.
    ok(state, "bob", { type: "join", name: "bob", kind: "human" });
    ok(state, "bob", { type: "settle", px: 2, py: 0 });
    const plot = state.plots["2,0"];
    const bob = state.residents.bob;
    if (!plot || !bob) throw new Error("no bob");
    plot.floors = 1;
    state.floors = { "1": { blocks: {}, ground: {} } };
    bob.x = 18;
    bob.y = 3;
    ok(state, "bob", { type: "place", x: 18, y: 3, side: "n", block: "stone" });
    stock(state, "bob", { wood: 1 });
    ok(state, "bob", { type: "lay", x: 18, y: 3, floor: 1, ground: "planks" });
    refused(state, TOWN_ACTOR, { type: "clear_block", x: 18, y: 3, side: "n" }, "holds_up");
    // An owner with no room for what the line gives back keeps it.
    stock(state, "ada", { plaster: 1 });
    ok(state, "ada", { type: "place", x: 6, y: 6, side: "w", block: "plaster" });
    stock(state, "ada", { wood: ITEMS.inventoryMax });
    refused(state, TOWN_ACTOR, { type: "clear_block", x: 6, y: 6, side: "w" }, "inventory_full");
  });

  it("replays its fixture to the hash pinned when it landed, with both blocks back in Ada's things", () => {
    const state = replay(CLEAR_BLOCK_CONFIG, CLEAR_BLOCK_LOG);
    expect(hashWorld(state)).toBe(CLEAR_BLOCK_HASH);
    expect(state.items?.inventories.ada?.stacks).toMatchObject({ lamp_post: 1, stone_wall: 1 });
  });
});
