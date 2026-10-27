/**
 * Human words for a world day (issue #66). A world day is a count of UTC days since 1970-01-01,
 * which is how storage and the API name it, and no resident should have to read that number.
 * These pure functions of the day own the three ways a surface may show one instead:
 *
 * - relative to today, for anything a resident acts on: "tomorrow", "in 4 days";
 * - the founding-anchored count, where the world names a day: "Day 11 of Terrakin";
 * - the real calendar date, for details: "Sun, Oct 18", with the year when it isn't this year's.
 *
 * Like the season, this is presentation only: never world state, never in the input log, and it
 * never changes what a day means for scheduling or replay.
 */
import { weekdayOf } from "./holiday";
import { dateOfDay, dayOfDate, MONTH_NAMES, WEEKDAY_NAMES } from "./season";

/** The world day Terrakin launched, 2026-10-04: Day 1 of Terrakin. */
export const LAUNCH_DAY = dayOfDate(2026, 10, 4);

/** Which day of Terrakin a world day is: the launch day is 1, and each day after adds one. */
export const foundingDay = (day: number) => day - LAUNCH_DAY + 1;

/**
 * A world day named the world's way: "Day 11 of Terrakin". The world ran before it opened, so a
 * day before the launch day has no number of its own: "before Day 1 of Terrakin".
 */
export const worldDayWords = (day: number) =>
  day < LAUNCH_DAY ? "before Day 1 of Terrakin" : `Day ${foundingDay(day)} of Terrakin`;

/**
 * A world day as its real calendar date: "Sun, Oct 18". The year is added when the day falls in
 * another year than `today`, or when there's no `today` to compare with: "Thu, Jan 1, 1970".
 * World days map 1:1 to real UTC days, so this is exact. Day 0 (1970-01-01) was a Thursday,
 * which anchors the weekday.
 */
export function dayDateWords(day: number, today?: number): string {
  const { year, month, date } = dateOfDay(day);
  const weekday = (WEEKDAY_NAMES[weekdayOf(day)] as string).slice(0, 3);
  const words = `${weekday}, ${MONTH_NAMES[month - 1]?.slice(0, 3)} ${date}`;
  return today !== undefined && dateOfDay(today).year === year ? words : `${words}, ${year}`;
}

/**
 * A world day relative to today, for waits and ready times: "today", "tomorrow", "in 4 days",
 * "yesterday", or "4 days ago".
 */
export function relativeDayWords(day: number, today: number): string {
  const left = day - today;
  if (left === 0) return "today";
  if (left === 1) return "tomorrow";
  if (left > 1) return `in ${left} days`;
  if (left === -1) return "yesterday";
  return `${-left} days ago`;
}
