import { describe, expect, it } from "vitest";
import { dayOfDate, SEASONS, seasonOf } from "./season";
import {
  clockHour,
  SPELL_HOURS,
  WEATHER_CHANCES,
  WEATHERS,
  type Weather,
  weatherAt,
  weatherSpells,
} from "./weather";

/** Every world day from `from` up to, not including, `to`. */
function* days(from: number, to: number) {
  for (let day = from; day < to; day++) yield day;
}

const FOUR_YEARS = [dayOfDate(2026, 1, 1), dayOfDate(2030, 1, 1)] as const;

describe("the weather", () => {
  it("is a known weather at a known moment", () => {
    // 2026-10-06, an autumn day.
    expect(weatherSpells(20732)).toEqual([
      { start: 0, end: 6, weather: "clear" },
      { start: 6, end: 10, weather: "cloudy" },
      { start: 10, end: 16, weather: "clear" },
      { start: 16, end: 24, weather: "fog" },
    ]);
    expect(weatherAt(20732, 7)).toBe("cloudy");
    expect(weatherAt(20732, 23)).toBe("fog");
    // An hour past the end of a day is the next day's first hour.
    expect(weatherAt(20732, 24)).toBe(weatherAt(20733, 0));
    expect(weatherAt(20733, -1)).toBe("fog");
  });

  it("reads the world day and the UTC hour off a clock", () => {
    expect(clockHour(Date.UTC(2026, 9, 6, 14, 30))).toEqual({ day: 20732, hour: 14 });
    expect(clockHour(Date.UTC(2026, 9, 6, 0, 0) - 1)).toEqual({ day: 20731, hour: 23 });
  });

  it("snows only in winter, and does snow then", () => {
    let snowy = 0;
    for (const day of days(...FOUR_YEARS)) {
      for (const spell of weatherSpells(day)) {
        if (spell.weather !== "snow") continue;
        expect(seasonOf(day)).toBe("winter");
        snowy++;
      }
    }
    expect(snowy).toBeGreaterThan(300);
    for (const season of SEASONS) {
      if (season !== "winter") expect(WEATHER_CHANCES[season].snow).toBe(0);
    }
  });

  it("comes in spells of three hours or more that cover the day, so it never flickers", () => {
    for (const day of days(...FOUR_YEARS)) {
      const spells = weatherSpells(day);
      expect(spells[0]?.start).toBe(0);
      expect(spells.at(-1)?.end).toBe(24);
      for (const [i, spell] of spells.entries()) {
        expect(spell.start).toBe(i === 0 ? 0 : spells[i - 1]?.end);
        expect(spell.end - spell.start).toBeGreaterThanOrEqual(SPELL_HOURS.min);
        expect(spell.end - spell.start).toBeLessThanOrEqual(SPELL_HOURS.max + SPELL_HOURS.min - 1);
        for (let hour = spell.start; hour < spell.end; hour++)
          expect(weatherAt(day, hour)).toBe(spell.weather);
      }
    }
  });

  it("comes about as often as its season's chances say", () => {
    const none = () => ({ clear: 0, cloudy: 0, rain: 0, fog: 0, snow: 0 });
    const hours = { spring: none(), summer: none(), autumn: none(), winter: none() };
    for (const day of days(...FOUR_YEARS)) {
      const counts = hours[seasonOf(day)];
      for (const spell of weatherSpells(day)) counts[spell.weather] += spell.end - spell.start;
    }
    for (const season of SEASONS) {
      const counts: Record<Weather, number> = hours[season];
      const total = WEATHERS.reduce((sum, w) => sum + counts[w], 0);
      const chances = WEATHER_CHANCES[season];
      expect(WEATHERS.reduce((sum, w) => sum + chances[w], 0)).toBe(100);
      for (const w of WEATHERS)
        expect(Math.abs((100 * counts[w]) / total - chances[w]), `${season} ${w}`).toBeLessThan(5);
    }
  });
});
