import type { WorldSnapshot } from "@terrakin/protocol";
import { route, stepFrom } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { type Cutaway, cutaway, pickedFloor, tapFloor, tileShows, underFlooring } from "./floors";
import { Mirror } from "./mirror";

/**
 * Plots of 4 tiles. Ada's plot (0, 0) has a loft: flooring upstairs at (1, 1) and (2, 1), and a
 * window upstairs at (1, 2) standing on the wall below it. Bea's plot (1, 0) has flooring upstairs
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
    { px: 0, py: 0, ownerId: "ada", floors: 1 },
    { px: 1, py: 0, ownerId: "bea", floors: 1 },
  ],
  blocks: [
    { x: 1, y: 2, block: "wood" },
    { x: 1, y: 2, floor: 1, block: "glass" },
  ],
  ground: [
    { x: 1, y: 1, floor: 1, ground: "planks" },
    { x: 2, y: 1, floor: 1, ground: "planks" },
    { x: 5, y: 1, floor: 1, ground: "moss" },
  ],
};
const layers = new Mirror(world).layers();
const at = (cut: Cutaway | undefined, x: number, y: number) => tileShows(layers, 4, cut, x, y);

describe("which floor each tile shows", () => {
  it("shows every plot from above to someone who isn't on one", () => {
    expect(at(undefined, 1, 1)).toEqual({ top: 1, dim: false, overhead: false });
    expect(at(undefined, 1, 2)).toEqual({ top: 1, dim: false, overhead: false });
    expect(at(undefined, 0, 0)).toEqual({ top: 0, dim: false, overhead: false });
    expect(at(undefined, 5, 1)).toEqual({ top: 1, dim: false, overhead: false });
  });

  it("cuts the plot you stand on away above your floor, to an outline of its flooring", () => {
    const below: Cutaway = { px: 0, py: 0, floor: 0 };
    expect(at(below, 1, 1)).toEqual({ top: 0, dim: false, overhead: true });
    // A window upstairs is cut away too, with no flooring to outline.
    expect(at(below, 1, 2)).toEqual({ top: 0, dim: false, overhead: false });
    // Next door is from above.
    expect(at(below, 5, 1)).toEqual({ top: 1, dim: false, overhead: false });
  });

  it("shows your floor upstairs, and what's below it dimmed where it has no flooring", () => {
    const up: Cutaway = { px: 0, py: 0, floor: 1 };
    expect(at(up, 1, 1)).toEqual({ top: 1, dim: false, overhead: false });
    expect(at(up, 0, 0)).toEqual({ top: 0, dim: true, overhead: false });
    expect(at(up, 1, 2)).toEqual({ top: 1, dim: true, overhead: false });
  });

  it("fades a figure under what a tile shows, and never one the cut leaves in view", () => {
    const below: Cutaway = { px: 0, py: 0, floor: 0 };
    // Under Ada's loft, seen from her own ground floor: in plain view.
    expect(underFlooring(layers, 4, below, 1, 1, 0)).toBe(false);
    // Under Bea's flooring next door, or under Ada's seen from upstairs or from off the plot: faded.
    expect(underFlooring(layers, 4, below, 5, 1, 0)).toBe(true);
    expect(underFlooring(layers, 4, { ...below, floor: 1 }, 1, 1, 0)).toBe(true);
    expect(underFlooring(layers, 4, undefined, 1, 1, 0)).toBe(true);
    // Someone on the flooring itself, or out in the open.
    expect(underFlooring(layers, 4, undefined, 1, 1, 1)).toBe(false);
    expect(underFlooring(layers, 4, undefined, 0, 0, 0)).toBe(false);
  });
});

describe("where the map and the 3D world cut, and the floor the build bar builds on", () => {
  it("cuts the plot under you at the build bar's floor while building, else at yours", () => {
    const ada = { x: 5, y: 2, floor: 1 };
    expect(cutaway(ada, 4)).toEqual({ px: 1, py: 0, floor: 1 });
    // Ground floor picked while she stands upstairs: both views cut there, not at her feet.
    expect(cutaway(ada, 4, 0)).toEqual({ px: 1, py: 0, floor: 0 });
    expect(cutaway({ x: 1, y: 1 }, 4, 1)).toEqual({ px: 0, py: 0, floor: 1 });
    expect(cutaway(undefined, 4, 1)).toBeUndefined();
  });

  it("never builds on, or cuts at, a floor the plot doesn't have", () => {
    // Upstairs picked, then onto a plot of hers with no floor: its ground floor.
    expect(pickedFloor(1, 0, 0)).toBe(0);
    expect(pickedFloor(1, 1, 0)).toBe(1);
    expect(pickedFloor(0, 1, 1)).toBe(0);
    // On a neighbor's loft she can't build on: the floor she stands on.
    expect(pickedFloor(0, undefined, 1)).toBe(1);
    expect(pickedFloor(1, undefined, 0)).toBe(0);
  });
});

describe("what a tap means, and where a walk goes, on a floor", () => {
  /** Ada's plot again, with stairs on the ground floor at (2, 2) coming up through an open tile. */
  const stairs = new Mirror({
    ...world,
    blocks: [...world.blocks, { x: 2, y: 2, block: "stairs" }],
  });
  const under = (s: number, x: number, y: number) =>
    stairs.blocksOn(s - 1).get(`${x},${y}`) === "stairs";
  const tap = (cut: Cutaway | undefined, x: number, y: number) =>
    tapFloor(stairs.layers(), 4, cut, x, y, under);

  it("means the floor the map draws there, and the top of the stairs is upstairs", () => {
    const up: Cutaway = { px: 0, py: 0, floor: 1 };
    // Upstairs: the loft's flooring is yours, an open tile is the ground floor showing through.
    expect(tap(up, 1, 1)).toBe(1);
    expect(tap(up, 0, 0)).toBe(0);
    expect(tap(up, 2, 2)).toBe(1);
    // On the ground floor your own plot is all ground floor; next door's loft is upstairs.
    const below: Cutaway = { px: 0, py: 0, floor: 0 };
    expect(tap(below, 1, 1)).toBe(0);
    expect(tap(below, 5, 1)).toBe(1);
  });

  it("walks each floor on its own ground, by the sim's rule", () => {
    // Stairs are the one block you walk onto.
    expect(stepFrom(stairs.ground(0), { x: 2, y: 1 }, "s")).toMatchObject({ ok: true });
    expect(stepFrom(stairs.ground(0), { x: 1, y: 1 }, "s")).toMatchObject({ code: "blocked" });
    // Upstairs: along the flooring and onto the top of the stairs, but never off an edge.
    expect(stepFrom(stairs.ground(1), { x: 1, y: 1 }, "e")).toMatchObject({ ok: true });
    expect(stepFrom(stairs.ground(1), { x: 2, y: 1 }, "s")).toMatchObject({ ok: true });
    expect(stepFrom(stairs.ground(1), { x: 2, y: 1 }, "e")).toEqual({
      ok: false,
      code: "blocked",
      message: "There's no flooring there.",
      obstacle: "no_flooring",
    });
    // A route upstairs keeps to the flooring: none reaches the ground floor's open tiles.
    expect(route(stairs.ground(1), { x: 1, y: 1 }, { x: 0, y: 0 })).toEqual([]);
  });
});
