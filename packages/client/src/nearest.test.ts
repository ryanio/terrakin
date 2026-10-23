import { describe, expect, it } from "vitest";
import { nearestTile, wayWords } from "./nearest";

describe("the way to the nearest thing", () => {
  it("finds the closest tile by rings, then north to south, then west to east", () => {
    const at = { x: 10, y: 10 };
    const lying = new Set(["14,10", "12,8", "13,13"]);
    const wanted = (x: number, y: number) => lying.has(`${x},${y}`);
    expect(nearestTile(at, wanted)).toEqual({ x: 12, y: 8 });
    expect(nearestTile(at, wanted, 1)).toBeUndefined();
  });

  it("says which way and how far, as the map is drawn with north up", () => {
    const at = { x: 10, y: 10 };
    expect(wayWords(at, { x: 16, y: 4 })).toBe("6 tiles northeast");
    expect(wayWords(at, { x: 4, y: 11 })).toBe("6 tiles west");
    expect(wayWords(at, { x: 11, y: 18 })).toBe("8 tiles south");
    expect(wayWords(at, { x: 11, y: 11 })).toBe("right beside you");
  });
});
