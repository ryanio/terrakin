import { BLOCK_COLORS } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { mapMarks } from "./design-thumb";

const config = { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 };

describe("a design's drawing (RFC 0032)", () => {
  it("draws a map as it would stand on a plot: its ground, then paths, blocks, and the hearth", () => {
    const map = {
      floors: [
        {
          floor: 0,
          blocks: ["W1..", ".h..", "....", "...."],
          ground: ["....", ".::.", "....", "...."],
        },
      ],
      legend: { "1": "lantern" as const },
    };
    const { size, marks } = mapMarks({ config, season: "winter" }, { px: 1, py: 0 }, map);
    expect(size).toBe(4);
    expect(marks.filter((m) => m.kind === "ground")).toHaveLength(16);
    expect(marks.filter((m) => m.kind !== "ground")).toEqual([
      { x: 1, y: 1, kind: "path", ground: "dirt" },
      { x: 2, y: 1, kind: "path", ground: "dirt" },
      { x: 0, y: 0, kind: "block", fill: BLOCK_COLORS.wood, glass: false, decor: false },
      { x: 1, y: 0, kind: "block", fill: BLOCK_COLORS.lantern, glass: false, decor: true },
      { x: 1, y: 1, kind: "hearth" },
    ]);
  });
});
