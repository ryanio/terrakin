import type { CheckinStats } from "@terrakin/protocol";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@terrakin/sim";
import { SUGGEST_AGAIN_DAYS } from "./checkin-suggest";
import type { SqlExec } from "./sql-store";

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
 * many residents check in and how far apart: resident ids and times, kept for CHECKIN_KEEP_DAYS,
 * never shown per resident (below CHECKIN_STATS_MIN residents a week, staff see only that count).
 * It also keeps which daily suggestion each resident got and on which day, for SUGGEST_AGAIN_DAYS,
 * and when this world first served each devlog post (decision 0105), one row a post.
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
      // The check-in's daily suggestion: which one each resident got, and on which UTC day.
      `CREATE TABLE IF NOT EXISTS checkin_suggestions (
        resident_id TEXT NOT NULL,
        id TEXT NOT NULL,
        day INTEGER NOT NULL,
        PRIMARY KEY (resident_id, id)
      )`,
      // When a check-in first saw each devlog post: posts are dated by day, so this is when one
      // came out here, which the check-in compares with `since`.
      `CREATE TABLE IF NOT EXISTS devlog_published (
        date TEXT PRIMARY KEY,
        at INTEGER NOT NULL
      )`,
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

  /** Whether a resident got a suggestion on `day`, and the day they last got each since `fromDay`. */
  suggested(
    residentId: string,
    day: number,
    fromDay: number,
  ): { today: boolean; days: Map<string, number> } {
    const rows = [
      ...this.sql.exec(
        "SELECT id, day FROM checkin_suggestions WHERE resident_id = ? AND day >= ?",
        residentId,
        fromDay,
      ),
    ];
    return {
      today: rows.some((r) => Number(r.day) === day),
      days: new Map(rows.map((r) => [String(r.id), Number(r.day)])),
    };
  }

  /** Note that a resident got suggestion `id` on `day`, replacing any earlier day for it. */
  suggest(residentId: string, id: string, day: number): void {
    // Older rows are never read again: a suggestion comes back after SUGGEST_AGAIN_DAYS anyway.
    this.sql.exec("DELETE FROM checkin_suggestions WHERE day < ?", day - SUGGEST_AGAIN_DAYS);
    this.sql.exec(
      "INSERT OR REPLACE INTO checkin_suggestions (resident_id, id, day) VALUES (?, ?, ?)",
      residentId,
      id,
      day,
    );
  }

  /**
   * When the devlog post of `date` came out in this world: the first time a check-in asked, which
   * is now if none has. One row a post, never deleted, so the time never moves.
   */
  published(date: string): number {
    const row = [...this.sql.exec("SELECT at FROM devlog_published WHERE date = ?", date)][0];
    if (row) return Number(row.at);
    const now = this.now();
    this.sql.exec("INSERT INTO devlog_published (date, at) VALUES (?, ?)", date, now);
    return now;
  }
}
