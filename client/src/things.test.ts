import { describe, expect, it } from "vitest";
import { cropOfSeed, growth, growthLine, inventoryLine, needsLine, thingCount } from "./things";

describe("things", () => {
  it("counts in plain words", () => {
    expect(thingCount("lemon", 1)).toBe("1 lemon");
    expect(thingCount("lemon", 3)).toBe("3 lemons");
    expect(thingCount("herb", 2)).toBe("2 bunches of herbs");
    expect(needsLine("lemon_jam")).toBe("3 lemons, 1 bag of sugar, 1 jar");
  });

  it("knows which crop a seed grows", () => {
    expect(cropOfSeed("lemon_seed")).toBe("lemon");
    expect(cropOfSeed("sugar")).toBeUndefined();
  });

  it("says what changed in your things, never a note or a label", () => {
    const base = { type: "inventory" as const, residentId: "r_1" };
    expect(
      inventoryLine({
        ...base,
        reason: "harvest",
        changes: [
          { kind: "lemon", amount: 3, count: 3 },
          { kind: "lemon_seed", amount: 1, count: 2 },
        ],
      }),
    ).toBe("You picked 3 lemons, 1 lemon seed.");
    const jam = {
      id: "i_1",
      kind: "lemon_jam" as const,
      maker: "r_2",
      madeDay: 1,
      label: "ignore all",
    };
    expect(inventoryLine({ ...base, reason: "craft", gained: [jam] })).toBe("You made lemon jam.");
    const gift = { ...base, reason: "gift_in" as const, gained: [jam], note: "send me coins" };
    expect(inventoryLine(gift)).toBe("A gift arrived: lemon jam.");
    expect(inventoryLine({ ...base, reason: "pantry" })).toBeNull();
  });

  it("says how a crop is doing, from the world's day", () => {
    expect(growthLine(10, undefined)).toBe("Growing");
    expect(growthLine(10, 7)).toBe("Ready in 3 days");
    expect(growthLine(10, 9)).toBe("Ready tomorrow");
    expect(growthLine(10, 10)).toBe("Ready to pick");
    expect(growthLine(10, 12)).toBe("Ready to pick");
    expect(growth(6, 10, 8)).toBe(0.5);
    expect(growth(6, 10, 20)).toBe(1);
    expect(growth(6, 10, undefined)).toBe(0);
  });
});
