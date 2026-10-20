import type { RoofShape } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { roofChoices, roofCover, roofLine, roofsShown } from "./roofs";

/**
 * Roofs on the map and in the picker (RFC 0041). Two things worth protecting: the plot you stand
 * on has its roof lifted away while every other home keeps its, which is the cutaway rule RFC 0028
 * shipped and the one way to look inside; and the picker's line, which has to say a free block is
 * free and a made material is 8 of it.
 */

const shape = (px: number, py: number): RoofShape => ({
  style: "gable",
  material: "wood",
  floor: 0,
  tiles: [
    { x: px * 8 + 1, y: py * 8 + 1, h: [0, 0, 1, 1] },
    { x: px * 8 + 2, y: py * 8 + 1, h: [0, 0, 1, 1] },
  ],
});

const roofAt = (px: number, py: number) => shape(px, py);

describe("which roofs the map draws", () => {
  it("lifts the roof off the plot you stand on and leaves every other home its own", () => {
    const keys = ["0,0", "1,0", "2,3"];
    expect(roofsShown(keys, roofAt, { px: 1, py: 0, floor: 0 }).map((r) => `${r.px},${r.py}`))
      // The plot you stand on is cut away whichever floor you're on, since a roof is above them all.
      .toEqual(["0,0", "2,3"]);
    expect(roofsShown(keys, roofAt, { px: 1, py: 0, floor: 1 }).map((r) => r.px)).toEqual([0, 2]);
    // Nobody to view from (a thumbnail, a photo) roofs every home.
    expect(roofsShown(keys, roofAt, undefined)).toHaveLength(3);
  });

  it("works out a roof only for the plots the view reaches", () => {
    const asked: string[] = [];
    const watched = (px: number, py: number) => {
      asked.push(`${px},${py}`);
      return roofAt(px, py);
    };
    roofsShown(["0,0", "9,9"], watched, undefined, (px) => px < 5);
    expect(asked).toEqual(["0,0"]);
  });

  it("leaves out a plot whose walls hold no roof, and draws them north to south", () => {
    const only = (px: number, py: number) => (px === 2 ? roofAt(px, py) : undefined);
    expect(
      roofsShown(["3,1", "2,0", "2,1"], only, undefined).map((r) => `${r.px},${r.py}`),
    ).toEqual(["2,0", "2,1"]);
  });

  it("says which tiles a drawn roof covers, so a figure under one is faded", () => {
    const shown = roofsShown(["0,0"], roofAt, undefined);
    expect([...roofCover(shown)]).toEqual(["1,1", "2,1"]);
    expect(roofCover([])).toEqual(new Set());
  });
});

describe("what the picker offers", () => {
  it("offers a free block for nothing and a made material for 8 of itself", () => {
    const choices = roofChoices(new Map([["plaster", 3]]));
    const wood = choices.find((c) => c.kind === "wood");
    const plaster = choices.find((c) => c.kind === "plaster");
    if (!wood || !plaster) throw new Error("no choice");
    expect([wood.takes, wood.short]).toEqual([0, 0]);
    expect([plaster.takes, plaster.held, plaster.short]).toEqual([8, 3, 5]);
    expect(roofLine(wood)).toBe("Wood: free, like the wall it matches.");
    expect(roofLine(plaster)).toContain("You need 5 plaster blocks more.");
  });

  it("counts the covering already up as coming back, so putting it on again asks for nothing", () => {
    const held = new Map([["brickwork", 0]]);
    expect(roofChoices(held).find((c) => c.kind === "brickwork")?.short).toBe(8);
    // The 8 on the roof come back when it changes, so the same material in another style is free.
    expect(roofChoices(held, "brickwork").find((c) => c.kind === "brickwork")?.short).toBe(0);
  });
});
