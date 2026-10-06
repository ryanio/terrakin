import { facingFrom, facingToward } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import {
  bubbleMs,
  DOZE_MS,
  DUST_MS,
  MAX_STEP_MS,
  MIN_STEP_MS,
  Motion,
  POOF_MS,
  STEP_MS,
  wrapWords,
} from "./motion";
import { stackBubbles } from "./overhead";

const at = (x: number, y: number) => ({ id: "a", x, y });

describe("walking", () => {
  it("slides a step between tiles with a hop, and lands on the tile", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    const mid = m.pose(at(6, 5), 1000, false);
    expect(mid.x).toBe(5);
    const half = m.pose(at(6, 5), 1000 + STEP_MS / 2, false);
    expect(half.x).toBeCloseTo(5.5);
    expect(half.lift).toBeGreaterThan(0.05);
    expect(half.squash).toBeLessThan(1);
    const done = m.pose(at(6, 5), 1000 + STEP_MS + 400, false);
    expect([done.x, done.y, done.lift]).toEqual([6, 5, 0]);
  });

  it("chains quick steps from wherever the last slide had got to", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    m.pose(at(6, 5), 1000, false);
    const turned = m.pose(at(6, 6), 1000 + STEP_MS / 2, false);
    expect(turned.x).toBeCloseTo(5.5);
    expect(turned.y).toBe(5);
  });

  it("paces each slide by the gap since their last step, so a walk looks even", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    // Steps every 300ms, the way a slow connection spaces them out.
    let x = 5;
    for (let t = 1000; t <= 2500; t += 300) m.pose(at(++x, 5), t, false);
    // Most of the way through the slide, not parked on the tile waiting for the next step.
    const mid = m.pose(at(x, 5), 2500 + 200, false);
    expect(mid.x).toBeGreaterThan(x - 0.5);
    expect(mid.x).toBeLessThan(x);
    expect(mid.lift).toBeGreaterThan(0);
    // A long pause and a new step starts at the first step's pace again; the pace stays in bounds.
    const fresh = m.pose(at(x + 1, 5), 9000, false);
    expect(fresh.x).toBe(x);
    expect(m.pose(at(x + 1, 5), 9000 + STEP_MS, false).x).toBe(x + 1);
  });

  it("keeps the pace within bounds", () => {
    const m = new Motion();
    m.pose(at(0, 5), 0, false);
    // Slow steps, 600ms apart: each slide stretches, but never past MAX_STEP_MS.
    let x = 0;
    for (let t = 1000; t <= 4000; t += 600) m.pose(at(++x, 5), t, false);
    expect(m.pose(at(x, 5), 4000 + MAX_STEP_MS - 20, false).x).toBeLessThan(x);
    expect(m.pose(at(x, 5), 4000 + MAX_STEP_MS, false).x).toBe(x);
    // Quick steps, 20ms apart: each slide shrinks, but never under MIN_STEP_MS.
    for (let t = 5000; t <= 5200; t += 20) m.pose(at(++x, 5), t, false);
    expect(m.pose(at(x, 5), 5200 + MIN_STEP_MS - 10, false).x).toBeLessThan(x);
    expect(m.pose(at(x, 5), 5200 + MIN_STEP_MS, false).x).toBe(x);
  });

  it("kicks up a little dust where each step pushes off", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    expect(m.pose(at(6, 5), 1000, false).dust).toEqual({ x: 5, y: 5, t: 0 });
    expect(m.pose(at(6, 5), 1000 + DUST_MS, false).dust).toBeUndefined();
    expect(m.pose(at(7, 5), 2000, true).dust).toBeUndefined();
  });

  it("jumps home without a slide, landing in a puff", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    const landed = m.pose(at(20, 30), 1000, false);
    expect([landed.x, landed.y, landed.lift]).toEqual([20, 30, 0]);
    expect(landed.poof).toBe(0);
    expect(m.pose(at(20, 30), 1000 + POOF_MS, false).poof).toBeUndefined();
  });

  it("stands still on its tile with reduced motion", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, false);
    const p = m.pose(at(6, 5), 1000, true);
    expect(p).toMatchObject({ x: 6, y: 5, lift: 0, squash: 1, sway: 0, poof: undefined });
  });
});

describe("dozing and waking", () => {
  it("dozes after standing still a while, as the sleepy feeling, and a step wakes them", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, true);
    expect(m.pose(at(5, 5), DOZE_MS - 1, true).doze).toBeUndefined();
    const asleep = m.pose(at(5, 5), DOZE_MS + 1, true).doze;
    expect(asleep).toMatchObject({ feeling: "sleepy", at: DOZE_MS });
    // The same feeling while it lasts, so its sign drifts on rather than starting over.
    expect(m.pose(at(5, 5), DOZE_MS + 500, true).doze).toBe(asleep);
    expect(m.pose(at(5, 6), DOZE_MS + 600, true).doze).toBeUndefined();
  });

  it("never dozes you off", () => {
    const m = new Motion();
    m.self = "a";
    m.pose(at(5, 5), 0, true);
    expect(m.pose(at(5, 5), 3 * DOZE_MS, true).doze).toBeUndefined();
  });

  it("wakes when they talk", () => {
    const m = new Motion();
    m.pose(at(5, 5), 0, true);
    m.say("a", "morning", DOZE_MS + 1);
    expect(m.pose(at(5, 5), DOZE_MS + 2, true).doze).toBeUndefined();
  });
});

describe("speech bubbles", () => {
  it("show what was said, fade at the end, and go", () => {
    const m = new Motion();
    m.say("a", "hello there", 0);
    expect(m.bubble("a", 100)).toEqual({ lines: ["hello there"], alpha: 1 });
    const end = bubbleMs("hello there");
    expect(m.bubble("a", end - 200)?.alpha).toBeCloseTo(0.5);
    expect(m.bubble("a", end)).toBeUndefined();
  });

  it("stay longer for longer lines, up to a limit", () => {
    expect(bubbleMs("a long line that keeps going")).toBeGreaterThan(bubbleMs("hi"));
    expect(bubbleMs("x".repeat(280))).toBe(9000);
  });

  it("wrap at spaces into three lines at most, with an ellipsis when it runs over", () => {
    expect(wrapWords("hello neighbours, anyone want to plant tomatoes with me today?")).toEqual([
      "hello neighbours,",
      "anyone want to plant",
      "tomatoes with me…",
    ]);
    expect(wrapWords("short")).toEqual(["short"]);
    expect(wrapWords("a".repeat(30))).toEqual(["a".repeat(22), "a".repeat(8)]);
  });

  it("stack clear of name tags and of each other, the nearest kept lowest", () => {
    const box = (left: number, top: number, w = 40, h = 20) => ({
      left,
      right: left + w,
      top,
      bottom: top + h,
    });
    // Two speakers side by side, and a building's tag above them.
    const raises = stackBubbles([box(100, 100), box(120, 100)], [box(90, 60, 80, 18)]);
    expect(raises[0]).toBe(0);
    const second = raises[1] ?? 0;
    expect(second).toBeGreaterThan(20);
    // Raised past the first bubble, it would have hit the tag, so it goes over that too.
    expect(100 - second + 20).toBeLessThanOrEqual(60 - 3);
    // Bubbles apart don't move.
    expect(stackBubbles([box(0, 100), box(200, 100)], [])).toEqual([0, 0]);
  });

  it("forget residents who are gone", () => {
    const m = new Motion();
    m.say("a", "bye", 0);
    m.keep(new Set());
    expect(m.bubble("a", 1)).toBeUndefined();
  });
});

describe("facing", () => {
  it("turns only on a one-tile step", () => {
    expect(facingFrom(1, 0)).toBe("e");
    expect(facingFrom(0, -1)).toBe("n");
    expect(facingFrom(5, 2)).toBeUndefined();
    expect(facingFrom(0, 0)).toBeUndefined();
  });

  it("looks toward something along the bigger axis", () => {
    expect(facingToward(3, 1)).toBe("e");
    expect(facingToward(-1, -4)).toBe("n");
    expect(facingToward(0, 2)).toBe("s");
    expect(facingToward(0, 0)).toBeUndefined();
  });
});
