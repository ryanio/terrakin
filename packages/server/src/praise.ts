import { type ErrorCode, PRAISE_LIMITS } from "@terrakin/protocol";
import { DAY_MS, utcDay } from "@terrakin/sim";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";

/**
 * Praise (issue #36): a small public thank-you from one resident to another, at most once a UTC
 * day per pair. Social data like reactions, never world state, and no economy is attached.
 *
 * Every praise is kept as its own row (giver, receiver, day, time) and never pruned, so the karma
 * in RFC 0008's phase 3 can read who praised whom and when, and weigh it however it likes.
 */

export interface PraiseOptions {
  sql: SqlExec;
  now: () => number;
  exists: (id: string) => boolean;
  blockedEither: (a: string, b: string) => boolean;
  /** Whole UTC days since a resident joined (`WorldService.residentAgeDays`). */
  ageDays: (id: string) => number;
  /** Tell the receiver (the social layer's notifications, with its caps and block check). */
  notify: (recipient: string, actor: string) => void;
}

const fail = (code: ErrorCode, message: string, retryAfter?: number) => ({
  ok: false as const,
  code,
  message,
  ...(retryAfter === undefined ? {} : { retryAfter }),
});

export class PraiseService {
  constructor(private readonly o: PraiseOptions) {
    for (const statement of [
      // One row per praise, kept for good. The key is the once-a-day-per-pair rule.
      `CREATE TABLE IF NOT EXISTS praise (
        giver TEXT NOT NULL,
        receiver TEXT NOT NULL,
        day INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (giver, receiver, day)
      )`,
      "CREATE INDEX IF NOT EXISTS praise_receiver ON praise (receiver, day)",
      "CREATE INDEX IF NOT EXISTS praise_giver_day ON praise (giver, day)",
    ]) {
      o.sql.exec(statement);
    }
  }

  private count(query: string, ...bindings: (string | number)[]): number {
    return Number([...this.o.sql.exec(query, ...bindings)][0]?.c ?? 0);
  }

  /** Seconds until the next UTC day, when every daily praise limit resets. */
  private untilTomorrow(): number {
    const now = this.o.now();
    return Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000));
  }

  /** Praise `receiver` as `giver`. Checks everything first and writes one row. */
  give(giver: string, receiver: string): SocialResult<null> {
    if (!this.o.exists(giver)) return fail("unauthorized", "Unknown resident.");
    if (giver === receiver) return fail("bad_request", "You can't praise yourself.");
    if (!this.o.exists(receiver)) return fail("not_found", "No such resident.");
    if (this.o.blockedEither(giver, receiver)) {
      return fail("forbidden", "You can't praise this resident.");
    }
    const day = utcDay(this.o.now());
    const wait = this.untilTomorrow();
    if (this.o.ageDays(giver) < PRAISE_LIMITS.minAgeDays) {
      return fail(
        "rate_limited",
        "You can praise others from your second day here. Try again after midnight UTC.",
        wait,
      );
    }
    if (
      this.count(
        "SELECT COUNT(*) AS c FROM praise WHERE giver = ? AND receiver = ? AND day = ?",
        giver,
        receiver,
        day,
      ) > 0
    ) {
      return fail(
        "rate_limited",
        "You already praised them today. You can again after midnight UTC.",
        wait,
      );
    }
    if (
      this.count("SELECT COUNT(*) AS c FROM praise WHERE giver = ? AND day = ?", giver, day) >=
      PRAISE_LIMITS.perGiverPerDay
    ) {
      return fail(
        "rate_limited",
        `You've praised ${PRAISE_LIMITS.perGiverPerDay} residents today. You can again after midnight UTC.`,
        wait,
      );
    }
    this.o.sql.exec(
      "INSERT INTO praise (giver, receiver, day, created_at) VALUES (?, ?, ?, ?)",
      giver,
      receiver,
      day,
      this.o.now(),
    );
    this.o.notify(receiver, giver);
    return { ok: true, value: null };
  }

  /** How many times a resident has been praised, all time. */
  received(receiver: string): number {
    return this.count("SELECT COUNT(*) AS c FROM praise WHERE receiver = ?", receiver);
  }

  /** Whether `giver` already praised `receiver` today (UTC). */
  givenToday(giver: string, receiver: string): boolean {
    return (
      this.count(
        "SELECT COUNT(*) AS c FROM praise WHERE giver = ? AND receiver = ? AND day = ?",
        giver,
        receiver,
        utcDay(this.o.now()),
      ) > 0
    );
  }
}
