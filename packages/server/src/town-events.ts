import {
  DAY_MS,
  dateOfDay,
  EVENTS,
  type EventKind,
  FEAST,
  type Holiday,
  holidaySpan,
  MINUTE_MS,
} from "@terrakin/sim";

/**
 * The town's own calendar (RFC 0010, decision 0081). The minute sweep logs each event here once,
 * as `schedule_town_event`, as soon as its day is inside the booking window, and the sim refuses a
 * second one with the same `key`, so restarts never log it twice. A town event is in the Commons,
 * holds no deposit, and counts for no host.
 */
export interface TownEvent {
  /** Lowercase letters, digits, and dashes. Never reuse one. */
  key: string;
  kind: EventKind;
  title: string;
  text: string;
  /** When it starts, ISO 8601 with its zone, on a whole minute. */
  startsAt: string;
  minutes: number;
  /** Handles of townsfolk who are its face. One that doesn't name a townsfolk resident is left out. */
  faces?: readonly string[];
}

/** The town's one-off events, each on its own date. */
export const TOWN_EVENTS: readonly TownEvent[] = [
  {
    // The last evening of October 2026, closing out autumn: evening in Europe, then the Americas.
    key: "harvest-night-2026",
    kind: "gathering",
    title: "Harvest night",
    text: "Lanterns in the Commons to see autumn out. Drop in for an hour any time between 18:00 and 03:00 UTC: that's the evening in Europe, then in the Americas. Bring someone.",
    startsAt: "2026-10-31T18:00:00Z",
    minutes: 540,
    faces: ["juniper", "clem"],
  },
];

/**
 * A town event that comes back every week at the same UTC hour (decision 0275). Each week is its
 * own `TownEvent`, keyed `<key>-<YYYY-MM-DD>` by the UTC day it starts, so a week's key never
 * changes and a restart never logs it twice.
 */
export interface WeeklyTownEvent extends Omit<TownEvent, "startsAt"> {
  /** The first week's start, ISO 8601 with its zone, on a whole minute. Each later one is 7 days on. */
  first: string;
}

/** The town's weekly events. */
export const WEEKLY_TOWN_EVENTS: readonly WeeklyTownEvent[] = [
  {
    // Sunday 19:00 UTC: the evening in Europe, the afternoon across the Americas.
    key: "sunday-gathering",
    kind: "gathering",
    title: "Sunday gathering",
    text: "The whole town in the Commons for an hour, every Sunday at 19:00 UTC: that's the evening in Europe and the afternoon in the Americas. Come say hello, show a neighbor what you made, and bring someone.",
    first: "2026-10-18T19:00:00Z",
    minutes: 60,
    faces: ["clem", "pip"],
  },
];

/**
 * A town event on a holiday that moves with the calendar (RFC 0034): each year's is its own
 * `TownEvent`, keyed `<key>-<YYYY>` by the year its holiday's run starts, on the day `day` days
 * after the run's first day, at `at` UTC.
 */
export interface HolidayTownEvent extends Omit<TownEvent, "startsAt"> {
  holiday: Holiday;
  /** Days after the holiday's first day. */
  day: number;
  /** The UTC time it starts, `HH:MM`. */
  at: string;
}

/** The town's holiday events. */
const HOLIDAY_TOWN_EVENTS: readonly HolidayTownEvent[] = [
  {
    // Thanksgiving's Thursday, evening in Europe, then the Americas (RFC 0034).
    holiday: "thanksgiving",
    day: FEAST.dayOfFeast,
    at: "18:00",
    key: "thanksgiving-feast",
    kind: "gathering",
    title: "Thanksgiving feast",
    text: "The town's long table in the Commons. Bring one dish you made, a pie, a jam, a soup, or something sweet, and set it out for everyone. Drop in any time between 18:00 and 03:00 UTC.",
    minutes: 540,
    faces: ["clem", "otis"],
  },
  {
    // New Year's Eve, from 23:00 UTC across midnight UTC, one moment the whole world shares (RFC 0034).
    holiday: "new_year",
    day: 5,
    at: "23:00",
    key: "new-years-eve",
    kind: "gathering",
    title: "New Year's Eve",
    text: "The town in the Commons as the year turns, at midnight UTC: the evening in the Americas and the small hours in Europe. Bring a firework or two.",
    minutes: 120,
    faces: ["juniper", "marlo"],
  },
];

const WEEK_MS = 7 * DAY_MS;

/** Each year's run of `e` that starts after `now` and no further out than `aheadMs`. */
function holidayRuns(e: HolidayTownEvent, now: number, aheadMs: number): TownEvent[] {
  const { holiday, day, at, ...rest } = e;
  const [h = 0, m = 0] = at.split(":").map(Number);
  const year = dateOfDay(Math.floor(now / DAY_MS)).year;
  return [year - 1, year, year + 1].flatMap((y) => {
    const run = holidaySpan(holiday, y);
    if (!run) return [];
    const start = (run.first + day) * DAY_MS + (h * 60 + m) * MINUTE_MS;
    if (start <= now || start > now + aheadMs) return [];
    return [{ ...rest, key: `${e.key}-${y}`, startsAt: new Date(start).toISOString() }];
  });
}

/** Whether two town events would share the Commons, gap included. */
function clash(a: TownEvent, b: TownEvent): boolean {
  const gap = EVENTS.gapMinutes * MINUTE_MS;
  const start = (e: TownEvent) => Date.parse(e.startsAt);
  const end = (e: TownEvent) => start(e) + e.minutes * MINUTE_MS;
  return start(a) < end(b) + gap && start(b) < end(a) + gap;
}

/**
 * The town's calendar as it stands at `now`: every one-off event, each holiday event's runs and
 * each weekly event's weeks that start after `now` and no further out than the booking window
 * reaches, less any week that would share the Commons with a one-off or holiday event, which keeps
 * its evening.
 */
export function townCalendar(
  now: number,
  oneOffs: readonly TownEvent[] = TOWN_EVENTS,
  weekly: readonly WeeklyTownEvent[] = WEEKLY_TOWN_EVENTS,
  holidays: readonly HolidayTownEvent[] = HOLIDAY_TOWN_EVENTS,
): TownEvent[] {
  const aheadMs = (EVENTS.aheadDays + 1) * DAY_MS;
  const oneOff = [...oneOffs, ...holidays.flatMap((e) => holidayRuns(e, now, aheadMs))];
  const weeks: TownEvent[] = [];
  for (const { first, ...w } of weekly) {
    const from = Date.parse(first);
    for (let i = Math.max(0, Math.ceil((now - from) / WEEK_MS)); ; i++) {
      const at = from + i * WEEK_MS;
      if (at > now + aheadMs) break;
      if (at <= now) continue;
      const startsAt = new Date(at).toISOString();
      const week = { ...w, key: `${w.key}-${startsAt.slice(0, 10)}`, startsAt };
      if (!oneOff.some((e) => clash(e, week))) weeks.push(week);
    }
  }
  return [...oneOff, ...weeks];
}
