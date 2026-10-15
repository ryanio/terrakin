import { type ErrorCode, KINDRED_NOTICE, type KindredNoticeView } from "@terrakin/protocol";
import { DAY_MS } from "@terrakin/sim";
import type { Moderation } from "./moderation";
import type { SqlExec } from "./sql-store";
import { cleanMultiline } from "./text";

/**
 * A kindred's notice (RFC 0033): one short text a steward sets, with no history and no replies,
 * replaced whole when it changes. Nothing in the rules reads it, so it lives in the social tables,
 * like the Town Hall's board. A kindred's notice changes at most `KINDRED_NOTICE.perDay` times a
 * UTC day, counted from `kindred_notice_changes`, which keeps a row per change for a day.
 */

export interface KindredNoticesOptions {
  sql: SqlExec;
  now: () => number;
  moderation: Moderation;
}

type Outcome =
  | { ok: true; value: KindredNoticeView | null }
  | { ok: false; code: ErrorCode; message: string; retryAfter?: number };

const iso = (ms: number) => new Date(ms).toISOString();

export class KindredNotices {
  /** What's been read since the last change, by kindred, so a page read doesn't touch SQL. */
  private readonly cache = new Map<string, KindredNoticeView | null>();

  constructor(private readonly o: KindredNoticesOptions) {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS kindred_notices (
        kindred TEXT PRIMARY KEY,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS kindred_notice_changes (
        kindred TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS kindred_notice_changes_kindred ON kindred_notice_changes (kindred, at)",
    ]) {
      o.sql.exec(statement);
    }
  }

  /** The kindred's notice, or undefined when it has none. */
  get(kindred: string): KindredNoticeView | undefined {
    const cached = this.cache.get(kindred);
    if (cached !== undefined) return cached ?? undefined;
    const row = [
      ...this.o.sql.exec("SELECT text, updated_at FROM kindred_notices WHERE kindred = ?", kindred),
    ][0];
    const view: KindredNoticeView | null = row
      ? { text: String(row.text), trust: "untrusted", updatedAt: iso(Number(row.updated_at)) }
      : null;
    this.cache.set(kindred, view);
    return view ?? undefined;
  }

  /** Who wrote the kindred's notice, for a report and a takedown notice. */
  authorOf(kindred: string): string | undefined {
    const row = [
      ...this.o.sql.exec("SELECT author FROM kindred_notices WHERE kindred = ?", kindred),
    ][0];
    return row ? String(row.author) : undefined;
  }

  /**
   * Set `kindred`'s notice as `author`, or clear it with an empty text. The caller has checked
   * they're one of its stewards and that it's formed. Filtered as the `kindred_notice` surface
   * first, and refused past the day's changes.
   */
  set(kindred: string, author: string, words: string): Outcome {
    const text = cleanMultiline(words);
    const now = this.o.now();
    const since = now - (now % DAY_MS);
    const changes = Number(
      [
        ...this.o.sql.exec(
          "SELECT COUNT(*) AS c FROM kindred_notice_changes WHERE kindred = ? AND at >= ?",
          kindred,
          since,
        ),
      ][0]?.c ?? 0,
    );
    if (changes >= KINDRED_NOTICE.perDay) {
      return {
        ok: false,
        code: "rate_limited",
        message: `A kindred's notice changes at most ${KINDRED_NOTICE.perDay} times a UTC day. Try again after midnight UTC.`,
        retryAfter: Math.max(1, Math.ceil((since + DAY_MS - now) / 1000)),
      };
    }
    if (text === "") {
      if (!this.get(kindred)) return { ok: true, value: null };
      this.o.sql.exec("DELETE FROM kindred_notices WHERE kindred = ?", kindred);
      this.changed(kindred, now);
      return { ok: true, value: null };
    }
    const verdict = this.o.moderation.review("kindred_notice", text, { resident: author });
    if (!verdict.ok) return { ok: false, code: verdict.code, message: verdict.message };
    this.o.sql.exec(
      `INSERT INTO kindred_notices (kindred, author, text, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (kindred) DO UPDATE SET author = excluded.author, text = excluded.text,
          updated_at = excluded.updated_at`,
      kindred,
      author,
      text,
      now,
    );
    verdict.commit();
    this.changed(kindred, now);
    return { ok: true, value: this.get(kindred) ?? null };
  }

  /** Staff take a notice down, or a kindred is gone. The author, for a takedown notice. */
  clear(kindred: string): string | undefined {
    const author = this.authorOf(kindred);
    this.o.sql.exec("DELETE FROM kindred_notices WHERE kindred = ?", kindred);
    this.cache.delete(kindred);
    return author;
  }

  private changed(kindred: string, now: number) {
    this.cache.delete(kindred);
    this.o.sql.exec("INSERT INTO kindred_notice_changes (kindred, at) VALUES (?, ?)", kindred, now);
    this.o.sql.exec("DELETE FROM kindred_notice_changes WHERE at < ?", now - DAY_MS);
  }
}
