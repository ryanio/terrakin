import { describe, expect, it } from "vitest";
import { HOLIDAY_INFO, hanukkahNight, holidaysOf, inHoliday, nextHolidayStart } from "./holiday";
import { dayOfDate } from "./season";

/**
 * Hanukkah (RFC 0034): eight days from the first candle's evening, from a table of dates that follow
 * the Hebrew calendar, running beside Midwinter and into the next year when the calendar says so.
 */

const day = (y: number, m: number, d: number) => dayOfDate(y, m, d);

describe("Hanukkah's days", () => {
  it("run eight days from the first candle, by the table, with the night counted", () => {
    expect(inHoliday("hanukkah", day(2026, 12, 3))).toBe(false);
    expect(hanukkahNight(day(2026, 12, 4))).toBe(1);
    expect(hanukkahNight(day(2026, 12, 11))).toBe(8);
    expect(hanukkahNight(day(2026, 12, 12))).toBe(0);
    expect(nextHolidayStart("hanukkah", day(2026, 12, 12))).toBe(day(2027, 12, 24));
  });

  it("run beside Midwinter, and the one that started first comes first", () => {
    expect(holidaysOf(day(2027, 12, 25))).toEqual(["midwinter", "hanukkah"]);
    // New Year's starts on December 26, after both, and runs on into January 1 alone.
    expect(holidaysOf(day(2027, 12, 26))).toEqual(["midwinter", "hanukkah", "new_year"]);
    expect(holidaysOf(day(2027, 12, 31))).toEqual(["midwinter", "hanukkah", "new_year"]);
    expect(holidaysOf(day(2028, 1, 1))).toEqual(["new_year"]);
    expect(holidaysOf(day(2028, 1, 2))).toEqual([]);
    expect(hanukkahNight(day(2027, 12, 31))).toBe(8);
  });

  it("have dates at least three years ahead of today, so the table is extended in time", () => {
    // The sim never reads a clock; this test does, to say when the table needs more years.
    const span = HOLIDAY_INFO.hanukkah.span;
    if (!("table" in span)) throw new Error("Hanukkah's dates are a table");
    const last = Math.max(...Object.keys(span.table).map(Number));
    expect(last - new Date().getUTCFullYear()).toBeGreaterThanOrEqual(3);
  });
});
