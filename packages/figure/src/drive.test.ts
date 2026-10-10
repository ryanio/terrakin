import { describe, expect, it } from "vitest";
import { drive, MAX_WALK_RATE, MIN_WALK_RATE } from "./drive.js";

const walker = { clips: ["idle", "walk"], walkSpeed: 0.1 };

describe("drive", () => {
  it("stands a body that isn't moving, or is barely moving", () => {
    expect(drive({ speed: 0, grounded: true }, walker)).toEqual({ clip: "idle", rate: 1 });
    expect(drive({ speed: 0.004, grounded: true }, walker)).toEqual({ clip: "idle", rate: 1 });
    expect(drive({ speed: Number.NaN, grounded: true }, walker)).toEqual({ clip: "idle", rate: 1 });
  });

  it("walks at the rate that keeps planted feet planted", () => {
    expect(drive({ speed: 0.1, grounded: true }, walker)).toEqual({ clip: "walk", rate: 1 });
    expect(drive({ speed: 0.15, grounded: true }, walker).rate).toBeCloseTo(1.5);
    expect(drive({ speed: 0.07, grounded: true }, walker).rate).toBeCloseTo(0.7);
  });

  it("never plays a walk slower or faster than its limits", () => {
    expect(drive({ speed: 0.01, grounded: true }, walker).rate).toBe(MIN_WALK_RATE);
    expect(drive({ speed: 5, grounded: true }, walker).rate).toBe(MAX_WALK_RATE);
  });

  it("walks at rate 1 when the body doesn't say how fast its walk is, and names walk even without one", () => {
    expect(drive({ speed: 0.3, grounded: true }, { clips: ["idle"] })).toEqual({
      clip: "walk",
      rate: 1,
    });
  });

  it.each([
    [["idle", "walk", "hop", "flutter", "fly"], "fly"],
    [["idle", "hop", "flutter"], "flutter"],
    [["idle", "walk", "hop"], "hop"],
    [["idle", "walk"], "idle"],
  ])("in the air, a body with %j plays %s", (clips, clip) => {
    expect(drive({ speed: 0.2, grounded: false }, { clips, walkSpeed: 0.1 })).toEqual({
      clip,
      rate: 1,
    });
  });
});
