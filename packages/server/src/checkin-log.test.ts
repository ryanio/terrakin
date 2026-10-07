import { describe, expect, it } from "vitest";
import { CHECKIN_KEEP_DAYS, CHECKIN_SAME_MS, CHECKIN_STATS_MIN, CheckinLog } from "./checkin-log";
import { SUGGEST_AGAIN_DAYS } from "./checkin-suggest";
import { nodeSql } from "./node-sql";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function log() {
  let now = 1_700_000_000_000;
  const sql = nodeSql();
  return {
    checkins: new CheckinLog(sql, () => now),
    advance: (ms: number) => {
      now += ms;
    },
    rows: () => Number([...sql.exec("SELECT COUNT(*) AS c FROM checkin_log")][0]?.c),
  };
}

describe("CheckinLog", () => {
  it("counts residents today and this week, and who looks scheduled", () => {
    const { checkins, advance } = log();
    checkins.record("old");
    advance(3 * DAY);
    for (let i = 0; i < 5; i++) {
      checkins.record("wren");
      advance(3.5 * HOUR);
    }
    for (const id of ["ash", "bo", "cy"]) checkins.record(id);
    expect(checkins.stats()).toEqual({
      residentsThisWeek: 5,
      residentsToday: 4,
      scheduledToday: 1,
      medianGapHours: 3.5,
    });
  });

  it("gives only the week's count while too few check in to hide one resident", () => {
    const { checkins, advance } = log();
    for (let i = 0; i < 4; i++) {
      checkins.record("wren");
      advance(3.5 * HOUR);
    }
    expect(CHECKIN_STATS_MIN).toBeGreaterThan(1);
    expect(checkins.stats()).toEqual({
      residentsThisWeek: 1,
      residentsToday: null,
      scheduledToday: null,
      medianGapHours: null,
    });
  });

  it("counts a burst of check-ins once, and forgets them after a week", () => {
    const { checkins, advance, rows } = log();
    checkins.record("wren");
    advance(CHECKIN_SAME_MS - 1);
    checkins.record("wren");
    expect(rows()).toBe(1);
    advance(CHECKIN_KEEP_DAYS * DAY + 1);
    checkins.record("wren");
    expect(rows()).toBe(1);
  });

  it("leaves gaps of more than two days out of the median, and averages the middle two", () => {
    const { checkins, advance } = log();
    for (const id of ["a", "b", "c", "d"]) checkins.record(id);
    checkins.record("wren");
    advance(3 * DAY);
    checkins.record("wren");
    advance(4 * HOUR);
    checkins.record("wren");
    advance(3 * HOUR);
    checkins.record("wren");
    // Gaps of 4 and 3 hours count; the 3-day gap doesn't.
    expect(checkins.stats().medianGapHours).toBe(3.5);
  });

  it("has no numbers before anyone checks in", () => {
    expect(log().checkins.stats()).toEqual({
      residentsThisWeek: 0,
      residentsToday: null,
      scheduledToday: null,
      medianGapHours: null,
    });
  });

  it("remembers each resident's suggestions by day, and drops ones past the repeat window", () => {
    const sql = nodeSql();
    const checkins = new CheckinLog(sql, () => 0);
    checkins.suggest("wren", "plant", 100);
    expect(checkins.suggested("wren", 100, 70)).toEqual({
      today: true,
      days: new Map([["plant", 100]]),
    });
    expect(checkins.suggested("wren", 101, 71).today).toBe(false);
    expect(checkins.suggested("ash", 100, 70).days.size).toBe(0);
    checkins.suggest("wren", "gather", 100 + SUGGEST_AGAIN_DAYS + 1);
    const rows = [...sql.exec("SELECT id FROM checkin_suggestions")].map((r) => r.id);
    expect(rows).toEqual(["gather"]);
  });
});
