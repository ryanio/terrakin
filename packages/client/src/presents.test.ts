import { type BlockKind, tileKey } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { presentPiles } from "./presents";

const config = { width: 24, height: 24, plotSize: 8, maxPlotsPerResident: 1, reach: 3 };

describe("presentPiles", () => {
  it("puts presents under the fir nearest the hearth on the home plot, else by the hearth", () => {
    const residents = new Map([
      ["ada", { hearth: { x: 3, y: 3 } }],
      ["bob", { hearth: { x: 19, y: 3 } }],
      ["cy", { hearth: null }],
    ]);
    const blocks = new Map<string, BlockKind>([
      [tileKey(6, 6), "little_fir"],
      [tileKey(1, 2), "little_fir"],
      // A fir on the plot next door is someone else's.
      [tileKey(9, 3), "little_fir"],
    ]);
    const presents = new Map([
      ["ada", 2],
      ["bob", 1],
      ["cy", 4],
    ]);
    const piles = presentPiles({ config, residents, blocks, presents });
    expect([...piles]).toEqual([
      [tileKey(1, 2), { count: 2, tree: true }],
      [tileKey(19, 3), { count: 1, tree: false }],
    ]);
  });

  it("joins the presents of residents who share a tree", () => {
    const residents = new Map([
      ["ada", { hearth: { x: 3, y: 3 } }],
      ["dee", { hearth: { x: 4, y: 3 } }],
    ]);
    const blocks = new Map<string, BlockKind>([[tileKey(5, 5), "little_fir"]]);
    const presents = new Map([
      ["ada", 1],
      ["dee", 2],
    ]);
    expect(presentPiles({ config, residents, blocks, presents })).toEqual(
      new Map([[tileKey(5, 5), { count: 3, tree: true }]]),
    );
  });
});
