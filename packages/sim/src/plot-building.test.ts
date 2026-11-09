import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import {
  PLOT_BUILDING_CONFIG,
  PLOT_BUILDING_HASH,
  PLOT_BUILDING_LOG,
} from "./fixtures/plot-building-log";
import { hashWorld } from "./hash";
import { plotReachOk } from "./plot-building";
import { replay } from "./replay";
import { stock } from "./test-support";
import { type Command, type Rejection, TOWN_ACTOR, type WorldEvent } from "./types";
import { createWorld } from "./world";

/**
 * Ada settles plot (0, 0) and builds the starter hut, from walls between tiles round (1, 1) to
 * (5, 5), with her hearth at (3, 3), where she stands. Every refusal is checked to leave the state
 * byte-identical.
 */
function world() {
  const state = createWorld(PLOT_BUILDING_CONFIG);
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
  ok(TOWN_ACTOR, { type: "starter_edges" });
  ok("ada", { type: "join", name: "ada", kind: "human" });
  ok("ada", { type: "settle", px: 0, py: 0 });
  ok("ada", { type: "build_starter_home" });
  stock(state, "ada", { armchair: 2, wood: 4 });
  return { state, ok, refused };
}

describe("building reaches the whole plot (plot_reach)", () => {
  it("refuses a far corner of your plot before the switch and places it after", () => {
    const w = world();
    // (7, 7) is 4 tiles from the hearth at (3, 3), one past reach.
    const far: Command = { type: "place", x: 7, y: 7, block: "armchair" };
    expect(w.refused("ada", far).code).toBe("out_of_reach");
    w.ok(TOWN_ACTOR, { type: "plot_reach" });
    w.ok("ada", far);
    w.ok("ada", { type: "remove", x: 7, y: 7 });
    w.ok("ada", { type: "lay", x: 0, y: 7, ground: "dirt" });
    expect(w.refused(TOWN_ACTOR, { type: "plot_reach" }).code).toBe("already_open");
  });

  it("still asks for a plot you build on, however near it is", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "plot_reach" });
    // Plot (1, 0) starts at x 8, within reach of nothing Ada owns.
    expect(w.refused("ada", { type: "place", x: 8, y: 3, block: "armchair" }).code).toBe(
      "out_of_reach",
    );
  });

  it("reaches a plot from on it or within reach of its nearest tile, and no farther", () => {
    const w = world();
    expect(plotReachOk(w.state, { x: 3, y: 3 }, { x: 7, y: 7 })).toBe(false);
    w.ok(TOWN_ACTOR, { type: "plot_reach" });
    const corner = { x: 7, y: 0 };
    expect(plotReachOk(w.state, { x: 0, y: 7 }, corner)).toBe(true);
    // Three tiles east of the plot's east edge (x 7) is in; four is out.
    expect(plotReachOk(w.state, { x: 10, y: 12 }, corner)).toBe(false);
    expect(plotReachOk(w.state, { x: 10, y: 10 }, corner)).toBe(true);
    expect(plotReachOk(w.state, { x: 11, y: 4 }, corner)).toBe(false);
  });
});

describe("walls only on lines (walls_on_lines)", () => {
  it("refuses a wall on a tile once logged, and takes it on a line", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "wood" });
    w.ok("ada", { type: "remove", x: 2, y: 2 });
    w.ok(TOWN_ACTOR, { type: "walls_on_lines" });
    for (const block of ["wood", "stone", "glass", "leaf", "door"] as const) {
      expect(w.refused("ada", { type: "place", x: 2, y: 2, block }).code).toBe("needs_side");
    }
    w.ok("ada", { type: "place", x: 2, y: 2, side: "n", block: "wood" });
    // Furniture still stands on a tile.
    w.ok("ada", { type: "place", x: 4, y: 2, block: "armchair" });
  });

  it("refuses a plan that puts a wall in blocks, and takes one in edges", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "walls_on_lines" });
    const refusal = w.refused("ada", {
      type: "build",
      px: 0,
      py: 0,
      blocks: [{ x: 2, y: 2, block: "wood" }],
    });
    expect(refusal.code).toBe("needs_side");
    expect(refusal.message).toContain("edges");
    w.ok("ada", {
      type: "build",
      px: 0,
      py: 0,
      edges: [{ x: 2, y: 2, side: "n", block: "wood" }],
    });
  });

  it("still takes down a wall block placed before the switch", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "wood" });
    w.ok(TOWN_ACTOR, { type: "walls_on_lines" });
    w.ok("ada", { type: "remove", x: 2, y: 2 });
  });
});

describe("the plot-building log", () => {
  it("replays to its pinned hash", () => {
    expect(hashWorld(replay(PLOT_BUILDING_CONFIG, PLOT_BUILDING_LOG))).toBe(PLOT_BUILDING_HASH);
  });
});
