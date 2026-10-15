import { describe, expect, it } from "vitest";
import {
  dayName,
  HOLIDAY_INFO,
  HOLIDAYS,
  holidayDates,
  holidayLastDay,
  holidaySpan,
  holidaysOf,
  nextHolidayStart,
  nextRunOf,
  runOf,
  spanIn,
  weekdayOf,
} from "./holiday";
import { dayOfDate } from "./season";

/** Holidays (RFC 0022) by the UTC calendar, from the world's day alone. */

describe("Halloween's dates", () => {
  it("run from October 24 to November 1, both days in it, every year", () => {
    for (const year of [2024, 2026, 2030]) {
      expect(holidaysOf(dayOfDate(year, 10, 23)), `${year}`).toEqual([]);
      expect(holidaysOf(dayOfDate(year, 10, 24)), `${year}`).toEqual(["halloween"]);
      expect(holidaysOf(dayOfDate(year, 10, 31)), `${year}`).toEqual(["halloween"]);
      expect(holidaysOf(dayOfDate(year, 11, 1)), `${year}`).toEqual(["halloween"]);
      expect(holidaysOf(dayOfDate(year, 11, 2)), `${year}`).toEqual([]);
      expect(holidaySpan("halloween", year)).toEqual({
        first: dayOfDate(year, 10, 24),
        last: dayOfDate(year, 11, 1),
      });
    }
    expect(holidaysOf(dayOfDate(2026, 6, 15))).toEqual([]);
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

describe("span rules (RFC 0034)", () => {
  const day = (year: number, month: number, date: number) => dayOfDate(year, month, date);

  it("know the weekday of a world day, with 1970-01-01 a Thursday", () => {
    expect(weekdayOf(0)).toBe(4);
    expect(weekdayOf(day(2026, 10, 15))).toBe(4);
    expect(weekdayOf(day(2026, 11, 1))).toBe(0);
    expect(weekdayOf(-1)).toBe(3);
  });

  it("find the nth weekday of a month, with days either side", () => {
    const fourthThursday = { weekday: { month: 11, weekday: 4, nth: 4 }, from: -3, to: 3 };
    expect(spanIn(fourthThursday, 2026)).toEqual({
      first: day(2026, 11, 23),
      last: day(2026, 11, 29),
    });
    expect(spanIn(fourthThursday, 2027)).toEqual({
      first: day(2027, 11, 22),
      last: day(2027, 11, 28),
    });
    // November 1, 2028 is a Wednesday, so its fourth Thursday is the 23rd.
    expect(spanIn(fourthThursday, 2028)).toEqual({
      first: day(2028, 11, 20),
      last: day(2028, 11, 26),
    });
  });

  it("read a table's first date for the year, and have no run in a year it lacks", () => {
    const table = {
      table: { 2026: { month: 12, date: 4 }, 2027: { month: 12, date: 24 } },
      length: 8,
    };
    expect(spanIn(table, 2026)).toEqual({ first: day(2026, 12, 4), last: day(2026, 12, 11) });
    expect(spanIn(table, 2027)).toEqual({ first: day(2027, 12, 24), last: day(2027, 12, 31) });
    expect(spanIn(table, 2028)).toBeUndefined();
  });

  it("let fixed dates run into the next year when the last comes before the first", () => {
    const newYear = { fixed: { first: { month: 12, date: 26 }, last: { month: 1, date: 1 } } };
    expect(spanIn(newYear, 2026)).toEqual({ first: day(2026, 12, 26), last: day(2027, 1, 1) });
  });

  it("find the run a day is in across a year end, and none past a table's last year", () => {
    const newYear = { fixed: { first: { month: 12, date: 26 }, last: { month: 1, date: 1 } } };
    const run = { first: day(2026, 12, 26), last: day(2027, 1, 1) };
    expect(runOf(newYear, day(2027, 1, 1))).toEqual(run);
    expect(runOf(newYear, day(2026, 12, 26))).toEqual(run);
    expect(runOf(newYear, day(2027, 1, 2))).toBeUndefined();
    expect(nextRunOf(newYear, day(2027, 1, 2))?.first).toBe(day(2027, 12, 26));
    const table = { table: { 2026: { month: 12, date: 4 } }, length: 8 };
    expect(runOf(table, day(2026, 12, 11))?.first).toBe(day(2026, 12, 4));
    expect(nextRunOf(table, day(2026, 12, 12))).toBeUndefined();
    // A weekday rule early in January with days before it starts in December.
    const early = { weekday: { month: 1, weekday: 0, nth: 1 }, from: -5, to: 0 };
    const jan = spanIn(early, 2027);
    expect(jan && jan.first < day(2027, 1, 1)).toBe(true);
    expect(runOf(early, jan?.first ?? 0)).toEqual(jan);
  });
});

describe("every holiday", () => {
  it("runs for less than a year each time", () => {
    const wrong: string[] = [];
    for (const holiday of HOLIDAYS) {
      for (let year = 2024; year <= 2040; year++) {
        const run = spanIn(HOLIDAY_INFO[holiday].span, year);
        if (!run) continue;
        if (run.last < run.first || run.last - run.first >= 365)
          wrong.push(`${holiday} ${year}: length`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
