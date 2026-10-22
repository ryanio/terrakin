import { groundOf } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { pickNeighbors, pickWays, pickWhere, plotPicks } from "./plot-picks";

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

  it("puts a plot that closes nobody in before one as near that would, and marks that one (decision 0352)", () => {
    // Ivy lives on (1, 0). Wren's (0, 0) has Ivy east and Moss south, so (1, 1) is its last way out.
    const plots = [
      { px: 1, py: 0, ownerId: "ivy" },
      { px: 0, py: 0, ownerId: "wren" },
      { px: 0, py: 1, ownerId: "moss" },
    ];
    const world = { config, commons, plots, residents: [resident({ x: 11, y: 3 })] };
    const claimed = new Set(plots.map((p) => `${p.px},${p.py}`));
    const facts = {
      ground: groundOf({
        config,
        hasBlock: () => false,
        solidBuildings: false,
        townHall: [],
        shop: [],
      }),
      claimed: (px: number, py: number) => claimed.has(`${px},${py}`),
    };
    const at = (p: { px: number; py: number }) => [p.px, p.py];
    // Without the facts, (1, 1) leads: beside Ivy and nearest the Commons.
    expect(plotPicks(world).slice(0, 3).map(at)).toEqual([
      [1, 1],
      [2, 1],
      [2, 0],
    ]);
    const picks = plotPicks(world, facts);
    expect(picks.slice(0, 3).map(at)).toEqual([
      [2, 1],
      [2, 0],
      [1, 1],
    ]);
    expect(picks[2]).toMatchObject({ seals: ["wren"] });
    expect(picks[0]).not.toHaveProperty("seals");
    expect(pickWays(["Wren"], false)).toBe("Takes Wren's only way out");
    expect(pickWays([], true)).toBe("No way out of its own");
    expect(pickWays([], false)).toBeUndefined();
  });
});

describe("plotPicks with an island", () => {
  // Downtown is the 5 by 5 grid; the water is plot column 5, and Willowmere is columns 6 to 7.
  const lands = {
    home: { width: 40, height: 40 },
    list: [
      {
        id: "willowmere",
        name: "Willowmere",
        plots: [
          { px: 6, py: 1 },
          { px: 6, py: 2 },
          { px: 7, py: 1 },
          { px: 7, py: 2 },
        ],
        bridge: [{ x: 40, y: 19 }],
        square: { px: 6, py: 3 },
      },
    ],
  };
  const island = { config: { ...config, width: 64 }, commons, lands, residents: [] };

  it("offers downtown before the island, and never the water between", () => {
    const picks = plotPicks({ ...island, plots: [] });
    // 25 downtown, less the Commons, then the island's 4. The water column brings none.
    expect(picks).toHaveLength(28);
    expect(picks.filter((p) => p.land).map((p) => [p.px, p.py])).toEqual([
      [6, 1],
      [6, 2],
      [7, 1],
      [7, 2],
    ]);
    expect(picks.slice(0, 24).every((p) => p.land === undefined)).toBe(true);
    expect(picks.some((p) => p.px === 5)).toBe(false);
  });

  it("names the land a plot is on, so a newcomer knows it's across the bridge", () => {
    const picks = plotPicks({ ...island, plots: [] });
    const far = picks.find((p) => p.px === 6 && p.py === 1);
    expect(far).toMatchObject({ land: "Willowmere" });
    expect(pickWhere(far ?? { px: 0, py: 0 }, commons)).toBe("On Willowmere, across the bridge");
  });

  it("leaves the island out while downtown is all there is", () => {
    const picks = plotPicks({ config, commons, plots: [], residents: [] });
    expect(picks.every((p) => p.land === undefined)).toBe(true);
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
