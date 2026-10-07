import { describe, expect, it } from "vitest";
import { pickNeighbors, pickWhere, plotPicks } from "./plot-picks";

// 5x5 plots of 8 tiles; the Commons is plot (2, 2).
const config = { width: 40, height: 40, plotSize: 8, maxPlotsPerResident: 1, reach: 3 };
const commons = { px: 2, py: 2 };
const resident = (hearth?: { x: number; y: number }) => (hearth ? { hearth } : {});

describe("plotPicks", () => {
  it("offers every plot settle would take, beside a lived-in plot first", () => {
    const world = {
      config,
      commons,
      // Ivy lives on (0, 0); Wren owns (4, 4) and has no hearth there.
      plots: [
        { px: 0, py: 0, ownerId: "ivy" },
        { px: 4, py: 4, ownerId: "wren" },
      ],
      residents: [resident({ x: 3, y: 3 }), resident()],
    };
    const picks = plotPicks(world);
    // 25 plots, less the Commons and the two claimed.
    expect(picks).toHaveLength(22);
    expect(picks.some((p) => p.px === 2 && p.py === 2)).toBe(false);
    expect(picks.some((p) => p.px === 0 && p.py === 0)).toBe(false);
    // Beside Ivy's first, nearest the Commons first among them: (1, 1), then (1, 0) and (0, 1).
    expect(picks.slice(0, 3).map((p) => [p.px, p.py])).toEqual([
      [1, 1],
      [1, 0],
      [0, 1],
    ]);
    expect(picks[0]).toMatchObject({ near: 1, neighbors: ["ivy"] });
    // Beside Wren's plot, which nobody lives on yet, is no nearer than anywhere else that far.
    const byWren = picks.find((p) => p.px === 3 && p.py === 3);
    expect(byWren).toMatchObject({ near: 3, neighbors: ["wren"] });
  });

  it("goes by the Commons when nobody lives anywhere yet", () => {
    const picks = plotPicks({ config, commons, plots: [], residents: [] });
    expect(picks[0]).toMatchObject({ px: 1, py: 1, near: Infinity, neighbors: [] });
    expect(picks.at(-1)).toMatchObject({ px: 4, py: 4 });
  });
});

describe("pick words", () => {
  it("says where a plot is from the Commons", () => {
    expect(pickWhere({ px: 2, py: 1 }, commons)).toBe("Just north of the Commons");
    expect(pickWhere({ px: 4, py: 3 }, commons)).toBe("2 plots southeast of the Commons");
    expect(pickWhere({ px: 0, py: 2 }, commons)).toBe("2 plots west of the Commons");
  });

  it("names a few neighbors and counts the rest", () => {
    expect(pickNeighbors([])).toBe("No neighbors yet");
    expect(pickNeighbors(["Ivy"])).toBe("Next to Ivy");
    expect(pickNeighbors(["Ivy", "Wren", "Tansy"])).toBe("Next to Ivy, Wren, and Tansy");
    expect(pickNeighbors(["Ivy", "Wren", "Tansy", "Clem"])).toBe("Next to Ivy, Wren, and 2 more");
  });
});
