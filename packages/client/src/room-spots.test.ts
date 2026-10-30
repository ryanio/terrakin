import { describe, expect, it } from "vitest";
import { wallFace } from "./room-spots";

// A wall at (5, 5) with open ground on every side unless a test says otherwise.
const WALL = { x: 5, y: 5 };
const everywhere = () => true;

describe("wallFace", () => {
  it("picks the face seen from the open tile nearest you", () => {
    // Standing south of the wall, you see its south face, from (5, 6), wall to your north.
    expect(wallFace(WALL, { x: 5, y: 8 }, everywhere)).toEqual({ x: 5, y: 6, side: "n" });
    // From the west, its west face, from (4, 5), wall to your east.
    expect(wallFace(WALL, { x: 2, y: 5 }, everywhere)).toEqual({ x: 4, y: 5, side: "e" });
  });

  it("skips a side with no open tile, so a wall of a hut is tapped from inside", () => {
    const inside = (_x: number, y: number) => y > 5;
    expect(wallFace(WALL, { x: 5, y: 2 }, inside)).toEqual({ x: 5, y: 6, side: "n" });
  });

  it("has no face for a wall with nothing open beside it", () => {
    expect(wallFace(WALL, { x: 5, y: 8 }, () => false)).toBeUndefined();
  });
});
