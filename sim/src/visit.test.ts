import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { VISIT_CONFIG, VISIT_HASH, VISIT_LOG } from "./fixtures/visit-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import type { Command, RejectionCode, WorldConfig, WorldState } from "./types";
import { visitTile } from "./visit";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles, the live world's plot size. The Commons is plot (1, 1).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

function run(state: WorldState, actor: string, command: Command) {
  const result = apply(state, { actor, command });
  expect(result.ok, `${actor} ${JSON.stringify(command)}`).toBe(true);
  return result;
}

/**
 * Ada has the starter hut on plot (0, 0): walls on x 1 to 5 and y 1 to 5, her hearth at (3, 3),
 * the doorway at (3, 5). Bob has the same on plot (2, 0), hearth (19, 3). Cy is in the Commons.
 */
function town(...others: string[]): WorldState {
  const state = createWorld(CONFIG);
  for (const id of ["ada", "bob", "cy", ...others]) {
    run(state, id, { type: "join", name: id, kind: "human" });
  }
  run(state, "ada", { type: "settle", px: 0, py: 0 });
  run(state, "ada", { type: "build_starter_home" });
  run(state, "bob", { type: "settle", px: 2, py: 0 });
  run(state, "bob", { type: "build_starter_home" });
  return state;
}

/** A visit as the server sends it: with the planner's tile filled in. */
function visit(state: WorldState, actor: string, px: number, py: number) {
  const tile = visitTile(state, actor, px, py);
  return apply(state, { actor, command: { type: "visit", px, py, ...tile } });
}

describe("visit lands at the door", () => {
  it("jumps to the plot's edge in front of a starter hut's doorway, in one move", () => {
    const state = town();
    expect(visit(state, "cy", 0, 0)).toEqual({
      ok: true,
      seq: state.seq,
      events: [{ type: "moved", residentId: "cy", x: 3, y: 7 }],
    });
  });

  it("lands beside whoever already stands at the door", () => {
    const state = town();
    run(state, "cy", { type: "visit", px: 0, py: 0, x: 3, y: 7 });
    expect(visit(state, "bob", 0, 0)).toMatchObject({
      ok: true,
      events: [{ type: "moved", residentId: "bob", x: 2, y: 7 }],
    });
  });

  it("goes a ring in when the edge is built over, never onto a hearth or someone standing there", () => {
    // Plots of 4: Ada settles plot (0, 0) and lands on (1, 1), its center.
    const state = createWorld({ ...CONFIG, width: 12, height: 12, plotSize: 4 });
    for (const id of ["ada", "bob"]) run(state, id, { type: "join", name: id, kind: "human" });
    run(state, "ada", { type: "settle", px: 0, py: 0 });
    for (let i = 0; i < 4; i++) {
      for (const [x, y] of [
        [i, 0],
        [i, 3],
        [0, i],
        [3, i],
      ] as const) {
        if (!state.blocks[`${x},${y}`]) run(state, "ada", { type: "place", x, y, block: "wood" });
      }
    }
    run(state, "ada", { type: "set_hearth", x: 2, y: 1 });
    // Ada stands on (1, 1) and her hearth is (2, 1): of the inner tiles that leaves (1, 2) and
    // (2, 2), and (2, 2) is the nearer to her hearth.
    expect(visitTile(state, "bob", 0, 0)).toEqual({ x: 2, y: 2 });
  });
});

describe("visit refusals", () => {
  /** Dan shares Ada's plot and has no hearth. Bob has already visited Ada's plot, at (3, 7). */
  function world(): WorldState {
    const state = town("dan");
    run(state, "ada", { type: "share_plot", with: "dan" });
    run(state, "bob", { type: "visit", px: 0, py: 0, x: 3, y: 7 });
    return state;
  }

  const cases: [string, Command, RejectionCode, string][] = [
    ["cy", { type: "visit", px: 3, py: 0 }, "out_of_bounds", "That plot is outside the world."],
    [
      "cy",
      { type: "visit", px: 1, py: 1 },
      "plot_is_commons",
      "The Commons belongs to everyone, so it isn't a plot to visit. It's the plot in the middle: walk there.",
    ],
    [
      "cy",
      { type: "visit", px: 0, py: 2 },
      "plot_unclaimed",
      "Nobody lives on that plot yet. Try visit at px 0, py 0, the nearest plot someone lives on. Or make it yours: try settle at px 0, py 2.",
    ],
    [
      "bob",
      { type: "visit", px: 2, py: 2 },
      "plot_unclaimed",
      "Nobody lives on that plot yet. Try visit at px 0, py 0, the nearest plot someone lives on.",
    ],
    [
      "ada",
      { type: "visit", px: 0, py: 0 },
      "own_plot",
      "That's your own plot. Try home to jump to your hearth.",
    ],
    [
      "dan",
      { type: "visit", px: 0, py: 0 },
      "own_plot",
      "That plot is shared with you. Try build_starter_home, which sets a hearth, and then home.",
    ],
    ["bob", { type: "visit", px: 0, py: 0 }, "already_there", "You're already on that plot."],
    [
      "cy",
      { type: "visit", px: 2, py: 0 },
      "nowhere_to_go",
      "Every tile on that plot is taken right now. Try again in a moment, or visit another plot.",
    ],
    [
      "cy",
      { type: "visit", px: 2, py: 0, x: 3, y: 6 },
      "out_of_bounds",
      "That tile isn't on the plot.",
    ],
    ["cy", { type: "visit", px: 2, py: 0, x: 17, y: 1 }, "blocked", "A block is in the way."],
    [
      "cy",
      { type: "visit", px: 2, py: 0, x: 19, y: 3 },
      "tile_occupied",
      "That's someone's hearth. Keep it clear.",
    ],
    [
      "cy",
      { type: "visit", px: 0, py: 0, x: 3, y: 7 },
      "tile_occupied",
      "Someone is standing there.",
    ],
  ];

  it.each(cases)("%s %j is %s, and changes nothing", (actor, command, code, message) => {
    const state = world();
    const before = hashWorld(state);
    expect(apply(state, { actor, command })).toEqual({ ok: false, rejection: { code, message } });
    expect(hashWorld(state)).toBe(before);
  });
});

describe("the visit log", () => {
  it("replays to the pinned hash", () => {
    expect(hashWorld(replay(VISIT_CONFIG, VISIT_LOG))).toBe(VISIT_HASH);
  });
});
