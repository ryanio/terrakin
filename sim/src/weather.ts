/**
 * The world's weather: a pure function of the world day and the UTC hour, the way `biomeAt` is of
 * a tile's position. Never world state, never in the input log, and no rule reads it. The server
 * and every client work it out from the same clock (the snapshot's `time`, decision 0011), so
 * everyone sees the same sky.
 *
 * Each UTC day is cut into spells of 3 to 6 hours (the day's last spell runs to midnight, so none
 * is shorter than 3), and each spell's weather is drawn from its season's chances. Snow falls only
 * in winter.
 */
import { type Season, seasonOf } from "./season";

export const WEATHERS = ["clear", "cloudy", "rain", "fog", "snow"] as const;
export type Weather = (typeof WEATHERS)[number];

/** How often each weather comes in a season, out of 100. Snow falls only in winter. */
export const WEATHER_CHANCES: Readonly<Record<Season, Readonly<Record<Weather, number>>>> = {
  spring: { clear: 40, cloudy: 25, rain: 25, fog: 10, snow: 0 },
  summer: { clear: 55, cloudy: 25, rain: 15, fog: 5, snow: 0 },
  autumn: { clear: 30, cloudy: 30, rain: 25, fog: 15, snow: 0 },
  winter: { clear: 25, cloudy: 25, rain: 10, fog: 10, snow: 30 },
};

/** How long a spell of weather lasts, in hours. The day's last spell may run up to `max + min - 1`. */
export const SPELL_HOURS = { min: 3, max: 6 } as const;

const HOUR_MS = 3_600_000;

export interface WeatherSpell {
  /** The UTC hour it starts, and the hour it gives way to the next (24 for midnight). */
  start: number;
  end: number;
  weather: Weather;
}

/** A number from 0 to 1 for one spell of one day, `salt` picking what it's for. */
function roll(day: number, spell: number, salt: number): number {
  let h =
    Math.imul(day, 0x27d4eb2d) ^ Math.imul(spell + 1, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
  // murmur3's finalizer, so neighboring days and spells come out unrelated.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** Where spell `i` of `day`, starting at `start`, ends. Too little left after it: it runs to 24. */
function spellEnd(day: number, i: number, start: number): number {
  const span = SPELL_HOURS.max - SPELL_HOURS.min + 1;
  const end = start + SPELL_HOURS.min + Math.floor(roll(day, i, 1) * span);
  return 24 - end < SPELL_HOURS.min ? 24 : end;
}

function pick(season: Season, r: number): Weather {
  const chances = WEATHER_CHANCES[season];
  let left = r * 100;
  for (const weather of WEATHERS) {
    left -= chances[weather];
    if (left < 0) return weather;
  }
  return "clear";
}

/** One world day's spells of weather, from midnight to midnight UTC. */
export function weatherSpells(day: number): WeatherSpell[] {
  if (!Number.isFinite(day)) return [{ start: 0, end: 24, weather: "clear" }];
  const d = Math.floor(day);
  const season = seasonOf(d);
  const spells: WeatherSpell[] = [];
  for (let i = 0, start = 0; start < 24; i++) {
    const end = spellEnd(d, i, start);
    spells.push({ start, end, weather: pick(season, roll(d, i, 2)) });
    start = end;
  }
  return spells;
}

/**
 * The weather at a UTC hour of a world day. An hour past 23 or before 0 counts into the next or the
 * previous day.
 */
export function weatherAt(day: number, hour: number): Weather {
  const hours = Math.floor(day) * 24 + Math.floor(hour);
  if (!Number.isFinite(hours)) return "clear";
  const d = Math.floor(hours / 24);
  const h = hours - d * 24;
  const season = seasonOf(d);
  for (let i = 0, start = 0; start < 24; i++) {
    const end = spellEnd(d, i, start);
    if (h < end) return pick(season, roll(d, i, 2));
    start = end;
  }
  return "clear";
}

/** The world day and the UTC hour of a moment on a clock (ms since 1970-01-01 UTC). */
export function clockHour(ms: number): { day: number; hour: number } {
  const hours = Math.floor(ms / HOUR_MS);
  const day = Math.floor(hours / 24);
  return { day, hour: hours - day * 24 };
}

/**
 * The sky at a moment on the server's clock: the weather of that UTC hour, and the season of the
 * world's day (`state.day`, which rules read), or of the clock's day while the world counts none.
 */
export function skyAt(ms: number, worldDay?: number): { season: Season; weather: Weather } {
  const { day, hour } = clockHour(ms);
  return { season: seasonOf(worldDay ?? day), weather: weatherAt(day, hour) };
}
