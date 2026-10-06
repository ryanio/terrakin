/**
 * Holidays (RFC 0022): dated windows inside the calendar, finer than seasons. A holiday runs from a
 * first to a last UTC date, both included, every year. Like the season, it's a pure function of
 * the world's day (`dateOfDay`): never world state and never in the input log, so a replay sees
 * the same holiday on the same day.
 *
 * A holiday can bring shop stock sold only while it runs (`HOLIDAY_STOCK` in `shop.ts`), recipes
 * that are useful then, and small rules of its own, like Halloween's trick-or-treating
 * (`halloween.ts`). Holidays never overlap and never run into the next year, so a day is in one
 * holiday at most.
 */
import { dateOfDay, dayOfDate } from "./season";

/** Every holiday, in calendar order. New ones go on the end. */
export const HOLIDAYS = ["halloween", "midwinter"] as const;
export type Holiday = (typeof HOLIDAYS)[number];

/** A day of the year: `month` is 1 to 12 and `date` is 1 to 31. */
export interface MonthDate {
  month: number;
  date: number;
}

export interface HolidayInfo {
  /** Its name in plain words: "Halloween". */
  name: string;
  /** Its first UTC date. */
  first: MonthDate;
  /** Its last UTC date, which is part of it. */
  last: MonthDate;
}

/**
 * Each holiday's dates. Halloween runs from October 24 to November 1: a week to dress up and get
 * ready, October 31 itself, and the morning after, which is still the evening of October 31 in the
 * Americas. Midwinter runs from December 21, the longest night in the north, to December 31, the
 * last night of the year, and stops there, since a holiday never runs into the next year.
 */
export const HOLIDAY_INFO: Readonly<Record<Holiday, HolidayInfo>> = {
  halloween: { name: "Halloween", first: { month: 10, date: 24 }, last: { month: 11, date: 1 } },
  midwinter: { name: "Midwinter", first: { month: 12, date: 21 }, last: { month: 12, date: 31 } },
};

/** The world day of `on` in `year`. */
export const dayOn = (year: number, on: MonthDate) => dayOfDate(year, on.month, on.date);

/** A holiday's first and last world day in `year`. */
export function holidaySpan(holiday: Holiday, year: number): { first: number; last: number } {
  const { first, last } = HOLIDAY_INFO[holiday];
  return { first: dayOn(year, first), last: dayOn(year, last) };
}

/** The holiday a world day falls in, or undefined on an ordinary day. */
export function holidayOf(day: number): Holiday | undefined {
  const { year } = dateOfDay(day);
  return HOLIDAYS.find((holiday) => {
    const { first, last } = holidaySpan(holiday, year);
    return day >= first && day <= last;
  });
}

/**
 * The holiday a world day falls in, as `GET /v1/world` and the check-in carry it: `{holiday}` while
 * one runs, and nothing on an ordinary day or before the world counts days.
 */
export function holidayField(day: number | undefined): { holiday?: Holiday } {
  const holiday = day === undefined ? undefined : holidayOf(day);
  return holiday ? { holiday } : {};
}

/** Whether `day` is in `holiday`. */
export const inHoliday = (holiday: Holiday, day: number) => holidayOf(day) === holiday;

/**
 * The first day of `holiday`'s next run that hasn't started by `day`: this year's if it's still to
 * come, else next year's.
 */
export function nextHolidayStart(holiday: Holiday, day: number): number {
  const { year } = dateOfDay(day);
  const { first } = holidaySpan(holiday, year);
  return first > day ? first : holidaySpan(holiday, year + 1).first;
}

/** The last day of the run of `holiday` that `day` is in. Only for a day inside it. */
export const holidayLastDay = (holiday: Holiday, day: number) =>
  holidaySpan(holiday, dateOfDay(day).year).last;

/** The next world day that is `on` (`day` itself when it is). */
export function nextDayOn(on: MonthDate, day: number): number {
  const { year } = dateOfDay(day);
  const here = dayOn(year, on);
  return here >= day ? here : dayOn(year + 1, on);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "October 24", for a world day. */
export function dayName(day: number): string {
  const { month, date } = dateOfDay(day);
  return `${MONTHS[month - 1]} ${date}`;
}

/** "October 24 to November 1": a holiday's dates in words. */
export function holidayDates(holiday: Holiday): string {
  const { first, last } = HOLIDAY_INFO[holiday];
  return `${MONTHS[first.month - 1]} ${first.date} to ${MONTHS[last.month - 1]} ${last.date}`;
}
