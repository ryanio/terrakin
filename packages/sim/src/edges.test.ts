import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { edgeAt, edgeKey, edgeOf } from "./edges";
import { EDGES_CONFIG, EDGES_HASH, EDGES_LOG } from "./fixtures/edges-log";
import { hashWorld } from "./hash";
import { held } from "./items";
import { replay } from "./replay";
import { plotRoof } from "./roofs";
import { starterEdgeHut } from "./slim";
import { stock } from "./test-support";
import {
  type Command,
  type Rejection,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { stepFrom, worldGround } from "./walk";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. Ada settles plot (0, 0) and builds the starter hut of wall blocks: walls
// from (1, 1) to (5, 5), glass at (1, 3) and (5, 3), the doorway at (3, 5), her hearth at (3, 3).
// Bob settles plot (2, 0), tiles 16 to 23, and builds nothing; he's moved to (18, 3).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

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
  const bob = state.residents.bob;
  if (!bob) throw new Error("no bob");
  bob.x = 18;
  bob.y = 3;
  const step = (from: { x: number; y: number }, dir: Parameters<typeof stepFrom>[2]) =>
    stepFrom(worldGround(state), from, dir);
  return { state, ok, refused, step };
}

describe("walls between tiles", () => {
  it("go on a line in its one form, cost what a block costs, and stop a walker crossing", () => {
    const w = world();
    // The east side of (18, 3) is the west side of (19, 3).
    const events = w.ok("bob", { type: "place", x: 18, y: 3, side: "e", block: "wood" });
    expect(events).toEqual([
      { type: "edge_placed", x: 19, y: 3, side: "w", block: "wood", by: "bob" },
    ]);
    expect(edgeAt(w.state, 19, 3, "w")).toBe("wood");
    expect(edgeAt(w.state, 18, 3, "e")).toBe("wood");
    expect(w.state.blocks["19,3"]).toBeUndefined();
    // Straight across is refused; both tiles stay standable.
    expect(w.step({ x: 18, y: 3 }, "e")).toMatchObject({ ok: false, obstacle: "wall" });
    expect(w.step({ x: 19, y: 3 }, "w")).toMatchObject({ ok: false, obstacle: "wall" });
    expect(w.step({ x: 18, y: 3 }, "n")).toMatchObject({ ok: true });
    // A diagonal that cuts past the line is refused, as a block's corner is.
    expect(w.step({ x: 18, y: 3 }, "ne")).toMatchObject({ ok: false, obstacle: "wall" });
    expect(w.step({ x: 18, y: 2 }, "se")).toMatchObject({ ok: false, obstacle: "wall" });
  });

  it("let a walker through a door, and come down giving back what they cost", () => {
    const w = world();
    w.ok("bob", { type: "place", x: 18, y: 3, side: "e", block: "door" });
    expect(w.step({ x: 18, y: 3 }, "e")).toMatchObject({ ok: true });
    stock(w.state, "bob", { plaster: 1 });
    w.ok("bob", { type: "place", x: 18, y: 3, side: "s", block: "plaster" });
    expect(held(w.state.items?.inventories.bob, "plaster")).toBe(0);
    expect(w.ok("bob", { type: "remove", x: 18, y: 4, side: "n" })).toContainEqual({
      type: "edge_removed",
      x: 18,
      y: 4,
      side: "n",
      by: "bob",
    });
    expect(held(w.state.items?.inventories.bob, "plaster")).toBe(1);
    expect(w.state.edges).toEqual({ [edgeKey(19, 3, "w")]: "door" });
  });

  it("refuse a plot's own border, someone else's plot, a taken line, and what isn't a wall", () => {
    const w = world();
    // (16, 3)'s west side borders plot (1, 0), which nobody owns.
    Object.assign(w.state.residents.bob ?? {}, { x: 16, y: 3 });
    expect(w.refused("bob", { type: "place", x: 16, y: 3, side: "w", block: "wood" }).code).toBe(
      "plot_border",
    );
    expect(w.refused("bob", { type: "place", x: 16, y: 3, side: "s", block: "table" }).code).toBe(
      "unknown_item",
    );
    w.ok("bob", { type: "place", x: 16, y: 3, side: "s", block: "wood" });
    expect(w.refused("bob", { type: "place", x: 16, y: 4, side: "n", block: "stone" }).code).toBe(
      "tile_occupied",
    );
    expect(w.refused("bob", { type: "remove", x: 17, y: 3, side: "s" }).code).toBe("no_block");
    expect(
      w.refused("bob", { type: "place", x: 16, y: 3, side: "up" as never, block: "wood" }).code,
    ).toBe("out_of_bounds");
  });

  it("hold a hung thing, and give it back when they come down", () => {
    const w = world();
    stock(w.state, "bob", { mirror: 1 });
    w.ok("bob", { type: "place", x: 18, y: 3, side: "n", block: "stone" });
    w.ok("bob", { type: "hang", x: 18, y: 3, side: "n", item: "mirror" });
    const down = w.ok("bob", { type: "remove", x: 18, y: 3, side: "n" });
    expect(down).toContainEqual({ type: "unhung", x: 18, y: 3, side: "n", by: "bob" });
    expect(held(w.state.items?.inventories.bob, "mirror")).toBe(1);
    // A window holds nothing hung.
    w.ok("bob", { type: "place", x: 18, y: 3, side: "n", block: "glass" });
    expect(w.refused("bob", { type: "hang", x: 18, y: 3, side: "n", item: "mirror" }).code).toBe(
      "no_wall",
    );
  });

  it("go up and come down in a plan, which refuses a border and skips what's there", () => {
    const w = world();
    const built = w.ok("bob", {
      type: "build",
      px: 2,
      py: 0,
      edges: [
        { x: 2, y: 2, side: "n", block: "wood" },
        { x: 3, y: 2, side: "n", block: "wood" },
      ],
    });
    expect(built.filter((e) => e.type === "edge_placed")).toHaveLength(2);
    const changed = w.ok("bob", {
      type: "build",
      px: 2,
      py: 0,
      removeEdges: [{ x: 2, y: 1, side: "s" }],
      edges: [{ x: 3, y: 2, side: "n", block: "wood" }],
    });
    expect(changed).toContainEqual({ type: "edge_removed", x: 18, y: 2, side: "n", by: "bob" });
    expect(edgeAt(w.state, 19, 2, "n")).toBe("wood");
    expect(
      w.refused("bob", {
        type: "build",
        px: 2,
        py: 0,
        edges: [{ x: 0, y: 2, side: "w", block: "wood" }],
      }).code,
    ).toBe("plot_border");
  });
});

describe("a starter hut of walls between tiles", () => {
  it("comes from the starter_edges switch, with 25 tiles inside, a door, and a roof", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "starter_edges" });
    expect(w.refused(TOWN_ACTOR, { type: "starter_edges" }).code).toBe("already_open");
    const built = w.ok("bob", { type: "build_starter_home" });
    expect(built.filter((e) => e.type === "block_placed")).toEqual([]);
    expect(built.filter((e) => e.type === "edge_placed")).toHaveLength(20);
    expect(Object.keys(w.state.blocks).filter((k) => Number(k.split(",")[0]) >= 16)).toEqual([]);
    expect(w.state.residents.bob?.hearth).toEqual({ x: 19, y: 3 });
    // Out through the door on the south side's middle, and no way through the wall beside it.
    expect(w.step({ x: 19, y: 5 }, "s")).toMatchObject({ ok: true });
    expect(w.step({ x: 18, y: 5 }, "s")).toMatchObject({ ok: false, obstacle: "wall" });
    // A roof sits over the box the lines make: the 25 tiles inside.
    w.ok("bob", { type: "set_roof", px: 2, py: 0, style: "gable", material: "wood" });
    const roof = plotRoof(w.state, 2, 0);
    const inside = Array.from({ length: 25 }, (_, i) => `${17 + (i % 5)},${1 + Math.floor(i / 5)}`);
    expect(roof?.tiles.map((t) => `${t.x},${t.y}`).sort()).toEqual(inside.sort());
  });
});

describe("slim_walls", () => {
  it("turns a block hut into walls between tiles, and marks the plot", () => {
    const w = world();
    const ring = Object.keys(w.state.blocks).map((key) => {
      const [x, y] = key.split(",").map(Number) as [number, number];
      return { x, y };
    });
    const walls = starterEdgeHut(CONFIG, 0, 0, "wood", "glass").map((e) => ({
      x: e.x,
      y: e.y,
      side: e.side,
      block: e.block,
    }));
    const events = w.ok("ada", { type: "slim_walls", px: 0, py: 0, remove: ring, edges: walls });
    expect(events).toContainEqual({ type: "home_slimmed", px: 0, py: 0, by: "ada" });
    expect(w.state.blocks).toEqual({});
    expect(Object.keys(w.state.edges ?? {})).toHaveLength(20);
    expect(w.state.slimmed).toEqual({ "0,0": true });
  });

  it("tops up the made material its lines need on the plot's first slim only", () => {
    const w = world();
    stock(w.state, "bob", { plaster: 2 });
    w.ok("bob", { type: "place", x: 18, y: 2, block: "plaster" });
    w.ok("bob", { type: "place", x: 19, y: 2, block: "plaster" });
    const slim = (y: number): Command => ({
      type: "slim_walls",
      px: 2,
      py: 0,
      remove: [
        { x: 2, y },
        { x: 3, y },
      ],
      edges: [
        { x: 2, y, side: "n", block: "plaster" },
        { x: 3, y, side: "n", block: "plaster" },
        { x: 4, y, side: "n", block: "plaster" },
      ],
    });
    w.ok("bob", slim(2));
    expect(held(w.state.items?.inventories.bob, "plaster")).toBe(0);
    expect(Object.values(w.state.edges ?? {})).toEqual(["plaster", "plaster", "plaster"]);
    // A second slim on the plot pays its own way, and Bob has no plaster to pay with.
    stock(w.state, "bob", { plaster: 2 });
    w.ok("bob", { type: "place", x: 18, y: 5, block: "plaster" });
    w.ok("bob", { type: "place", x: 19, y: 5, block: "plaster" });
    expect(w.refused("bob", slim(5)).code).toBe("not_enough_items");
  });

  it("puts up nothing but walls", () => {
    const w = world();
    expect(
      w.refused("ada", {
        type: "slim_walls",
        px: 0,
        py: 0,
        remove: [],
        edges: [{ x: 1, y: 1, side: "n", block: "table" }],
      }).code,
    ).toBe("invalid_plan");
    expect(w.refused("bob", { type: "slim_walls", px: 0, py: 0, remove: [], edges: [] }).code).toBe(
      "not_your_plot",
    );
  });
});

describe("what the review found", () => {
  it("tops a plot up once for good, even after it's released and settled again", () => {
    const w = world();
    const slim = (): Command => ({
      type: "slim_walls",
      px: 2,
      py: 0,
      remove: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      edges: [
        { x: 2, y: 2, side: "n", block: "plaster" },
        { x: 3, y: 2, side: "n", block: "plaster" },
        { x: 4, y: 2, side: "n", block: "plaster" },
      ],
    });
    stock(w.state, "bob", { plaster: 2 });
    w.ok("bob", { type: "place", x: 18, y: 2, block: "plaster" });
    w.ok("bob", { type: "place", x: 19, y: 2, block: "plaster" });
    w.ok("bob", slim());
    // Take the lines down (3 plaster back), give the plot up, and settle it again.
    w.ok("bob", {
      type: "build",
      px: 2,
      py: 0,
      removeEdges: [
        { x: 2, y: 2, side: "n" },
        { x: 3, y: 2, side: "n" },
        { x: 4, y: 2, side: "n" },
      ],
    });
    w.ok("bob", { type: "release" });
    w.ok("bob", { type: "settle", px: 2, py: 0 });
    Object.assign(w.state.residents.bob ?? {}, { x: 18, y: 3 });
    w.ok("bob", { type: "place", x: 18, y: 2, block: "plaster" });
    w.ok("bob", { type: "place", x: 19, y: 2, block: "plaster" });
    expect(held(w.state.items?.inventories.bob, "plaster")).toBe(1);
    const again = w.ok("bob", slim());
    // No gift the second time: the third line comes out of Bob's own plaster.
    expect(again.some((e) => e.type === "home_slimmed")).toBe(false);
    expect(held(w.state.items?.inventories.bob, "plaster")).toBe(0);
  });

  it("tops up at most a quarter of what came back, so a shape can't be drawn to win more", () => {
    const w = world();
    stock(w.state, "bob", { plaster: 4 });
    for (const x of [18, 19, 20, 21]) w.ok("bob", { type: "place", x, y: 2, block: "plaster" });
    // Four blocks back, six lines up: the gift is one, so two are short.
    const refused = w.refused("bob", {
      type: "slim_walls",
      px: 2,
      py: 0,
      remove: [2, 3, 4, 5].map((x) => ({ x, y: 2 })),
      edges: [1, 2, 3, 4, 5, 6].map((x) => ({
        x,
        y: 2,
        side: "n" as const,
        block: "plaster" as const,
      })),
    });
    expect(refused.code).toBe("not_enough_items");
  });

  it("keep one line holding flooring up when a plan takes both, and the flooring under a line", () => {
    const w = world();
    // An upstairs on Bob's plot, held by two lines round (18, 3).
    const plot = w.state.plots["2,0"];
    if (!plot) throw new Error("no plot");
    plot.floors = 1;
    w.state.floors = { "1": { blocks: {}, ground: {} } };
    stock(w.state, "bob", { wood: 1 });
    w.ok("bob", { type: "place", x: 18, y: 3, side: "n", block: "stone" });
    w.ok("bob", { type: "place", x: 18, y: 3, side: "w", block: "stone" });
    w.ok("bob", { type: "lay", x: 18, y: 3, floor: 1, ground: "planks" });
    const plan = w.ok("bob", {
      type: "build",
      px: 2,
      py: 0,
      removeEdges: [
        { x: 2, y: 3, side: "n" },
        { x: 2, y: 3, side: "w" },
      ],
    });
    expect(plan.filter((e) => e.type === "edge_removed")).toHaveLength(1);
    // A line upstairs on that flooring keeps it down.
    w.ok("bob", { type: "place", x: 18, y: 3, side: "e", floor: 1, block: "wood" });
    expect(w.refused("bob", { type: "lift", x: 18, y: 3, floor: 1 }).code).toBe("holds_up");
    // And an upstairs home waits to be slimmed.
    expect(w.refused("bob", { type: "slim_walls", px: 2, py: 0, remove: [], edges: [] }).code).toBe(
      "holds_up",
    );
  });

  it("keep a plot from being released, and a way from crossing them", () => {
    const w = world();
    w.ok("bob", { type: "place", x: 18, y: 3, side: "e", block: "wood" });
    expect(w.refused("bob", { type: "release" }).code).toBe("plot_has_blocks");
    expect(
      w.refused(TOWN_ACTOR, {
        type: "open_way",
        tiles: [
          [18, 3],
          [19, 3],
        ],
      }).code,
    ).toBe("tile_occupied");
    w.ok(TOWN_ACTOR, {
      type: "open_way",
      tiles: [
        [18, 5],
        [19, 5],
      ],
    });
    expect(w.refused("bob", { type: "place", x: 18, y: 5, side: "e", block: "wood" }).code).toBe(
      "public_ground",
    );
  });

  it("build a starter hut of lines only from kinds that stand between tiles", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "starter_edges" });
    expect(w.refused("bob", { type: "build_starter_home", walls: "kitchen" }).code).toBe(
      "unknown_item",
    );
  });
});

describe("edgeOf", () => {
  it("keys every line once", () => {
    expect(edgeOf(4, 4, "s")).toEqual({ x: 4, y: 5, side: "n" });
    expect(edgeOf(4, 4, "e")).toEqual({ x: 5, y: 4, side: "w" });
    expect(edgeKey(4, 4, "s")).toBe(edgeKey(4, 5, "n"));
  });
});

describe("the edges log", () => {
  it("replays to its pinned hash", () => {
    expect(hashWorld(replay(EDGES_CONFIG, EDGES_LOG))).toBe(EDGES_HASH);
  });
});
