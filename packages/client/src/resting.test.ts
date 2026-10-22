import type { BlockKind } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { postureAt } from "./resting";
import { newsLine } from "./things";

describe("resting", () => {
  // A bed at (2, 2) and a sofa at (3, 2), as the mirror would hand them over.
  const blocks = new Map<string, BlockKind>([
    ["2,2", "bed"],
    ["3,2", "sofa"],
    ["4,2", "table"],
  ]);
  const blockAt = (x: number, y: number) => blocks.get(`${x},${y}`);

  it("draws someone standing on a seat's tile resting, and someone walking over it standing", () => {
    expect(postureAt(blockAt, 2, 2)).toBe("lie");
    expect(postureAt(blockAt, 3, 2)).toBe("sit");
    // Halfway across the sofa on a walk: not sitting.
    expect(postureAt(blockAt, 3.4, 2)).toBeUndefined();
    expect(postureAt(blockAt, 4, 2)).toBeUndefined();
    expect(postureAt(blockAt, 5, 2)).toBeUndefined();
  });

  it("says where you sat or lay down, and nothing about anyone else", () => {
    const rested = (block: "bed" | "armchair" | "bench", residentId = "r_1") =>
      newsLine({ type: "rested", residentId, x: 2, y: 2, block }, "r_1");
    expect(rested("bed")).toBe("You lay down on the bed. Any step gets you up.");
    expect(rested("armchair")).toBe("You sat down in the armchair. Any step gets you up.");
    expect(rested("bench")).toBe("You sat down on the bench. Any step gets you up.");
    expect(rested("bed", "r_2")).toBeNull();
  });
});
