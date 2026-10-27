import { describe, expect, it } from "vitest";
import { claimOnJoin } from "./claim-on-join";

const fresh = { fresh: true, toPlace: false, hasPlot: false };

describe("claimOnJoin", () => {
  it("opens the picker for a new person with no plot yet", () => {
    expect(claimOnJoin(fresh)).toEqual({ kind: "pick" });
  });

  it("settles the plot a guest asked to live on, with no picker", () => {
    expect(claimOnJoin({ ...fresh, chosen: { px: 3, py: 1 } })).toEqual({
      kind: "settle",
      px: 3,
      py: 1,
    });
  });

  it.each([
    ["someone coming back to a saved character", { fresh: false }],
    ["a join to go to a link's place", { toPlace: true }],
    ["a world that already shows a plot of theirs", { hasPlot: true }],
  ])("stays away for %s", (_, change) => {
    expect(claimOnJoin({ ...fresh, chosen: { px: 3, py: 1 }, ...change })).toBeUndefined();
  });
});
