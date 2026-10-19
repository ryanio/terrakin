import { CIRCLE_NOTICE, type CircleNoticeView, type ErrorCode } from "@terrakin/protocol";
import { DAY_MS } from "@terrakin/sim";
import type { Moderation } from "./moderation";
import type { SqlExec } from "./sql-store";
import { cleanMultiline } from "./text";

/**
 * A circle's notice (RFC 0033): one short text a steward sets, with no history and no replies,
 * replaced whole when it changes. Nothing in the rules reads it, so it lives in the social tables,
 * like the Town Hall's board. A circle's notice changes at most `CIRCLE_NOTICE.perDay` times a
 * UTC day, counted from `circle_notice_changes`, which keeps a row per change for a day.
 */

export interface CircleNoticesOptions {
  sql: SqlExec;
  now: () => number;
  moderation: Moderation;
}

type Outcome =
  | { ok: true; value: CircleNoticeView | null }
  | { ok: false; code: ErrorCode; message: string; retryAfter?: number };

const iso = (ms: number) => new Date(ms).toISOString();

export class CircleNotices {
  /** What's been read since the last change, by circle, so a page read doesn't touch SQL. */
  private readonly cache = new Map<string, CircleNoticeView | null>();

  constructor(private readonly o: CircleNoticesOptions) {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS circle_notices (
        circle TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS circle_notice_changes (
        circle TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS circle_notice_changes_circle ON circle_notice_changes (circle, at)",
    ]) {
      o.sql.exec(statement);
    }
    // These tables were `kindred_notices` and `kindred_notice_changes`, keyed by a `k_1` id, until
    // kindreds became Circles (decision 0318). Both the table name and the key changed, so without
    // this a live circle's notice would read as none, with nothing anywhere saying why, and the old
    // rows would hold resident text no takedown could reach. Copies once, then drops the old
    // tables, so a later boot finds nothing to do.
    for (const [from, to, columns] of [
      ["kindred_notices", "circle_notices", "circle, author, text, updated_at"],
      ["kindred_notice_changes", "circle_notice_changes", "circle, at"],
    ] as const) {
      try {
        o.sql.exec(
          `INSERT OR IGNORE INTO ${to} (${columns})
           SELECT replace(kindred, 'k_', 'c_'), ${columns.split(", ").slice(1).join(", ")}
           FROM ${from}`,
        );
        o.sql.exec(`DROP TABLE ${from}`);
      } catch {
        // No old table, so nothing to carry over.
      }
    }
  }

  /** The circle's notice, or undefined when it has none. */
  get(circle: string): CircleNoticeView | undefined {
    const cached = this.cache.get(circle);
    if (cached !== undefined) return cached ?? undefined;
    const row = [
      ...this.o.sql.exec("SELECT text, updated_at FROM circle_notices WHERE circle = ?", circle),
    ][0];
    const view: CircleNoticeView | null = row
      ? { text: String(row.text), trust: "untrusted", updatedAt: iso(Number(row.updated_at)) }
      : null;
    this.cache.set(circle, view);
    return view ?? undefined;
  }

  /** Who wrote the circle's notice, for a report and a takedown notice. */
  authorOf(circle: string): string | undefined {
    const row = [
      ...this.o.sql.exec("SELECT author FROM circle_notices WHERE circle = ?", circle),
    ][0];
    return row ? String(row.author) : undefined;
  }

  /**
   * Set `circle`'s notice as `author`, or clear it with an empty text. The caller has checked
   * they're one of its stewards; a circle takes a notice while it's still forming (issue #73). Filtered as the `circle_notice` surface
   * first, and refused past the day's changes.
   */
  set(circle: string, author: string, words: string): Outcome {
    const text = cleanMultiline(words);
    const now = this.o.now();
    const since = now - (now % DAY_MS);
    const changes = Number(
      [
        ...this.o.sql.exec(
          "SELECT COUNT(*) AS c FROM circle_notice_changes WHERE circle = ? AND at >= ?",
          circle,
          since,
        ),
      ][0]?.c ?? 0,
    );
    if (changes >= CIRCLE_NOTICE.perDay) {
      return {
        ok: false,
        code: "rate_limited",
        message: `A circle's notice changes at most ${CIRCLE_NOTICE.perDay} times a UTC day. Try again after midnight UTC.`,
        retryAfter: Math.max(1, Math.ceil((since + DAY_MS - now) / 1000)),
      };
    }
    if (text === "") {
      if (!this.get(circle)) return { ok: true, value: null };
      this.o.sql.exec("DELETE FROM circle_notices WHERE circle = ?", circle);
      this.changed(circle, now);
      return { ok: true, value: null };
    }
    const verdict = this.o.moderation.review("circle_notice", text, { resident: author });
    if (!verdict.ok) return { ok: false, code: verdict.code, message: verdict.message };
    this.o.sql.exec(
      `INSERT INTO circle_notices (circle, author, text, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (circle) DO UPDATE SET author = excluded.author, text = excluded.text,
          updated_at = excluded.updated_at`,
      circle,
      author,
      text,
      now,
    );
    verdict.commit();
    this.changed(circle, now);
    return { ok: true, value: this.get(circle) ?? null };
  }

  /** Staff take a notice down, or a circle is gone. The author, for a takedown notice. */
  clear(circle: string): string | undefined {
    const author = this.authorOf(circle);
    this.o.sql.exec("DELETE FROM circle_notices WHERE circle = ?", circle);
    this.cache.delete(circle);
    return author;
  }

  private changed(circle: string, now: number) {
    this.cache.delete(circle);
    this.o.sql.exec("INSERT INTO circle_notice_changes (circle, at) VALUES (?, ?)", circle, now);
    this.o.sql.exec("DELETE FROM circle_notice_changes WHERE at < ?", now - DAY_MS);
  }
}
