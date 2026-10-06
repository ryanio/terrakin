import { describe, expect, it } from "vitest";
import {
  dayName,
  HOLIDAY_INFO,
  HOLIDAYS,
  holidayDates,
  holidayLastDay,
  holidayOf,
  holidaySpan,
  nextHolidayStart,
} from "./holiday";
import { dayOfDate } from "./season";

/** Holidays (RFC 0022) by the UTC calendar, from the world's day alone. */

describe("Halloween's dates", () => {
  it("run from October 24 to November 1, both days in it, every year", () => {
    for (const year of [2024, 2026, 2030]) {
      expect(holidayOf(dayOfDate(year, 10, 23)), `${year}`).toBeUndefined();
      expect(holidayOf(dayOfDate(year, 10, 24)), `${year}`).toBe("halloween");
      expect(holidayOf(dayOfDate(year, 10, 31)), `${year}`).toBe("halloween");
      expect(holidayOf(dayOfDate(year, 11, 1)), `${year}`).toBe("halloween");
      expect(holidayOf(dayOfDate(year, 11, 2)), `${year}`).toBeUndefined();
      expect(holidaySpan("halloween", year)).toEqual({
        first: dayOfDate(year, 10, 24),
        last: dayOfDate(year, 11, 1),
      });
    }
    expect(holidayOf(dayOfDate(2026, 6, 15))).toBeUndefined();
    expect(holidayDates("halloween")).toBe("October 24 to November 1");
  });

  it("say when the next one starts and when this one ends", () => {
    expect(nextHolidayStart("halloween", dayOfDate(2026, 10, 6))).toBe(dayOfDate(2026, 10, 24));
    expect(nextHolidayStart("halloween", dayOfDate(2026, 11, 2))).toBe(dayOfDate(2027, 10, 24));
    expect(nextHolidayStart("halloween", dayOfDate(2026, 12, 31))).toBe(dayOfDate(2027, 10, 24));
    expect(holidayLastDay("halloween", dayOfDate(2026, 10, 28))).toBe(dayOfDate(2026, 11, 1));
    expect(dayName(dayOfDate(2026, 10, 24))).toBe("October 24");
  });
});

describe("every holiday", () => {
  it("stays inside one year and never overlaps another, so a day is in one holiday at most", () => {
    const at = ({ month, date }: { month: number; date: number }) => month * 100 + date;
    const spans = HOLIDAYS.map((h) => [at(HOLIDAY_INFO[h].first), at(HOLIDAY_INFO[h].last)]);
    for (const [first, last] of spans) expect(first).toBeLessThanOrEqual(last as number);
    spans.sort((a, b) => (a[0] as number) - (b[0] as number));
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]?.[0]).toBeGreaterThan(spans[i - 1]?.[1] as number);
    }
  });
});
