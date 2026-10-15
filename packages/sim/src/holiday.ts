/**
 * Holidays (RFC 0022, RFC 0034): dated windows inside the calendar, finer than seasons. Each holiday
 * has a span rule that gives its first and last UTC day in any year: fixed dates, the nth weekday of
 * a month with days either side, or a table of first dates. Like the season, it's a pure function of
 * the world's day (`dateOfDay`): never world state and never in the input log, so a replay sees the
 * same holidays on the same day.
 *
 * A holiday can bring shop stock sold only while it runs (`HOLIDAY_STOCK` in `shop.ts`), recipes
 * that are useful then, and small rules of its own, like Halloween's trick-or-treating
 * (`halloween.ts`). A run may cross into the next year, and two holidays may run on the same day,
 * so a rule asks `inHoliday` about the one it cares about, and `holidaysOf` lists them all.
 */
import { dateOfDay, dayOfDate } from "./season";

/** Every holiday. New ones go on the end. */
export const HOLIDAYS = ["halloween", "midwinter"] as const;
export type Holiday = (typeof HOLIDAYS)[number];

/** A day of the year: `month` is 1 to 12 and `date` is 1 to 31. */
export interface MonthDate {
  month: number;
  date: number;
}

/**
 * How a holiday's days are found in a year. A run starts in the year it's asked for and may end in
 * the next one.
 *
 * - `fixed`: from `first` to `last`, the same dates every year. A `last` earlier in the year than
 *   `first` is in the next year.
 * - `weekday`: the `nth` `weekday` (0 is Sunday) of `month`, from `from` days before it (a negative
 *   number) to `to` days after it.
 * - `table`: the first date in each year the table has, for `length` days. A year it lacks has no
 *   run.
 */
export type HolidaySpan =
  | { fixed: { first: MonthDate; last: MonthDate } }
  | { weekday: { month: number; weekday: number; nth: number }; from: number; to: number }
  | { table: Readonly<Record<number, MonthDate>>; length: number };

export interface HolidayInfo {
  /** Its name in plain words: "Halloween". */
  name: string;
  /** How its days are found. */
  span: HolidaySpan;
}

/**
 * Each holiday's days. Halloween runs from October 24 to November 1: a week to dress up and get
 * ready, October 31 itself, and the morning after, which is still the evening of October 31 in the
 * Americas. Midwinter runs from December 21, the longest night in the north, to December 31.
 */
export const HOLIDAY_INFO: Readonly<Record<Holiday, HolidayInfo>> = {
  halloween: {
    name: "Halloween",
    span: { fixed: { first: { month: 10, date: 24 }, last: { month: 11, date: 1 } } },
  },
  midwinter: {
    name: "Midwinter",
    span: { fixed: { first: { month: 12, date: 21 }, last: { month: 12, date: 31 } } },
  },
};

/** The world day of `on` in `year`. */
const dayOn = (year: number, on: MonthDate) => dayOfDate(year, on.month, on.date);

/** The weekday of a world day, 0 for Sunday to 6 for Saturday. 1970-01-01, day 0, was a Thursday. */
export const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7;

/** A run of a holiday: its first and last world day, both in it. */
export interface HolidayRun {
  first: number;
  last: number;
}

/** The run of `span` that starts in `year`, or undefined when a table has no date for that year. */
export function spanIn(span: HolidaySpan, year: number): HolidayRun | undefined {
  if ("fixed" in span) {
    const { first, last } = span.fixed;
    const lastYear =
      last.month * 100 + last.date < first.month * 100 + first.date ? year + 1 : year;
    return { first: dayOn(year, first), last: dayOn(lastYear, last) };
  }
  if ("weekday" in span) {
    const { month, weekday, nth } = span.weekday;
    const firstOfMonth = dayOfDate(year, month, 1);
    const day = firstOfMonth + ((weekday - weekdayOf(firstOfMonth) + 7) % 7) + 7 * (nth - 1);
    return { first: day + span.from, last: day + span.to };
  }
  const on = span.table[year];
  if (!on) return undefined;
  const first = dayOn(year, on);
  return { first, last: first + span.length - 1 };
}

/** `holiday`'s run that starts in `year`, or undefined when it has none that year. */
export const holidaySpan = (holiday: Holiday, year: number): HolidayRun | undefined =>
  spanIn(HOLIDAY_INFO[holiday].span, year);

/**
 * The run of `span` that `day` is in, or undefined on a day outside it. It looks at the runs asked
 * for the year before, the day's year, and the year after: a run may cross into the next year, and
 * a weekday rule early in January with days before it starts in December.
 */
export function runOf(span: HolidaySpan, day: number): HolidayRun | undefined {
  const { year } = dateOfDay(day);
  for (const y of [year - 1, year, year + 1]) {
    const run = spanIn(span, y);
    if (run && day >= run.first && day <= run.last) return run;
  }
  return undefined;
}

/** The next run of `span` that hasn't started by `day`, or undefined when a table runs out. */
export function nextRunOf(span: HolidaySpan, day: number): HolidayRun | undefined {
  const { year } = dateOfDay(day);
  for (const y of [year, year + 1, year + 2]) {
    const run = spanIn(span, y);
    if (run && run.first > day) return run;
  }
  return undefined;
}

/** The run of `holiday` that `day` is in, or undefined on a day outside it. */
export const holidayRun = (holiday: Holiday, day: number): HolidayRun | undefined =>
  runOf(HOLIDAY_INFO[holiday].span, day);

/** Whether `day` is in `holiday`. */
export const inHoliday = (holiday: Holiday, day: number) => holidayRun(holiday, day) !== undefined;

const nextRun = (holiday: Holiday, day: number) => nextRunOf(HOLIDAY_INFO[holiday].span, day);

/** Every holiday running on `day`, the one that started first first, and none on an ordinary day. */
export function holidaysOf(day: number): Holiday[] {
  const on = HOLIDAYS.flatMap((holiday) => {
    const run = holidayRun(holiday, day);
    return run ? [{ holiday, first: run.first }] : [];
  });
  return on.sort((a, b) => a.first - b.first).map((h) => h.holiday);
}

/**
 * The holidays a world day falls in, as `GET /v1/world` and the check-in carry them: `{holidays}`
 * while one or more run, and nothing on an ordinary day or before the world counts days.
 */
export function holidaysField(day: number | undefined): { holidays?: Holiday[] } {
  const holidays = day === undefined ? [] : holidaysOf(day);
  return holidays.length > 0 ? { holidays } : {};
}

/** The first day of `holiday`'s next run that hasn't started by `day`, or undefined if none is known. */
export const nextHolidayStart = (holiday: Holiday, day: number): number | undefined =>
  nextRun(holiday, day)?.first;

/**
 * The last day of the run of `holiday` that `day` is in, or of its next run on a day outside it
 * (`day` itself when none is known).
 */
export const holidayLastDay = (holiday: Holiday, day: number): number =>
  (holidayRun(holiday, day) ?? nextRun(holiday, day))?.last ?? day;

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

/** "October 31": a day of the year in words. */
export const monthDateName = (on: MonthDate) => `${MONTHS[on.month - 1]} ${on.date}`;

/**
 * "October 24 to November 1": a holiday's dates in words, for the run `day` is in or the next one.
 * A holiday with fixed dates says them without a day. One that moves needs a day, and says "its
 * days" when no date for it is known.
 */
export function holidayDates(holiday: Holiday, day?: number): string {
  const { span } = HOLIDAY_INFO[holiday];
  if ("fixed" in span)
    return `${monthDateName(span.fixed.first)} to ${monthDateName(span.fixed.last)}`;
  const run = day === undefined ? undefined : (holidayRun(holiday, day) ?? nextRun(holiday, day));
  return run ? `${dayName(run.first)} to ${dayName(run.last)}` : "its days";
}
