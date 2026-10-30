import { describe, expect, it } from "vitest";
import { type Camera, fitScale, tileToScreen } from "./camera";
import {
  clampScale,
  drawnScale,
  keepInWorld,
  mapDetail,
  zoomAround,
  zoomBounds,
  zoomStep,
} from "./map-zoom";

/**
 * The map's zoom on the phone the client is built for (390 by 844), over downtown as terrakin.org
 * has it (72 by 72 tiles) and over a world grown wider by an island (RFC 0038).
 */
const PHONE = { width: 390, height: 844 };
const DOWNTOWN = { width: 72, height: 72 };
const GROWN = { width: 120, height: 72 };
const base = fitScale(PHONE.width, PHONE.height);
const cam = (o: Partial<Camera> = {}): Camera => ({
  cx: 36,
  cy: 36,
  scale: base,
  ...PHONE,
  ...o,
});

describe("zoomBounds", () => {
  it("zooms out until the whole world is on a phone's screen, grown or not", () => {
    for (const world of [DOWNTOWN, GROWN]) {
      const { min } = zoomBounds(PHONE, world, base);
      expect(world.width * min).toBeLessThanOrEqual(PHONE.width);
      expect(world.height * min).toBeLessThanOrEqual(PHONE.height);
      // And no further: most of the screen's width is world.
      expect(world.width * min).toBeGreaterThan(PHONE.width * 0.9);
    }
  });

  it("goes closer than the usual view and keeps the usual view inside the range", () => {
    const b = zoomBounds(PHONE, DOWNTOWN, base);
    expect(b.max).toBeGreaterThan(base);
    expect(b.min).toBeLessThan(base);
    expect(clampScale(base, b)).toBe(base);
    expect(clampScale(b.max * 3, b)).toBe(b.max);
    expect(clampScale(0.1, b)).toBe(b.min);
  });

  it("zooms out no further than the usual view for a world that already fits", () => {
    const tiny = { width: 8, height: 8 };
    expect(zoomBounds(PHONE, tiny, base).min).toBe(base);
  });
});

describe("zoomStep", () => {
  it("finds the usual view again on the way back, whichever end it starts from", () => {
    const b = zoomBounds(PHONE, GROWN, base);
    let s = b.min;
    const seen: number[] = [];
    while (s < b.max) {
      s = zoomStep(s, 1, b);
      seen.push(s);
    }
    expect(seen).toContain(base);
    expect(seen.at(-1)).toBe(b.max);
    expect(zoomStep(b.max, -1, b)).toBe(base);
    expect(zoomStep(b.min, -1, b)).toBe(b.min);
  });
});

describe("zoomAround", () => {
  it("keeps the tile under a pinch or the mouse under it", () => {
    const before = cam({ cx: 30.4, cy: 41.2 });
    const point = { sx: 300, sy: 200 };
    const tileAt = (c: Camera) => ({
      x: (point.sx - c.width / 2) / c.scale + c.cx,
      y: (point.sy - c.height / 2) / c.scale + c.cy,
    });
    const after = { ...before, scale: 9, ...zoomAround(before, 9, point.sx, point.sy) };
    expect(tileAt(after).x).toBeCloseTo(tileAt(before).x, 9);
    expect(tileAt(after).y).toBeCloseTo(tileAt(before).y, 9);
  });
});

describe("keepInWorld", () => {
  it("centers a world the view is wider than", () => {
    const c = cam({ scale: 5, cx: 3, cy: 70 });
    const { cx, cy } = keepInWorld(c, DOWNTOWN);
    // The view is taller than the world too, so both axes center.
    expect(cx).toBe(35.5);
    expect(cy).toBe(35.5);
  });

  it("keeps the world's edge at the screen's edge when the view is smaller", () => {
    const c = cam({ scale: 10, cx: 0, cy: 36 });
    const kept = { ...c, ...keepInWorld(c, GROWN) };
    // The west edge of tile 0 is at the left of the screen, not inside it.
    expect(tileToScreen(kept, 0, 0).sx - kept.scale / 2).toBeCloseTo(0, 9);
    // Along the axis the view spans, it centers.
    expect(kept.cy).toBe(35.5);
  });

  it("leaves a camera already over the world where it is", () => {
    const c = cam({ scale: 10, cx: 60, cy: 36 });
    expect(keepInWorld(c, GROWN).cx).toBe(60);
  });
});

describe("mapDetail", () => {
  it("draws everything at the usual view, on a phone and on a desktop", () => {
    for (const [w, h] of [
      [390, 844],
      [1440, 900],
    ] as const) {
      expect(mapDetail(fitScale(w, h))).toEqual({ simple: false, marks: false });
    }
  });

  it("draws the overview simply, with the lands' names and marks, on a phone and a desktop", () => {
    for (const view of [PHONE, { width: 1440, height: 900 }]) {
      const { min } = zoomBounds(view, GROWN, fitScale(view.width, view.height));
      expect(mapDetail(min)).toEqual({ simple: true, marks: true });
    }
  });
});

describe("drawnScale", () => {
  it("draws whole pixels a tile from the simple view up, so a pinch reuses each sprite", () => {
    expect(drawnScale(30.4)).toBe(30);
    expect(drawnScale(14.6)).toBe(15);
    expect(drawnScale(5.4)).toBe(5.5);
    // The usual view is whole pixels already, so it draws exactly as before.
    expect(drawnScale(base)).toBe(base);
  });
});
