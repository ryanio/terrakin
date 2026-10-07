import type { WorldSnapshot } from "@terrakin/protocol";
import { BLOCK_COLORS } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { plotMarks } from "./plot-thumb";

/** Plots of 4 tiles. Ivy lives on plot (1, 0), tiles x 4 to 7 and y 0 to 3, with a lemon theme. */
const world: WorldSnapshot = {
  v: 1,
  seq: 9,
  hash: "0",
  time: { nowMs: 0, dayLengthMs: 600_000 },
  day: 20_000,
  config: { width: 12, height: 12, plotSize: 4, maxPlotsPerResident: 1, reach: 2 },
  commons: { px: 1, py: 1 },
  residents: [
    {
      id: "ivy",
      name: "Ivy",
      kind: "human",
      color: "sun",
      shape: "round",
      note: "",
      x: 5,
      y: 1,
      online: true,
      hearth: { x: 5, y: 1 },
      theme: "lemon",
    },
  ],
  plots: [{ px: 1, py: 0, ownerId: "ivy" }],
  blocks: [
    { x: 4, y: 0, block: "stone" },
    { x: 6, y: 3, block: "lantern" },
    // Someone else's, on the plot to the west: not drawn.
    { x: 3, y: 0, block: "wood" },
  ],
  crops: [{ x: 7, y: 2, crop: "flower", plantedDay: 19_998, readyDay: 20_000 }],
  ground: [{ x: 5, y: 3, ground: "cobble" }],
};

describe("a plot's drawing", () => {
  it("puts what's on the plot at its own tiles, in the world's colors, and nothing from next door", () => {
    const { size, tint, marks } = plotMarks(world, 1, 0);
    expect(size).toBe(4);
    expect(marks.filter((m) => m.kind === "ground")).toHaveLength(16);
    expect(marks.filter((m) => m.kind !== "ground")).toEqual([
      { x: 1, y: 3, kind: "path", ground: "cobble" },
      // Stone takes the lemon theme's finish; the shop's lantern keeps its own color.
      expect.objectContaining({ x: 0, y: 0, kind: "block", glass: false, decor: false }),
      { x: 2, y: 3, kind: "block", fill: BLOCK_COLORS.lantern, glass: false, decor: true },
      expect.objectContaining({ x: 3, y: 2, kind: "crop", ripe: true }),
      { x: 1, y: 1, kind: "hearth" },
    ]);
    const stone = marks.find((m) => m.kind === "block" && m.x === 0);
    expect(stone && "fill" in stone ? stone.fill : "").not.toBe(BLOCK_COLORS.stone);
    expect(tint).toMatch(/^rgba\(/);
    // The plot next door has its own block and none of Ivy's.
    expect(plotMarks(world, 0, 0).marks.filter((m) => m.kind !== "ground")).toEqual([
      expect.objectContaining({ x: 3, y: 0, kind: "block", fill: BLOCK_COLORS.wood }),
    ]);
  });
});
