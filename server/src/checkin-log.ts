import type { CheckinStats } from "@terrakin/protocol";
import type { SqlExec } from "./sql-store";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long check-in times are kept. */
export const CHECKIN_KEEP_DAYS = 7;
/** Check-ins closer together than this count once, so a client polling the route adds no rows. */
export const CHECKIN_SAME_MS = 15 * MINUTE_MS;
/** Gaps longer than this are a pause, not a rhythm, and stay out of the median. */
const GAP_MAX_MS = 2 * DAY_MS;
/** Check-ins in a day that look like a schedule rather than an owner asking now and then. */
const SCHEDULED_PER_DAY = 4;
/** Fewer residents than this in a week, and the staff numbers stop at that count. */
export const CHECKIN_STATS_MIN = 5;

/**
 * When residents check in (`GET /v1/checkin` and its link twin), for the staff app's numbers: how
 * many residents check in and how far apart. Times only, kept for CHECKIN_KEEP_DAYS, and never
 * shown per resident: below CHECKIN_STATS_MIN residents a week, staff see only that count.
 */
export class CheckinLog {
  constructor(
    private readonly sql: SqlExec,
    private readonly now: () => number,
  ) {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS checkin_log (
        resident_id TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS checkin_log_resident ON checkin_log (resident_id, at)",
      "CREATE INDEX IF NOT EXISTS checkin_log_at ON checkin_log (at)",
    ]) {
      sql.exec(statement);
    }
  }

  /** Note a check-in, unless the same resident checked in within CHECKIN_SAME_MS. */
  record(residentId: string): void {
    const now = this.now();
    const recent = [
      ...this.sql.exec(
        "SELECT 1 FROM checkin_log WHERE resident_id = ? AND at > ? LIMIT 1",
        residentId,
        now - CHECKIN_SAME_MS,
      ),
    ];
    if (recent.length > 0) return;
    this.sql.exec("DELETE FROM checkin_log WHERE at < ?", now - CHECKIN_KEEP_DAYS * DAY_MS);
    this.sql.exec("INSERT INTO checkin_log (resident_id, at) VALUES (?, ?)", residentId, now);
  }

  /**
   * Counts and the median gap, over the last CHECKIN_KEEP_DAYS, counted in SQL. Below
   * CHECKIN_STATS_MIN residents in the week, only that count is given: with so few, the rest would
   * show one resident's rhythm.
   */
  stats(): CheckinStats {
    const now = this.now();
    const weekFrom = now - CHECKIN_KEEP_DAYS * DAY_MS;
    const one = (query: string, ...bindings: number[]) =>
      Number([...this.sql.exec(query, ...bindings)][0]?.n ?? 0);
    const residentsThisWeek = one(
      "SELECT COUNT(DISTINCT resident_id) AS n FROM checkin_log WHERE at >= ?",
      weekFrom,
    );
    if (residentsThisWeek < CHECKIN_STATS_MIN) {
      return {
        residentsThisWeek,
        residentsToday: null,
        scheduledToday: null,
        medianGapHours: null,
      };
    }
    const dayFrom = now - DAY_MS;
    const residentsToday = one(
      "SELECT COUNT(DISTINCT resident_id) AS n FROM checkin_log WHERE at >= ?",
      dayFrom,
    );
    const scheduledToday = one(
      `SELECT COUNT(*) AS n FROM (
        SELECT resident_id FROM checkin_log WHERE at >= ?
        GROUP BY resident_id HAVING COUNT(*) >= ?
      )`,
      dayFrom,
      SCHEDULED_PER_DAY,
    );
    const gaps = `SELECT gap FROM (
        SELECT at - LAG(at) OVER (PARTITION BY resident_id ORDER BY at) AS gap
        FROM checkin_log WHERE at >= ?
      ) WHERE gap IS NOT NULL AND gap <= ?`;
    const count = one(`SELECT COUNT(*) AS n FROM (${gaps})`, weekFrom, GAP_MAX_MS);
    let medianGapHours: number | null = null;
    if (count > 0) {
      // The middle one, or the two around the middle for an even count.
      const middle = [
        ...this.sql.exec(
          `${gaps} ORDER BY gap LIMIT ? OFFSET ?`,
          weekFrom,
          GAP_MAX_MS,
          count % 2 === 1 ? 1 : 2,
          Math.floor((count - 1) / 2),
        ),
      ].map((r) => Number(r.gap));
      const median = middle.reduce((a, b) => a + b, 0) / middle.length;
      medianGapHours = Math.round((median / HOUR_MS) * 10) / 10;
    }
    return { residentsThisWeek, residentsToday, scheduledToday, medianGapHours };
  }
}
