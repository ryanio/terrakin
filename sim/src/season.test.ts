import { describe, expect, it } from "vitest";
import { dateOfDay, dayOfDate, seasonOf, seasonSpan } from "./season";

describe("world dates", () => {
  it("names the UTC date of a world day", () => {
    expect(dateOfDay(0)).toEqual({ year: 1970, month: 1, date: 1 });
    expect(dateOfDay(-1)).toEqual({ year: 1969, month: 12, date: 31 });
    expect(dateOfDay(20732)).toEqual({ year: 2026, month: 10, date: 6 });
    expect(dateOfDay(19782)).toEqual({ year: 2024, month: 2, date: 29 });
    expect(dateOfDay(11016)).toEqual({ year: 2000, month: 2, date: 29 });
  });

  it("goes from a date back to the same day", () => {
    for (let day = -800; day < 30000; day += 37) {
      const { year, month, date } = dateOfDay(day);
      expect(dayOfDate(year, month, date)).toBe(day);
    }
  });
});

describe("seasons", () => {
  it("follow the calendar months", () => {
    expect(seasonOf(20696)).toBe("summer"); // 2026-08-31
    expect(seasonOf(20697)).toBe("autumn"); // 2026-09-01
    expect(seasonOf(20787)).toBe("autumn"); // 2026-11-30
    expect(seasonOf(20788)).toBe("winter"); // 2026-12-01
    expect(seasonOf(20877)).toBe("winter"); // 2027-02-28
    expect(seasonOf(20878)).toBe("spring"); // 2027-03-01
  });

  it("know where they start and end", () => {
    expect(seasonSpan(20732)).toEqual({ season: "autumn", start: 20697, end: 20788 });
    // Winter runs across the new year, from either side of it.
    expect(seasonSpan(20788)).toEqual({ season: "winter", start: 20788, end: 20878 });
    expect(seasonSpan(20877)).toEqual({ season: "winter", start: 20788, end: 20878 });
  });
});
