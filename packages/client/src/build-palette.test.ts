import { describe, expect, it } from "vitest";
import {
  blockShort,
  canLay,
  groundLine,
  heldLabel,
  heldLine,
  holdingsFromStacks,
  stairsLine,
  tabOf,
  withChanges,
} from "./build-palette";

describe("the build bar", () => {
  it("counts what you hold and leaves out what you don't", () => {
    const held = holdingsFromStacks([
      { kind: "bench", count: 1 },
      { kind: "stone", count: 4 },
      { kind: "fence", count: 0 },
    ]);
    expect([...held]).toEqual([
      ["bench", 1],
      ["stone", 4],
    ]);
  });

  it("follows the counts an inventory event carries, and keeps the same map when none moved", () => {
    const start = holdingsFromStacks([{ kind: "table", count: 1 }]);
    expect(withChanges(start, [{ kind: "table", count: 1 }])).toBe(start);
    expect(withChanges(start, undefined)).toBe(start);
    // Made two chairs, then placed the last table.
    const made = withChanges(start, [{ kind: "chair", count: 2 }]);
    expect([...made]).toEqual([
      ["table", 1],
      ["chair", 2],
    ]);
    expect([...withChanges(made, [{ kind: "table", count: 0 }])]).toEqual([["chair", 2]]);
  });

  it("says how many of a piece are left, and where to get one when none are", () => {
    expect(heldLabel("lantern", 3)).toBe("Paper lantern, 3 left");
    expect(heldLabel("table", 0)).toBe("Table, none left");
    expect(heldLine("well", 0)).toBe(
      "Well: none yet. Make one at a workbench from 2 wood, 6 stone.",
    );
    expect(heldLine("bench", 0)).toBe("Garden bench: none yet. Buy one at the town shop.");
  });

  it("asks the sim whether a path can be paid for, and says what's short", () => {
    const none = holdingsFromStacks([]);
    expect(canLay("dirt", none)).toBe(true);
    expect(canLay("cobble", none)).toBe(false);
    expect(groundLine("brick", holdingsFromStacks([{ kind: "stone", count: 1 }]))).toBe(
      "Brick path: 2 stone a tile. You need 1 stone more.",
    );
    expect(canLay("rug", holdingsFromStacks([{ kind: "herb", count: 1 }]))).toBe(false);
    expect(
      canLay(
        "rug",
        holdingsFromStacks([
          { kind: "herb", count: 1 },
          { kind: "flower", count: 1 },
        ]),
      ),
    ).toBe(true);
  });

  it("asks the sim what stairs take, and says what's short (RFC 0028)", () => {
    const one = holdingsFromStacks([{ kind: "wood", count: 1 }]);
    expect(blockShort("stairs", one)).toEqual([{ kind: "wood", count: 3 }]);
    expect(stairsLine(one)).toBe(
      "Stairs: 4 wood, up to the storey above. Stand on them and tap Go up. You need 3 wood more.",
    );
    expect(blockShort("stairs", holdingsFromStacks([{ kind: "wood", count: 4 }]))).toEqual([]);
    expect(blockShort("glass", holdingsFromStacks([]))).toEqual([]);
  });

  it("finds each pick's tab", () => {
    expect(tabOf("stairs")).toBe("blocks");
    expect(tabOf("wood")).toBe("blocks");
    expect(tabOf("hearth")).toBe("blocks");
    expect(tabOf("cobble")).toBe("ground");
    expect(tabOf("lantern")).toBe("furniture");
    expect(tabOf("well")).toBe("furniture");
  });
});
