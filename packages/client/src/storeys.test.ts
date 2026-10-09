import type { WorldSnapshot } from "@terrakin/protocol";
import { route, stepFrom } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { Mirror } from "./mirror";
import { type Cutaway, tapStorey, tileShows, underFloor } from "./storeys";

/**
 * Plots of 4 tiles. Ada's plot (0, 0) has a loft: a floor upstairs at (1, 1) and (2, 1), and a
 * window upstairs at (1, 2) standing on the wall below it. Bea's plot (1, 0) has a floor upstairs
 * at (5, 1).
 */
const world: WorldSnapshot = {
  v: 1,
  seq: 3,
  hash: "x",
  time: { nowMs: 0, dayLengthMs: 600_000 },
  season: "summer",
  weather: "clear",
  timeOfDay: "day",
  townHall: [],
  config: { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
  commons: { px: 1, py: 1 },
  residents: [],
  plots: [
    { px: 0, py: 0, ownerId: "ada", storeys: 1 },
    { px: 1, py: 0, ownerId: "bea", storeys: 1 },
  ],
  blocks: [
    { x: 1, y: 2, block: "wood" },
    { x: 1, y: 2, storey: 1, block: "glass" },
  ],
  ground: [
    { x: 1, y: 1, storey: 1, ground: "planks" },
    { x: 2, y: 1, storey: 1, ground: "planks" },
    { x: 5, y: 1, storey: 1, ground: "moss" },
  ],
};
const layers = new Mirror(world).layers();
const at = (cut: Cutaway | undefined, x: number, y: number) => tileShows(layers, 4, cut, x, y);

describe("which storey each tile shows", () => {
  it("shows every plot from above to someone who isn't on one", () => {
    expect(at(undefined, 1, 1)).toEqual({ top: 1, dim: false, overhead: false });
    expect(at(undefined, 1, 2)).toEqual({ top: 1, dim: false, overhead: false });
    expect(at(undefined, 0, 0)).toEqual({ top: 0, dim: false, overhead: false });
    expect(at(undefined, 5, 1)).toEqual({ top: 1, dim: false, overhead: false });
  });

  it("cuts the plot you stand on away above your storey, to an outline of its floors", () => {
    const below: Cutaway = { px: 0, py: 0, storey: 0 };
    expect(at(below, 1, 1)).toEqual({ top: 0, dim: false, overhead: true });
    // A window upstairs is cut away too, with no floor to outline.
    expect(at(below, 1, 2)).toEqual({ top: 0, dim: false, overhead: false });
    // Next door is from above.
    expect(at(below, 5, 1)).toEqual({ top: 1, dim: false, overhead: false });
  });

  it("shows your storey upstairs, and what's below it dimmed where it has no floor", () => {
    const up: Cutaway = { px: 0, py: 0, storey: 1 };
    expect(at(up, 1, 1)).toEqual({ top: 1, dim: false, overhead: false });
    expect(at(up, 0, 0)).toEqual({ top: 0, dim: true, overhead: false });
    expect(at(up, 1, 2)).toEqual({ top: 1, dim: true, overhead: false });
  });

  it("fades a figure under what a tile shows, and never one the cut leaves in view", () => {
    const below: Cutaway = { px: 0, py: 0, storey: 0 };
    // Under Ada's loft, seen from her own ground floor: in plain view.
    expect(underFloor(layers, 4, below, 1, 1, 0)).toBe(false);
    // Under Bea's floor next door, or under Ada's seen from upstairs or from off the plot: faded.
    expect(underFloor(layers, 4, below, 5, 1, 0)).toBe(true);
    expect(underFloor(layers, 4, { ...below, storey: 1 }, 1, 1, 0)).toBe(true);
    expect(underFloor(layers, 4, undefined, 1, 1, 0)).toBe(true);
    // Someone on the floor itself, or out in the open.
    expect(underFloor(layers, 4, undefined, 1, 1, 1)).toBe(false);
    expect(underFloor(layers, 4, undefined, 0, 0, 0)).toBe(false);
  });
});

describe("what a tap means, and where a walk goes, on a storey", () => {
  /** Ada's plot again, with stairs on the ground floor at (2, 2) coming up through an open tile. */
  const stairs = new Mirror({
    ...world,
    blocks: [...world.blocks, { x: 2, y: 2, block: "stairs" }],
  });
  const under = (s: number, x: number, y: number) =>
    stairs.blocksOn(s - 1).get(`${x},${y}`) === "stairs";
  const tap = (cut: Cutaway | undefined, x: number, y: number) =>
    tapStorey(stairs.layers(), 4, cut, x, y, under);

  it("means the storey the map draws there, and the top of the stairs is upstairs", () => {
    const up: Cutaway = { px: 0, py: 0, storey: 1 };
    // Upstairs: the loft's floor is yours, an open tile is the ground floor showing through.
    expect(tap(up, 1, 1)).toBe(1);
    expect(tap(up, 0, 0)).toBe(0);
    expect(tap(up, 2, 2)).toBe(1);
    // On the ground floor your own plot is all ground floor; next door's loft is upstairs.
    const below: Cutaway = { px: 0, py: 0, storey: 0 };
    expect(tap(below, 1, 1)).toBe(0);
    expect(tap(below, 5, 1)).toBe(1);
  });

  it("walks each storey on its own ground, by the sim's rule", () => {
    // Stairs are the one block you walk onto.
    expect(stepFrom(stairs.ground(0), { x: 2, y: 1 }, "s")).toMatchObject({ ok: true });
    expect(stepFrom(stairs.ground(0), { x: 1, y: 1 }, "s")).toMatchObject({ code: "blocked" });
    // Upstairs: along the floor and onto the top of the stairs, but never off an edge.
    expect(stepFrom(stairs.ground(1), { x: 1, y: 1 }, "e")).toMatchObject({ ok: true });
    expect(stepFrom(stairs.ground(1), { x: 2, y: 1 }, "s")).toMatchObject({ ok: true });
    expect(stepFrom(stairs.ground(1), { x: 2, y: 1 }, "e")).toEqual({
      ok: false,
      code: "blocked",
      message: "There's no floor there.",
      obstacle: "no_floor",
    });
    // A route upstairs keeps to the floor: none reaches the ground floor's open tiles.
    expect(route(stairs.ground(1), { x: 1, y: 1 }, { x: 0, y: 0 })).toEqual([]);
  });
});
