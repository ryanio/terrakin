import { describe, expect, it } from "vitest";
import { claimOpensOnJoin } from "./claim-on-join";

describe("claimOpensOnJoin", () => {
  it("opens for a new person at the door with no plot yet", () => {
    expect(claimOpensOnJoin({ fresh: true, toPlace: false, hasPlot: false })).toBe(true);
  });

  it("stays away for someone coming back to a saved character", () => {
    expect(claimOpensOnJoin({ fresh: false, toPlace: false, hasPlot: false })).toBe(false);
  });

  it("stays away when they joined to go to a link's place", () => {
    expect(claimOpensOnJoin({ fresh: true, toPlace: true, hasPlot: false })).toBe(false);
  });

  it("stays away once the world shows a plot of theirs", () => {
    expect(claimOpensOnJoin({ fresh: true, toPlace: false, hasPlot: true })).toBe(false);
  });
});
