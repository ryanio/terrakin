import { describe, expect, it } from "vitest";
import {
  dayDateWords,
  foundingDay,
  LAUNCH_DAY,
  relativeDayWords,
  worldDayWords,
} from "./day-words";

describe("founding day", () => {
  it("counts from the launch day, 2026-10-04", () => {
    expect(LAUNCH_DAY).toBe(20730);
    expect(foundingDay(20730)).toBe(1);
    expect(foundingDay(20740)).toBe(11); // 2026-10-14
    expect(worldDayWords(20730)).toBe("Day 1 of Terrakin");
    expect(worldDayWords(20740)).toBe("Day 11 of Terrakin");
    expect(worldDayWords(20729)).toBe("before Day 1 of Terrakin");
  });
});

describe("real date", () => {
  it("names the calendar date of a world day, weekday included", () => {
    expect(dayDateWords(0)).toBe("Thu, Jan 1, 1970");
    expect(dayDateWords(20730)).toBe("Sun, Oct 4, 2026");
    expect(dayDateWords(20744)).toBe("Sun, Oct 18, 2026");
  });

  it("leaves the year out only when the day is in today's year", () => {
    const today = 20740; // Wed, Oct 14, 2026
    expect(dayDateWords(20744, today)).toBe("Sun, Oct 18");
    expect(dayDateWords(20818, today)).toBe("Thu, Dec 31");
    expect(dayDateWords(20819, today)).toBe("Fri, Jan 1, 2027");
    expect(dayDateWords(20740, 20819)).toBe("Wed, Oct 14, 2026");
  });
});

describe("relative day", () => {
  it("says the wait, not the number", () => {
    const today = 20740;
    expect(relativeDayWords(today, today)).toBe("today");
    expect(relativeDayWords(today + 1, today)).toBe("tomorrow");
    expect(relativeDayWords(today + 4, today)).toBe("in 4 days");
    expect(relativeDayWords(today - 1, today)).toBe("yesterday");
    expect(relativeDayWords(today - 4, today)).toBe("4 days ago");
  });
});
