import { type AwayResult, ROUTINE_LIMITS } from "@terrakin/protocol";
import { utcDay } from "@terrakin/sim";
import type { SqlExec } from "./sql-store";

/** One stored line of the away log. Codes and ids only, never anyone's words. */
export interface AwayRow {
  /** The row number, shown as `a_<n>`. */
  n: number;
  resident: string;
  at: number;
  /** The UTC day of `at`. */
  day: number;
  /** `walk_home`, `stroll`, `greet`, or empty on a `paused` line. */
  routine: string;
  result: AwayResult;
  /** A refusal's code, else empty. */
  code: string;
  /** A step's world `seq`, else 0. */
  seq: number;
  /** Who a `greet` waved at, else empty. */
  recipient: string;
  /** Days in a row a refusal came back, folded into this line. */
  days: number;
}

const fromRow = (row: Record<string, unknown>): AwayRow => ({
  n: Number(row.n),
  resident: String(row.resident),
  at: Number(row.at),
  day: Number(row.day),
  routine: String(row.routine),
  result: String(row.result) as AwayResult,
  code: String(row.code),
  seq: Number(row.seq),
  recipient: String(row.recipient),
  days: Number(row.days),
});

/**
 * The away log (RFC 0009): what each resident's routines did while they were away, kept
 * `ROUTINE_LIMITS.keepDays` days, and the UTC day of each resident's last call, which pauses
 * routines after `ROUTINE_LIMITS.pauseAfterDays` quiet days. It's a social table, outside the sim,
 * because nothing replays from it. Its lines hold codes and ids only: the server writes every
 * word a resident reads about them from those (`awayReason`), never from anyone's text.
 */
export class AwayLog {
  /** The last call day each resident made, as written, so a call costs a write once a day. */
  private readonly calls = new Map<string, number>();

  constructor(
    private readonly sql: SqlExec,
    private readonly now: () => number,
  ) {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS away_log (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        resident TEXT NOT NULL,
        at INTEGER NOT NULL,
        day INTEGER NOT NULL,
        routine TEXT NOT NULL,
        result TEXT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        seq INTEGER NOT NULL DEFAULT 0,
        recipient TEXT NOT NULL DEFAULT '',
        days INTEGER NOT NULL DEFAULT 1
      )`,
      "CREATE INDEX IF NOT EXISTS away_log_resident ON away_log (resident, n)",
      "CREATE INDEX IF NOT EXISTS away_log_day ON away_log (day)",
      // The UTC day of each resident's last authenticated call, for pausing routines.
      `CREATE TABLE IF NOT EXISTS last_calls (
        resident TEXT PRIMARY KEY, day INTEGER NOT NULL
      )`,
    ]) {
      sql.exec(statement);
    }
  }

  private rows(query: string, ...bindings: (string | number)[]): AwayRow[] {
    return [...this.sql.exec(query, ...bindings)].map(fromRow);
  }

  private insert(row: Omit<AwayRow, "n" | "day" | "days">): void {
    this.sql.exec(
      `INSERT INTO away_log (resident, at, day, routine, result, code, seq, recipient)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.resident,
      row.at,
      utcDay(row.at),
      row.routine,
      row.result,
      row.code,
      row.seq,
      row.recipient,
    );
  }

  /** A routine's step went (`seq`), or `greet` waved at `recipient`. */
  done(resident: string, routine: string, what: { seq?: number; recipient?: string }): void {
    this.insert({
      resident,
      at: this.now(),
      routine,
      result: "done",
      code: "",
      seq: what.seq ?? 0,
      recipient: what.recipient ?? "",
    });
  }

  /**
   * A routine's step was refused with `code`. When the same routine was refused with the same
   * code yesterday, that line takes today's too, as one line with a count.
   */
  refused(resident: string, routine: string, code: string): void {
    const at = this.now();
    const day = utcDay(at);
    const last = this.rows(
      "SELECT * FROM away_log WHERE resident = ? AND routine = ? ORDER BY n DESC LIMIT 1",
      resident,
      routine,
    )[0];
    if (last?.result === "refused" && last.code === code && last.day === day - 1) {
      this.sql.exec(
        "UPDATE away_log SET at = ?, day = ?, days = days + 1 WHERE n = ?",
        at,
        day,
        last.n,
      );
      return;
    }
    this.insert({ resident, at, routine, result: "refused", code, seq: 0, recipient: "" });
  }

  /** Every routine of theirs paused: no call from them for `pauseAfterDays`. */
  paused(resident: string): void {
    this.insert({
      resident,
      at: this.now(),
      routine: "",
      result: "paused",
      code: "",
      seq: 0,
      recipient: "",
    });
  }

  /** Whether a `paused` line was written on or after `day`. */
  pausedSince(resident: string, day: number): boolean {
    return (
      [
        ...this.sql.exec(
          "SELECT 1 FROM away_log WHERE resident = ? AND result = 'paused' AND day >= ? LIMIT 1",
          resident,
          day,
        ),
      ].length > 0
    );
  }

  /** Lines from `since` (ms) on, newest first, at most `limit`. */
  since(resident: string, since: number, limit: number): AwayRow[] {
    return this.rows(
      "SELECT * FROM away_log WHERE resident = ? AND at >= ? ORDER BY n DESC LIMIT ?",
      resident,
      since,
      limit,
    );
  }

  /** How many lines from `since` (ms) on are refusals. */
  refusedSince(resident: string, since: number): number {
    const row = [
      ...this.sql.exec(
        "SELECT COUNT(*) AS c FROM away_log WHERE resident = ? AND at >= ? AND result = 'refused'",
        resident,
        since,
      ),
    ][0];
    return Number(row?.c ?? 0);
  }

  /** Lines older than line `before` (or the newest), newest first, at most `limit`. */
  page(resident: string, before: number | undefined, limit: number): AwayRow[] {
    return before === undefined
      ? this.rows(
          "SELECT * FROM away_log WHERE resident = ? ORDER BY n DESC LIMIT ?",
          resident,
          limit,
        )
      : this.rows(
          "SELECT * FROM away_log WHERE resident = ? AND n < ? ORDER BY n DESC LIMIT ?",
          resident,
          before,
          limit,
        );
  }

  /** The newest line, which a check-in's digest names. */
  newest(resident: string): AwayRow | undefined {
    return this.page(resident, undefined, 1)[0];
  }

  /** Which routines of whose have a line on `day`, as `resident routine`. */
  triedOn(day: number): Set<string> {
    return new Set(
      [
        ...this.sql.exec(
          "SELECT resident, routine FROM away_log WHERE day = ? AND result != 'paused'",
          day,
        ),
      ].map((row) => `${String(row.resident)} ${String(row.routine)}`),
    );
  }

  /** Forget lines older than `ROUTINE_LIMITS.keepDays`. */
  prune(): void {
    this.sql.exec(
      "DELETE FROM away_log WHERE day < ?",
      utcDay(this.now()) - ROUTINE_LIMITS.keepDays,
    );
  }

  /** A resident made an authenticated call. One write a UTC day at most. */
  called(resident: string): void {
    const day = utcDay(this.now());
    if (this.calls.get(resident) === day) return;
    this.calls.set(resident, day);
    this.sql.exec(
      `INSERT INTO last_calls (resident, day) VALUES (?, ?)
        ON CONFLICT (resident) DO UPDATE SET day = excluded.day`,
      resident,
      day,
    );
  }

  /** The UTC day of a resident's last call, if one was ever written. */
  lastCall(resident: string): number | undefined {
    const known = this.calls.get(resident);
    if (known !== undefined) return known;
    const row = [...this.sql.exec("SELECT day FROM last_calls WHERE resident = ?", resident)][0];
    if (!row) return undefined;
    const day = Number(row.day);
    this.calls.set(resident, day);
    return day;
  }
}
