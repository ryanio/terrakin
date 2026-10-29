import { describe, expect, it } from "vitest";
import {
  clearSide,
  heightShare,
  NEAR_ACROSS,
  openRoofs,
  type PhotoFramingName,
  PORTRAIT_FILL,
  photoView,
  sightline,
  WIDE_PLOTS,
  widthAt,
} from "./photo-framing";

/** The photo page's frame: 1200 wide, 836 tall over the stamp, through the 3D world's wide lens. */
const LENS = { fovDeg: 40, aspect: 1200 / 836 };
const at = { focus: { x: 20, z: 12 }, plotSize: 8, ...LENS };
const dist = (v: ReturnType<typeof photoView>) =>
  Math.hypot(v.position.x - v.target.x, v.position.y - v.target.y, v.position.z - v.target.z);

describe("scene photo framings", () => {
  it.each(["portrait", "near", "wide"] as PhotoFramingName[])(
    "looks at the subject from the south and above (%s)",
    (framing) => {
      const v = photoView(framing, at);
      expect(v.target.x).toBe(20);
      expect(v.target.z).toBe(12);
      expect(v.position.x).toBe(20);
      expect(v.position.z).toBeGreaterThan(v.target.z);
      expect(v.position.y).toBeGreaterThan(v.target.y);
      // The haze starts past the subject, so it's never fogged out.
      expect(v.fogNear).toBeGreaterThan(dist(v));
      expect(v.fogFar).toBeGreaterThan(v.fogNear);
    },
  );

  it("fills most of a portrait's height with the resident, head to toe", () => {
    const top = 2.1;
    const v = photoView("portrait", { ...at, figureTop: top });
    const share = heightShare(top, dist(v), LENS.fovDeg);
    expect(share).toBeCloseTo(PORTRAIT_FILL, 1);
    expect(share).toBeLessThan(0.95);
    // Aimed at the middle of the figure, so neither the hat nor the shoes are cut.
    expect(v.target.y).toBeCloseTo(top * 0.52, 5);
  });

  it("stands a portrait on the subject's floor (RFC 0028)", () => {
    const ground = photoView("portrait", at);
    const upstairs = photoView("portrait", { ...at, floorY: 2.5 });
    expect(upstairs.target.y - ground.target.y).toBeCloseTo(2.5, 5);
  });

  it("shows about nine tiles across where the subject stands, near", () => {
    const v = photoView("near", at);
    expect(widthAt(dist(v), LENS.fovDeg, LENS.aspect)).toBeCloseTo(NEAR_ACROSS, 5);
  });

  it("shows the whole plot and its neighbors, wide", () => {
    const v = photoView("wide", at);
    const across = widthAt(dist(v), LENS.fovDeg, LENS.aspect);
    expect(across).toBeCloseTo(at.plotSize * WIDE_PLOTS, 5);
    expect(across).toBeGreaterThan(at.plotSize * 2);
  });

  it("takes a portrait from the first side with no wall in the way, else opens the wall in front", () => {
    const tile = { x: 10, y: 10 };
    const walls = new Set<string>();
    const blocked = (x: number, y: number) => walls.has(`${x},${y}`);
    expect(clearSide(blocked, tile, 4)).toEqual({ x: 0, z: 1 });
    // A wall to the south, two tiles out: the south-east is next.
    walls.add("10,12");
    const se = clearSide(blocked, tile, 4);
    expect(se?.x).toBeCloseTo(Math.SQRT1_2);
    expect(se?.z).toBeCloseTo(Math.SQRT1_2);
    // Walled in on every side, as inside a home: no side.
    for (let i = -2; i <= 2; i++) {
      for (const [x, y] of [
        [10 + i, 8],
        [10 + i, 12],
        [8, 10 + i],
        [12, 10 + i],
      ] as const)
        walls.add(`${x},${y}`);
    }
    expect(clearSide(blocked, tile, 4)).toBeUndefined();
    // So the photo leaves the south wall out where the lens looks through it, and no other.
    const cut = sightline(tile, { x: 0, z: 1 }, 4).map((t) => `${t.x},${t.y}`);
    expect(cut).toEqual(expect.arrayContaining(["9,12", "10,12", "11,12"]));
    expect(cut).not.toContain("10,8");
    expect(cut).not.toContain("8,10");
    expect(cut).not.toContain("10,10");
    for (const key of cut) walls.delete(key);
    expect(clearSide(blocked, tile, 4)).toEqual({ x: 0, z: 1 });
    // From the east, the line runs east.
    const east = sightline(tile, { x: 1, z: 0 }, 4).map((t) => `${t.x},${t.y}`);
    expect(east).toContain("12,10");
    expect(east).not.toContain("10,12");
  });

  it("takes the roofs off the plot a near or wide shot is about and the plot in front of it", () => {
    // Plot (5, 3) of 8-tile plots; the camera looks from the south, over plot (5, 4).
    const focus = { x: 5 * 8 + 3, y: 3 * 8 + 2 };
    for (const framing of ["near", "wide"] as const)
      expect(openRoofs(framing, focus, 8)).toEqual([
        { px: 5, py: 3 },
        { px: 5, py: 4 },
      ]);
    expect(openRoofs("portrait", focus, 8)).toEqual([]);
  });
});
