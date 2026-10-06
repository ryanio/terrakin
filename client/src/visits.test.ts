import type { PlotView } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import { nextPlot, plotName, stripPlots, VISIT_STRIP, weekLine } from "./visits";

const NOW = Date.UTC(2026, 9, 6, 12);
const DAY = 24 * 60 * 60_000;

/** A plot at (px, 0) owned by `owner`, built past a starter hut and changed an hour ago. */
function plot(px: number, owner: string, extra: Partial<PlotView> = {}): PlotView {
  return {
    px,
    py: 0,
    owner: { id: owner, name: owner, kind: "human", color: "sun", shape: "round", avatar: null },
    coOwners: [],
    changedAt: new Date(NOW - 3_600_000).toISOString(),
    visitors: 0,
    admirers: 0,
    blocks: VISIT_STRIP.starterBlocks + 4,
    displays: 0,
    ...extra,
  };
}

describe("the home wall's plots to visit", () => {
  it("shows real residents' plots worth a look, never yours, and only once there are enough", () => {
    const old = new Date(NOW - (VISIT_STRIP.freshDays + 1) * DAY).toISOString();
    const plots = [
      plot(0, "ivy"),
      plot(1, "me"),
      plot(2, "juniper", { owner: { ...plot(2, "juniper").owner, townsfolk: true } }),
      plot(3, "sam", { blocks: VISIT_STRIP.starterBlocks }),
      plot(4, "lee", { changedAt: old }),
      plot(5, "ash", { changedAt: old, admirers: 1 }),
      plot(6, "kit", { changedAt: null, visitors: 2 }),
    ];
    expect(stripPlots(plots, "me", NOW).map((p) => p.owner.id)).toEqual(["ivy", "ash", "kit"]);
    // With one fewer worth a look, it stays quiet.
    expect(stripPlots(plots.slice(0, 6), "me", NOW)).toEqual([]);
    const many = Array.from({ length: VISIT_STRIP.max + 2 }, (_, i) => plot(i, `r${i}`));
    expect(stripPlots(many, null, NOW)).toHaveLength(VISIT_STRIP.max);
  });
});

describe("next plot", () => {
  const plots = [plot(0, "ivy"), plot(1, "me"), plot(2, "sam", { coOwners: [] }), plot(3, "lee")];

  it("goes to the next plot that isn't yours, and round to the first after the last", () => {
    expect(nextPlot(plots, { px: 0, py: 0 }, "me")?.owner.id).toBe("sam");
    expect(nextPlot(plots, { px: 3, py: 0 }, "me")?.owner.id).toBe("ivy");
    // Not on a plot in the list: the first.
    expect(nextPlot(plots, null, "me")?.owner.id).toBe("ivy");
    expect(nextPlot(plots, { px: 1, py: 0 }, "me")?.owner.id).toBe("ivy");
  });

  it("skips plots shared with you, and finds none when yours is all there is", () => {
    const shared = plot(4, "ada", { coOwners: [plot(0, "me").owner] });
    expect(nextPlot([shared, plot(5, "bo")], null, "me")?.owner.id).toBe("bo");
    expect(nextPlot([plot(1, "me"), plot(0, "ivy")], { px: 0, py: 0 }, "me")).toBeNull();
    expect(nextPlot([plot(1, "me")], null, "me")).toBeNull();
  });
});

describe("plot words", () => {
  it("say who admired and visited this week, in counts", () => {
    expect(weekLine({ admirers: 2, visitors: 5 })).toBe(
      "Admired by 2 neighbors, 5 visitors this week",
    );
    expect(weekLine({ admirers: 1, visitors: 0 })).toBe("Admired by 1 neighbor this week");
    expect(weekLine({ admirers: 0, visitors: 1 })).toBe("1 visitor this week");
    expect(weekLine({ admirers: 0, visitors: 0 })).toBe("No visitors yet this week");
  });

  it("name whose plot it is, owner first", () => {
    expect(plotName(["Ivy"])).toBe("Ivy's plot");
    expect(plotName(["Ivy", "Sam"])).toBe("Ivy and Sam's plot");
    expect(plotName(["Ivy", "Sam", "Lee"])).toBe("Ivy, Sam, and Lee's plot");
  });
});
