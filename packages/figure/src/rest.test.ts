import { describe, expect, it } from "vitest";
import { BLINK_SECONDS, blinkAt, idPhase } from "./rest.js";

/** How far shut the eyes are at each sixtieth of a second over `seconds`. */
const frames = (phase: number, seconds: number) =>
  Array.from({ length: seconds * 60 }, (_, frame) => blinkAt(frame / 60, phase));

describe("blinkAt", () => {
  it("shuts the eyes all the way for a moment every few seconds and leaves them open between", () => {
    const lids = frames(0.3, 30);
    const shut = lids.filter((lid) => lid > 0);
    expect(Math.max(...lids)).toBeGreaterThan(0.9);
    expect(Math.min(...lids)).toBe(0);
    // Between 4 and 10 blinks in 30 seconds, each about BLINK_SECONDS long.
    const blinks = shut.length / (BLINK_SECONDS * 60);
    expect(blinks).toBeGreaterThan(4);
    expect(blinks).toBeLessThan(10);
  });

  it("blinks two bodies at different moments", () => {
    const a = frames(idPhase("r_one"), 10).map((lid) => lid > 0);
    const b = frames(idPhase("r_two"), 10).map((lid) => lid > 0);
    expect(a).toContain(true);
    expect(a).not.toEqual(b);
  });
});
