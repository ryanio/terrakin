import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { SURFACES_CONFIG, SURFACES_HASH, SURFACES_LOG } from "./fixtures/surfaces-log";
import { hashWorld } from "./hash";
import { held, inventoryMaxOf, inventorySize } from "./items";
import { replay } from "./replay";
import { faceKey, hungAt, SURFACE_BLOCKS, topAt } from "./surfaces";
import { stock } from "./test-support";
import {
  type Command,
  type Rejection,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. Ada settles plot (0, 0) and builds the starter hut: walls from (1, 1) to
// (5, 5), glass at (1, 3) and (5, 3), the doorway at (3, 5), her hearth at (3, 3), where she
// stands. Bob settles plot (2, 0).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** A world where every refusal is checked to leave the state byte-identical. */
function world() {
  const state = createWorld(CONFIG);
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const refused = (actor: string, command: Command): Rejection => {
    const result = send(actor, command);
    expect(result.ok, `${actor} ${JSON.stringify(command)} should be refused`).toBe(false);
    return result.ok ? { code: "internal" as never, message: "" } : result.rejection;
  };
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  ok(TOWN_ACTOR, { type: "open_items" });
  for (const [name, px] of [
    ["ada", 0],
    ["bob", 2],
  ] as const) {
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py: 0 });
  }
  ok("ada", { type: "build_starter_home" });
  stock(state, "ada", {
    table: 1,
    chair: 1,
    desk: 1,
    candle: 2,
    wall_clock: 1,
    mirror: 1,
    seashell: 1,
  });
  const stack = (kind: Parameters<typeof held>[1]) => held(state.items?.inventories.ada, kind);
  return { state, ok, refused, stack };
}

describe("surfaces", () => {
  it("are the furniture that holds a thing on top", () => {
    expect([...SURFACE_BLOCKS]).toEqual([
      "table",
      "bookshelf",
      "barrel",
      "kitchen",
      "desk",
      "side_table",
      "dresser",
      "coffee_table",
    ]);
  });

  it("hold one small thing, which goes back to whoever put it there", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "table" });
    const events = w.ok("ada", { type: "put_on", x: 2, y: 2, item: "candle" });
    expect(events).toContainEqual({ type: "put_on", x: 2, y: 2, thing: "candle", by: "ada" });
    expect(w.stack("candle")).toBe(1);
    expect(topAt(w.state, 2, 2)).toEqual({ thing: "candle", by: "ada", day: 20_000 });

    expect(w.refused("ada", { type: "put_on", x: 2, y: 2, item: "candle" }).code).toBe(
      "tile_occupied",
    );
    // The table can't come up with a candle on it, by hand or in a plan.
    expect(w.refused("ada", { type: "remove", x: 2, y: 2 }).code).toBe("tile_occupied");
    const plan = w.ok("ada", {
      type: "build",
      px: 0,
      py: 0,
      remove: [{ x: 2, y: 2 }],
      blocks: [{ x: 4, y: 2, block: "chair" }],
    });
    expect(plan.some((e) => e.type === "block_removed")).toBe(false);

    expect(w.ok("ada", { type: "take_off", x: 2, y: 2 })).toContainEqual({
      type: "taken_off",
      x: 2,
      y: 2,
      by: "ada",
    });
    expect(w.stack("candle")).toBe(2);
    expect(w.state.items?.tops).toBeUndefined();
    w.ok("ada", { type: "remove", x: 2, y: 2 });
    expect(w.stack("table")).toBe(1);
  });

  it("take a find by its kind, the same as a pedestal", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "desk" });
    expect(w.ok("ada", { type: "put_on", x: 2, y: 2, item: "seashell" })).toContainEqual({
      type: "put_on",
      x: 2,
      y: 2,
      find: "seashell",
      by: "ada",
    });
    expect(w.stack("seashell")).toBe(0);
  });

  it("refuse what isn't a surface, a wall thing, what you don't hold, and someone else's", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "chair" });
    w.ok("ada", { type: "place", x: 4, y: 2, block: "table" });
    expect(w.refused("ada", { type: "put_on", x: 2, y: 2, item: "candle" }).code).toBe(
      "not_a_surface",
    );
    expect(w.refused("ada", { type: "put_on", x: 2, y: 4, item: "candle" }).code).toBe(
      "not_a_surface",
    );
    expect(w.refused("ada", { type: "put_on", x: 4, y: 2, item: "wall_clock" }).code).toBe(
      "unknown_item",
    );
    expect(w.refused("ada", { type: "put_on", x: 4, y: 2, item: "globe" }).code).toBe(
      "not_enough_items",
    );
    expect(w.refused("ada", { type: "put_on", x: 4, y: 2, item: "wood" }).code).toBe(
      "unknown_item",
    );
    expect(w.refused("ada", { type: "take_off", x: 4, y: 2 }).code).toBe("nothing_displayed");
    expect(w.refused("bob", { type: "put_on", x: 4, y: 2, item: "candle" }).code).toBe(
      "out_of_reach",
    );
  });
});

describe("hanging", () => {
  it("puts a thing on a solid wall facing a tile you could stand on", () => {
    const w = world();
    const events = w.ok("ada", { type: "hang", x: 2, y: 2, side: "n", item: "wall_clock" });
    expect(events).toContainEqual({
      type: "hung",
      x: 2,
      y: 2,
      side: "n",
      thing: "wall_clock",
      by: "ada",
    });
    expect(hungAt(w.state, 2, 2, "n")).toEqual({ thing: "wall_clock", by: "ada", day: 20_000 });
    expect(w.stack("wall_clock")).toBe(0);
    // The same wall seen from its other face is another spot: (2, 0) is outside, facing south.
    expect(Object.keys(w.state.items?.hung ?? {})).toEqual([faceKey(2, 2, "n", 0)]);

    expect(w.refused("ada", { type: "hang", x: 2, y: 2, side: "n", item: "mirror" }).code).toBe(
      "tile_occupied",
    );
    expect(w.ok("ada", { type: "unhang", x: 2, y: 2, side: "n" })).toContainEqual({
      type: "unhung",
      x: 2,
      y: 2,
      side: "n",
      by: "ada",
    });
    expect(w.stack("wall_clock")).toBe(1);
    expect(w.state.items?.hung).toBeUndefined();
  });

  it("refuses glass, a doorway, a bad side, a tile with a block, and a surface thing", () => {
    const w = world();
    // (1, 3) is a window.
    expect(w.refused("ada", { type: "hang", x: 2, y: 3, side: "w", item: "mirror" }).code).toBe(
      "no_wall",
    );
    // (3, 5) is the open doorway.
    expect(w.refused("ada", { type: "hang", x: 3, y: 4, side: "s", item: "mirror" }).code).toBe(
      "no_wall",
    );
    expect(
      w.refused("ada", { type: "hang", x: 2, y: 2, side: "up" as never, item: "mirror" }).code,
    ).toBe("no_wall");
    w.ok("ada", { type: "place", x: 4, y: 2, block: "table" });
    expect(w.refused("ada", { type: "hang", x: 4, y: 2, side: "n", item: "mirror" }).code).toBe(
      "tile_occupied",
    );
    expect(w.refused("ada", { type: "hang", x: 2, y: 2, side: "n", item: "candle" }).code).toBe(
      "unknown_item",
    );
    expect(w.refused("ada", { type: "unhang", x: 2, y: 2, side: "n" }).code).toBe(
      "nothing_displayed",
    );
  });

  it("keeps the tile it faces open, and comes down with its wall", () => {
    const w = world();
    w.ok("ada", { type: "hang", x: 2, y: 2, side: "n", item: "wall_clock" });
    w.ok("ada", { type: "hang", x: 2, y: 2, side: "w", item: "mirror" });
    expect(w.refused("ada", { type: "place", x: 2, y: 2, block: "chair" }).code).toBe(
      "tile_occupied",
    );
    // A plan skips that tile rather than refusing.
    const planned = w.ok("ada", {
      type: "build",
      px: 0,
      py: 0,
      blocks: [
        { x: 2, y: 2, block: "chair" },
        { x: 4, y: 4, block: "chair" },
      ],
    });
    expect(planned).toContainEqual({ type: "block_placed", x: 4, y: 4, block: "chair", by: "ada" });
    expect(planned.some((e) => e.type === "block_placed" && e.x === 2)).toBe(false);

    // Taking the north wall down gives the clock back; the mirror on the west wall stays.
    const removed = w.ok("ada", { type: "remove", x: 2, y: 1 });
    expect(removed).toContainEqual({ type: "unhung", x: 2, y: 2, side: "n", by: "ada" });
    expect(w.stack("wall_clock")).toBe(1);
    expect(hungAt(w.state, 2, 2, "w")?.by).toBe("ada");

    // A plan that takes the west wall down does the same.
    const plan = w.ok("ada", { type: "build", px: 0, py: 0, remove: [{ x: 1, y: 2 }] });
    expect(plan).toContainEqual({ type: "unhung", x: 2, y: 2, side: "w", by: "ada" });
    expect(w.stack("mirror")).toBe(1);
    expect(w.state.items?.hung).toBeUndefined();
  });

  it("goes back to whoever hung it when the town clears its wall", () => {
    const w = world();
    w.ok("ada", { type: "hang", x: 2, y: 2, side: "n", item: "wall_clock" });
    const cleared = w.ok(TOWN_ACTOR, { type: "clear_block", x: 2, y: 1 });
    expect(cleared).toContainEqual({ type: "unhung", x: 2, y: 2, side: "n", by: TOWN_ACTOR });
    expect(w.stack("wall_clock")).toBe(1);
  });
});

describe("what the review found", () => {
  it("holds a hung thing aside, never past the cap, when a plan takes its wall down", () => {
    const w = world();
    stock(w.state, "ada", { plaster: 1 });
    w.ok("ada", { type: "place", x: 6, y: 3, block: "plaster" });
    w.ok("ada", { type: "hang", x: 6, y: 2, side: "s", item: "mirror" });
    // Fill her things to one short of the cap: the plaster coming back takes the last place.
    const max = inventoryMaxOf(w.state);
    stock(w.state, "ada", { seashell: max - 1 - inventorySize(w.state.items?.inventories.ada) });
    w.ok("ada", { type: "build", px: 0, py: 0, remove: [{ x: 6, y: 3 }] });
    expect(inventorySize(w.state.items?.inventories.ada)).toBe(max);
    expect(w.state.items?.heldAside).toEqual([{ thing: "mirror", by: "ada", day: 20_000 }]);
  });

  it("lets whoever put a thing there take it back once they can't build on the plot", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "table" });
    w.ok("ada", { type: "share_plot", with: "bob" });
    stock(w.state, "bob", { candle: 1 });
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("no bob");
    bob.x = 3;
    bob.y = 4;
    w.ok("bob", { type: "put_on", x: 2, y: 2, item: "candle" });
    w.ok("ada", { type: "unshare_plot", with: "bob" });
    w.ok("bob", { type: "take_off", x: 2, y: 2 });
    expect(held(w.state.items?.inventories.bob, "candle")).toBe(1);
    // Someone else's thing still needs the plot.
    w.ok("ada", { type: "put_on", x: 2, y: 2, item: "candle" });
    expect(w.refused("bob", { type: "take_off", x: 2, y: 2 }).code).toBe("not_your_plot");
  });

  it("keeps a starter home off a tile something hangs facing", () => {
    // Bob has no hut yet: his would have its west wall on x 17, from (17, 1) to (17, 5).
    const w = world();
    stock(w.state, "bob", { mirror: 1 });
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("no bob");
    bob.x = 18;
    bob.y = 3;
    w.ok("bob", { type: "place", x: 16, y: 2, block: "wood" });
    w.ok("bob", { type: "hang", x: 17, y: 2, side: "w", item: "mirror" });
    w.ok("bob", { type: "build_starter_home" });
    expect(w.state.blocks["17,1"]).toBe("wood");
    expect(w.state.blocks["17,2"]).toBeUndefined();
  });

  it("lets staff take a reported made thing off a surface, back to whoever put it there", () => {
    const w = world();
    w.ok("ada", { type: "make_piece", media: "m_0123456789abcdef", title: "Moss" });
    const piece = w.state.items?.inventories.ada?.goods[0];
    if (!piece) throw new Error("no piece");
    w.ok("ada", { type: "place", x: 2, y: 2, block: "table" });
    w.ok("ada", { type: "put_on", x: 2, y: 2, item: piece.id });
    const taken = w.ok(TOWN_ACTOR, { type: "remove_display", item: piece.id });
    expect(taken).toContainEqual({ type: "taken_off", x: 2, y: 2, by: TOWN_ACTOR });
    expect(w.state.items?.tops).toBeUndefined();
    expect(w.state.items?.inventories.ada?.goods.map((g) => g.id)).toContain(piece.id);
  });
});

describe("the surfaces log", () => {
  it("replays to its pinned hash", () => {
    expect(hashWorld(replay(SURFACES_CONFIG, SURFACES_LOG))).toBe(SURFACES_HASH);
  });
});
