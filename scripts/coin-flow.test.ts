import { describe, expect, it } from "vitest";
import { jobPayFromTreasury, starterGiftsToday, waits } from "./coin-flow.ts";

describe("starterGiftsToday", () => {
  it("pays the oldest first, each in full, while the purse lasts", () => {
    expect(starterGiftsToday(["a", "b", "c"], 45, 20, 200)).toEqual(["a", "b"]);
    expect(starterGiftsToday(["a", "b"], 19, 20, 200)).toEqual([]);
  });

  it("stops at the give cap", () => {
    expect(starterGiftsToday(["a", "b", "c"], 1000, 20, 40)).toEqual(["a", "b"]);
  });

  it("pays nothing when there's no gift", () => {
    expect(starterGiftsToday(["a"], 100, 0, 200)).toEqual([]);
  });
});

describe("jobPayFromTreasury", () => {
  it("pays in full while the treasury keeps its reserve", () => {
    expect(jobPayFromTreasury(1005, 5, 1000)).toBe(5);
  });

  it("refuses a payment that would dip into the reserve", () => {
    expect(jobPayFromTreasury(1004, 5, 1000)).toBe(0);
    expect(jobPayFromTreasury(0, 5, 1000)).toBe(0);
  });
});

describe("waits", () => {
  it("counts days from owed to paid, and how long the unpaid have waited", () => {
    const owed = new Map([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 5],
    ]);
    const paid = new Map([
      ["a", 0],
      ["b", 4],
      ["c", 2],
    ]);
    expect(waits(owed, paid, 9)).toEqual({
      paid: 3,
      waiting: 1,
      oldest: 4,
      median: 0,
      p90: 3,
      max: 3,
      sameDay: 2,
    });
  });
});
