/**
 * The world's seasons. A season is a pure function of the world's day (UTC days since 1970-01-01,
 * from `new_day`): never world state and never in the input log. Same day, same season, on every
 * client and on every replay.
 *
 * Seasons follow the calendar months in the north: spring is March to May, summer June to August,
 * autumn September to November, and winter December to February. One world, one calendar.
 *
 * The date math is Howard Hinnant's `civil_from_days` and `days_from_civil`, so nothing here reads
 * a clock or a host `Date`.
 */
export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

/** A calendar date in UTC. `month` is 1 to 12 and `date` is 1 to 31. */
export interface WorldDate {
  year: number;
  month: number;
  date: number;
}

/** The UTC calendar date of a world day. */
export function dateOfDay(day: number): WorldDate {
  const z = day + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const date = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, date };
}

/** The world day of a UTC calendar date. */
export function dayOfDate(year: number, month: number, date: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + date - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The month each season starts in. Winter starts in December and runs into the next year. */
const FIRST_MONTH: Record<Season, number> = { spring: 3, summer: 6, autumn: 9, winter: 12 };

/** The season a world day falls in. */
export function seasonOf(day: number): Season {
  const { month } = dateOfDay(day);
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "autumn";
  return "winter";
}

/**
 * The season a world day falls in, with its first day and the first day of the next season
 * (`end` is not part of it). `(day - start) / (end - start)` is how far through the season it is.
 */
export function seasonSpan(day: number): { season: Season; start: number; end: number } {
  const season = seasonOf(day);
  const { year, month } = dateOfDay(day);
  const startYear = season === "winter" && month <= 2 ? year - 1 : year;
  const first = FIRST_MONTH[season];
  const start = dayOfDate(startYear, first, 1);
  const end = first === 12 ? dayOfDate(startYear + 1, 3, 1) : dayOfDate(startYear, first + 3, 1);
  return { season, start, end };
}
