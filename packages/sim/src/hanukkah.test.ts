import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { HOLIDAY_INFO, hanukkahNight, holidaysOf, inHoliday, nextHolidayStart } from "./holiday";
import { dayOfDate } from "./season";
import { fund } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldConfig, type WorldState } from "./types";
import { createWorld } from "./world";

/**
 * Hanukkah (RFC 0034): eight days from the first candle's evening, from a table of dates that follow
 * the Hebrew calendar, running beside Midwinter and into the next year when the calendar says so.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const day = (y: number, m: number, d: number) => dayOfDate(y, m, d);

function shopOn(onDay: number): WorldState {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day: onDay },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
  ] as Command[]) {
    apply(state, { actor: TOWN_ACTOR, command });
  }
  apply(state, { actor: "ada", command: { type: "join", name: "ada", kind: "human" } });
  fund(state, "ada", 50);
  return state;
}

describe("Hanukkah's days", () => {
  it("run eight days from the first candle, by the table, with the night counted", () => {
    expect(inHoliday("hanukkah", day(2026, 12, 3))).toBe(false);
    expect(hanukkahNight(day(2026, 12, 4))).toBe(1);
    expect(hanukkahNight(day(2026, 12, 11))).toBe(8);
    expect(hanukkahNight(day(2026, 12, 12))).toBe(0);
    expect(nextHolidayStart("hanukkah", day(2026, 12, 12))).toBe(day(2027, 12, 24));
  });

  it("run beside Midwinter, and the one that started first comes first", () => {
    expect(holidaysOf(day(2027, 12, 26))).toEqual(["midwinter", "hanukkah"]);
    expect(holidaysOf(day(2027, 12, 31))).toEqual(["midwinter", "hanukkah"]);
    expect(holidaysOf(day(2028, 1, 1))).toEqual([]);
    expect(hanukkahNight(day(2027, 12, 31))).toBe(8);
  });

  it("have dates at least three years ahead of today, so the table is extended in time", () => {
    // The sim never reads a clock; this test does, to say when the table needs more years.
    const span = HOLIDAY_INFO.hanukkah.span;
    if (!("table" in span)) throw new Error("Hanukkah's dates are a table");
    const last = Math.max(...Object.keys(span.table).map(Number));
    expect(last - new Date().getUTCFullYear()).toBeGreaterThanOrEqual(3);
  });

  it("sell its menorah, dreidel, and gelt only while it runs", () => {
    const before = shopOn(day(2026, 12, 3));
    const refused = apply(before, { actor: "ada", command: { type: "shop_buy", sku: "menorah" } });
    expect(refused.ok ? "accepted" : refused.rejection.code).toBe("out_of_holiday");
    const during = shopOn(day(2026, 12, 5));
    for (const sku of ["menorah", "dreidel", "gelt"] as const) {
      expect(apply(during, { actor: "ada", command: { type: "shop_buy", sku } }).ok).toBe(true);
    }
    expect(during.items?.inventories.ada?.stacks).toMatchObject({
      menorah: 1,
      dreidel: 1,
      gelt: 1,
    });
  });
});
