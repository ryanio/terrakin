import { describe, expect, it } from "vitest";
import { doneAlready, homeSteps } from "./home-steps";

describe("building a design from the home sheet (RFC 0032)", () => {
  const center = { x: 19, y: 11 };
  it("walks only while the plot's center is out of reach, and sets the hearth only once", () => {
    // Settled: on the center itself.
    expect(homeSteps({ standing: center, center, reach: 3, hearth: null })).toEqual({
      walk: false,
      setHearth: true,
    });
    // Claimed from the plot's far corner, four tiles out.
    expect(homeSteps({ standing: { x: 23, y: 15 }, center, reach: 3, hearth: null })).toEqual({
      walk: true,
      setHearth: true,
    });
    // A retry after the build failed: the hearth is in place, so nothing before the build again.
    expect(homeSteps({ standing: { x: 23, y: 15 }, center, reach: 3, hearth: center })).toEqual({
      walk: false,
      setHearth: false,
    });
    // A hearth somewhere else moves to the center.
    expect(
      homeSteps({ standing: center, center, reach: 3, hearth: { x: 18, y: 11 } }).setHearth,
    ).toBe(true);
  });

  it("carries on past a hearth that's already there, and stops on any other refusal", () => {
    expect(doneAlready("already_home")).toBe(true);
    expect(doneAlready("out_of_reach")).toBe(false);
  });
});
