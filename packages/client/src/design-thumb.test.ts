import { designViews } from "@terrakin/protocol";
import { BLOCK_COLORS, groundTile, LOTS } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { designsFitting } from "./design-picks";
import { mapMarks } from "./design-thumb";

const config = { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 };

describe("a design's drawing (RFC 0032)", () => {
  it("draws a map as it would stand on a plot: its ground, then paths, blocks, the hearth, and lines", () => {
    const map = {
      floors: [
        {
          floor: 0,
          blocks: ["W1..", ".h..", "....", "...."],
          ground: ["....", ".::.", "....", "...."],
          // A door on the west line of (3, 1) and wood on the north line of (2, 2) (RFC 0050).
          edges: [
            "+ + + + +",
            " . . . . ",
            "+ + + + +",
            " . . .D. ",
            "+ + +W+ +",
            " . . . . ",
            "+ + + + +",
            " . . . . ",
            "+ + + + +",
          ],
        },
      ],
      legend: { "1": "lantern" as const },
    };
    const lot = { x0: 4, y0: 0, side: 4 };
    const { size, marks } = mapMarks({ config, season: "winter" }, lot, map);
    expect(size).toBe(4);
    expect(marks.filter((m) => m.kind === "ground")).toHaveLength(16);
    expect(marks.filter((m) => m.kind !== "ground")).toEqual([
      { x: 1, y: 1, kind: "path", ground: "dirt" },
      { x: 2, y: 1, kind: "path", ground: "dirt" },
      { x: 0, y: 0, kind: "block", fill: BLOCK_COLORS.wood, glass: false, decor: false },
      { x: 1, y: 0, kind: "block", fill: BLOCK_COLORS.lantern, glass: false, decor: true },
      { x: 1, y: 1, kind: "hearth" },
      { x: 3, y: 1, kind: "edge", side: "w", block: "door" },
      { x: 2, y: 2, kind: "edge", side: "n", block: "wood" },
    ]);
  });

  it("draws a design in the middle of a lot bigger than it, on that lot's own ground (RFC 0052)", () => {
    const map = { floors: [{ floor: 0, blocks: ["W.", ".h"], ground: ["..", ".."] }] };
    const lot = { x0: 3, y0: 5, side: 4 };
    const { size, marks } = mapMarks({ config }, lot, map);
    expect(size).toBe(4);
    const ground = marks.filter((m) => m.kind === "ground");
    expect(ground).toHaveLength(16);
    // The lot's corner tile's ground, not the slot's.
    expect(ground[0]).toMatchObject({
      x: 0,
      y: 0,
      fill: groundTile(config, 3, 5, false, undefined).fill,
    });
    expect(marks.filter((m) => m.kind !== "ground")).toEqual([
      { x: 1, y: 1, kind: "block", fill: BLOCK_COLORS.wood, glass: false, decor: false },
      { x: 2, y: 2, kind: "hearth" },
    ]);
  });
});

describe("the home sheet's designs (RFC 0052)", () => {
  it("offers only the designs that fit the lot: every one on a first lot, none on a smaller square", () => {
    const all = designViews().designs;
    expect(designsFitting(all, LOTS.first)).toEqual(all);
    expect(designsFitting(all, LOTS.first - 1)).toEqual([]);
  });
});
