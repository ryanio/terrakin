import {
  AUTO_HIDE,
  type AuthorView,
  type CreateReportRequest,
  DAILY_LIMITS,
  type ErrorCode,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  type MediaView,
  MODERATION_ACTIONS,
  type ModerationAction,
  type ModerationLogEntry,
  REPORT_REASONS,
  type ReportKind,
  type ReportQueueItem,
  type ReportQueueResponse,
  type ReportReason,
  type ReportTarget,
  type ReportView,
  type TransparencyResponse,
} from "@terrakin/protocol";
import type { Resident } from "@terrakin/sim";
import type { Moderation } from "./moderation";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";
import { cleanMultiline } from "./text";

/**
 * Reports, the review queue, hiding posts, suspensions, the moderation log, and the transparency
 * numbers (RFC 0006, decision 0033). Owned by `SocialService` as `social.safety`, sharing its
 * tables. Who may call the maintainer methods is checked by the API before they run.
 */

export interface SafetyOptions {
  sql: SqlExec;
  now: () => number;
  resident: (id: string) => Resident | undefined;
  author: (id: string) => AuthorView | undefined;
  isMaintainer: (id: string) => boolean;
  /** Whole days since a resident joined, for the auto-hide rule. */
  residentAgeDays: (id: string) => number;
  /** A Town Hall proposal from the world, for reports on one. */
  proposal: (id: string) => { author: string; title: string; text: string } | undefined;
  /** A post's files, as its view shows them. */
  postMedia: (postId: string) => MediaView[];
  /** Detach a post's files and delete the ones nothing else uses. */
  dropPostMedia: (postId: string) => Promise<void>;
  /** The edge filters, for their refusal counts. */
  moderation: () => Moderation[];
}

type Row = Record<string, unknown>;

const fail = (code: ErrorCode, message: string) => ({ ok: false as const, code, message });
const ok = <T>(value: T) => ({ ok: true as const, value });
const iso = (ms: number) => new Date(ms).toISOString();
const DAY_MS = 86_400_000;

const randomId = (prefix: string) =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** `posts.hidden`: 0 shown, 1 hidden by a maintainer, 2 hidden automatically until reviewed. */
export const HIDDEN = { no: 0, maintainer: 1, auto: 2 } as const;

/** Posts by a suspended resident stay out of view. Bind `now` once for each use. */
export const NOT_SUSPENDED = (column: string) =>
  `${column} NOT IN (SELECT resident_id FROM suspensions WHERE until > ?)`;

export class SafetyService {
  private readonly o: SafetyOptions;

  constructor(options: SafetyOptions) {
    this.o = options;
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS reports (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        reporter TEXT NOT NULL,
        reason TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        closed_at INTEGER,
        closed_by TEXT,
        UNIQUE (reporter, kind, target)
      )`,
      "CREATE INDEX IF NOT EXISTS reports_target ON reports (kind, target, status)",
      "CREATE INDEX IF NOT EXISTS reports_status ON reports (status, n)",
      "CREATE INDEX IF NOT EXISTS reports_reporter ON reports (reporter, created_at)",
      `CREATE TABLE IF NOT EXISTS suspensions (
        resident_id TEXT PRIMARY KEY,
        until INTEGER NOT NULL,
        reason TEXT NOT NULL,
        by TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
      // Every maintainer and automatic action: who, what, when, and why. Rows are only ever added.
      `CREATE TABLE IF NOT EXISTS moderation_log (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        reason TEXT NOT NULL,
        until INTEGER
      )`,
      "CREATE INDEX IF NOT EXISTS moderation_log_action ON moderation_log (action)",
    ]) {
      this.o.sql.exec(statement);
    }
    // The database refuses to change or delete a log row, so a code mistake can't either.
    for (const verb of ["UPDATE", "DELETE"]) {
      try {
        this.o.sql.exec(
          `CREATE TRIGGER IF NOT EXISTS moderation_log_no_${verb.toLowerCase()} BEFORE ${verb} ON moderation_log
            BEGIN SELECT RAISE(ABORT, 'moderation_log is append-only'); END`,
        );
      } catch (err) {
        console.warn("Couldn't add the moderation log guard", err);
      }
    }
  }

  private rows(query: string, ...bindings: (string | number)[]): Row[] {
    return [...this.o.sql.exec(query, ...bindings)];
  }

  private count(query: string, ...bindings: (string | number)[]): number {
    return Number(this.rows(query, ...bindings)[0]?.c ?? 0);
  }

  // ---------- reports ----------

  /**
   * File a report. A second report on the same thing from the same resident returns the first,
   * with `created: false`.
   */
  report(
    reporter: string,
    request: CreateReportRequest,
  ): SocialResult<{ report: ReportView; created: boolean }> {
    if (!this.o.resident(reporter)) return fail("unauthorized", "Unknown resident.");
    const { kind, id, reason } = request;
    const earlier = this.rows(
      "SELECT * FROM reports WHERE reporter = ? AND kind = ? AND target = ?",
      reporter,
      kind,
      id,
    )[0];
    if (earlier) return ok({ report: reportView(earlier), created: false });

    const owner = this.targetOwner(reporter, kind, id);
    if (owner === undefined) return fail("not_found", NOT_FOUND[kind]);
    if (owner === reporter) return fail("bad_request", "You can't report your own things.");

    const today = this.count(
      "SELECT COUNT(*) AS c FROM reports WHERE reporter = ? AND created_at > ?",
      reporter,
      this.o.now() - DAY_MS,
    );
    if (today >= DAILY_LIMITS.reportsPerResident) {
      return fail("rate_limited", "That's a lot of reports for one day. Try again tomorrow.");
    }

    const reportId = randomId("rp");
    this.o.sql.exec(
      `INSERT INTO reports (id, kind, target, reporter, reason, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      reportId,
      kind,
      id,
      reporter,
      reason,
      cleanMultiline(request.note ?? ""),
      this.o.now(),
    );
    if (kind === "post") this.maybeAutoHide(id);
    const row = this.rows("SELECT * FROM reports WHERE id = ?", reportId)[0];
    return row
      ? ok({ report: reportView(row), created: true })
      : fail("internal", "Report vanished.");
  }

  /**
   * Who owns what's being reported, or undefined when the reporter can't see it. A letter counts
   * only for its sender and recipient: anyone else is told it doesn't exist.
   */
  private targetOwner(reporter: string, kind: ReportKind, id: string): string | undefined {
    if (kind === "resident") return this.o.resident(id) ? id : undefined;
    if (kind === "proposal") return this.o.proposal(id)?.author;
    if (kind === "post") {
      const row = this.rows("SELECT author FROM posts WHERE id = ?", id)[0];
      return row ? String(row.author) : undefined;
    }
    if (kind === "notice") {
      const row = this.rows(
        "SELECT author FROM notices WHERE id = ? AND removed_at IS NULL",
        id,
      )[0];
      return row ? String(row.author) : undefined;
    }
    const letter = this.rows(
      `SELECT sender, recipient FROM letters WHERE id = ?
        AND ((sender = ? AND sender_deleted = 0) OR (recipient = ? AND recipient_deleted = 0))`,
      id,
      reporter,
      reporter,
    )[0];
    return letter ? String(letter.sender) : undefined;
  }

  /** Hide a post once enough residents who've been around a while report it. */
  private maybeAutoHide(postId: string) {
    const post = this.rows("SELECT hidden FROM posts WHERE id = ?", postId)[0];
    if (!post || Number(post.hidden) !== HIDDEN.no) return;
    const reporters = this.rows(
      "SELECT DISTINCT reporter FROM reports WHERE kind = 'post' AND target = ? AND status = 'open'",
      postId,
    ).filter((r) => this.o.residentAgeDays(String(r.reporter)) >= AUTO_HIDE.reporterAgeDays);
    if (reporters.length < AUTO_HIDE.reports) return;
    this.o.sql.exec("UPDATE posts SET hidden = ? WHERE id = ?", HIDDEN.auto, postId);
    this.log(
      "system",
      "auto_hide_post",
      "post",
      postId,
      `${reporters.length} reports from residents here at least ${AUTO_HIDE.reporterAgeDays} days`,
    );
  }

  // ---------- the queue ----------

  /** Open reports grouped by what they point at, most recently reported first. */
  queue(limit?: number): ReportQueueResponse {
    const n = Math.floor(Number(limit));
    const size = Number.isFinite(n) ? Math.max(1, Math.min(FEED_MAX_LIMIT, n)) : FEED_DEFAULT_LIMIT;
    const groups = this.rows(
      `SELECT kind, target, MIN(created_at) AS first, MAX(created_at) AS last, MAX(n) AS latest
        FROM reports WHERE status = 'open' GROUP BY kind, target ORDER BY latest DESC LIMIT ?`,
      size,
    );
    const items: ReportQueueItem[] = groups.map((g) => {
      const kind = String(g.kind) as ReportKind;
      const id = String(g.target);
      const reports = this.rows(
        "SELECT * FROM reports WHERE kind = ? AND target = ? AND status = 'open' ORDER BY n",
        kind,
        id,
      ).map((r) => ({
        id: String(r.id),
        reason: String(r.reason) as ReportReason,
        note: String(r.note),
        reporter: this.o.author(String(r.reporter)) ?? null,
        createdAt: iso(Number(r.created_at)),
      }));
      return {
        kind,
        id,
        reports,
        firstReportedAt: iso(Number(g.first)),
        lastReportedAt: iso(Number(g.last)),
        target: this.target(kind, id),
      };
    });
    return { items, open: this.count("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'") };
  }

  /** What a report points at, as it is now. */
  private target(kind: ReportKind, id: string): ReportTarget {
    const base = (author: string | undefined, text: string, extra: Partial<ReportTarget> = {}) => ({
      trust: "untrusted" as const,
      exists: true,
      author: author ? (this.o.author(author) ?? null) : null,
      text,
      media: [],
      hidden: "no" as const,
      suspended: author ? this.suspendedUntil(author) !== undefined : false,
      ...extra,
    });
    const gone: ReportTarget = { ...base(undefined, ""), exists: false };
    if (kind === "post") {
      const row = this.rows("SELECT author, text, hidden FROM posts WHERE id = ?", id)[0];
      if (!row) return gone;
      const hidden = Number(row.hidden);
      return base(String(row.author), String(row.text), {
        media: this.o.postMedia(id),
        hidden: hidden === HIDDEN.auto ? "auto" : hidden === HIDDEN.no ? "no" : "maintainer",
      });
    }
    if (kind === "resident") {
      const r = this.o.resident(id);
      if (!r) return gone;
      const bio = this.rows("SELECT bio FROM profiles WHERE resident_id = ?", id)[0]?.bio;
      return base(id, [r.name, r.note, String(bio ?? "")].filter(Boolean).join("\n"));
    }
    if (kind === "letter") {
      const row = this.rows("SELECT sender, text FROM letters WHERE id = ?", id)[0];
      return row ? base(String(row.sender), String(row.text)) : gone;
    }
    if (kind === "notice") {
      const row = this.rows("SELECT author, text, removed_at FROM notices WHERE id = ?", id)[0];
      if (!row) return gone;
      return base(String(row.author), String(row.text), { exists: row.removed_at === null });
    }
    const p = this.o.proposal(id);
    return p ? base(p.author, [p.title, p.text].filter(Boolean).join("\n")) : gone;
  }

  // ---------- maintainer actions ----------

  async hidePost(
    by: string,
    postId: string,
    reason: string,
  ): Promise<SocialResult<ModerationLogEntry>> {
    if (!this.rows("SELECT id FROM posts WHERE id = ?", postId)[0]) {
      return fail("not_found", "No such post.");
    }
    this.o.sql.exec("UPDATE posts SET hidden = ? WHERE id = ?", HIDDEN.maintainer, postId);
    await this.o.dropPostMedia(postId);
    this.close("post", postId, "actioned", by);
    return ok(this.log(by, "hide_post", "post", postId, reason));
  }

  unhidePost(by: string, postId: string, reason: string): SocialResult<ModerationLogEntry> {
    const row = this.rows("SELECT hidden FROM posts WHERE id = ?", postId)[0];
    if (!row) return fail("not_found", "No such post.");
    if (Number(row.hidden) === HIDDEN.no) return fail("bad_request", "That post isn't hidden.");
    this.o.sql.exec("UPDATE posts SET hidden = ? WHERE id = ?", HIDDEN.no, postId);
    // Unhiding says the reports were wrong, so they close, and the post can't be hidden again by them.
    this.close("post", postId, "dismissed", by);
    return ok(this.log(by, "unhide_post", "post", postId, reason));
  }

  suspend(
    by: string,
    residentId: string,
    days: number,
    reason: string,
  ): SocialResult<ModerationLogEntry> {
    if (!this.o.resident(residentId)) return fail("not_found", "No such resident.");
    if (residentId === by) return fail("bad_request", "You can't suspend yourself.");
    if (this.o.isMaintainer(residentId)) {
      return fail(
        "bad_request",
        "Maintainers can't be suspended. Take them off the maintainer list first.",
      );
    }
    const now = this.o.now();
    const until = now + days * DAY_MS;
    this.o.sql.exec(
      `INSERT INTO suspensions (resident_id, until, reason, by, at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (resident_id) DO UPDATE SET until = excluded.until, reason = excluded.reason,
        by = excluded.by, at = excluded.at`,
      residentId,
      until,
      reason,
      by,
      now,
    );
    this.close("resident", residentId, "actioned", by);
    return ok(this.log(by, "suspend", "resident", residentId, reason, until));
  }

  unsuspend(by: string, residentId: string, reason: string): SocialResult<ModerationLogEntry> {
    if (!this.o.resident(residentId)) return fail("not_found", "No such resident.");
    if (this.suspendedUntil(residentId) === undefined) {
      return fail("bad_request", "That resident isn't suspended.");
    }
    this.o.sql.exec("DELETE FROM suspensions WHERE resident_id = ?", residentId);
    return ok(this.log(by, "unsuspend", "resident", residentId, reason));
  }

  /** Close the open reports on something without acting on it. */
  dismiss(
    by: string,
    kind: ReportKind,
    id: string,
    reason: string,
  ): SocialResult<ModerationLogEntry> {
    const open = this.count(
      "SELECT COUNT(*) AS c FROM reports WHERE kind = ? AND target = ? AND status = 'open'",
      kind,
      id,
    );
    if (open === 0) return fail("not_found", "There are no open reports on that.");
    this.close(kind, id, "dismissed", by);
    return ok(this.log(by, "dismiss_reports", kind, id, reason));
  }

  /** A maintainer acted through another route (removed a notice, voided a proposal). */
  recordAction(by: string, action: ModerationAction, kind: ReportKind, id: string, reason: string) {
    this.close(kind, id, "actioned", by);
    this.log(by, action, kind, id, reason);
  }

  /** When a resident's suspension ends (ms), or undefined if they aren't suspended. */
  suspendedUntil(residentId: string): number | undefined {
    const row = this.rows(
      "SELECT until FROM suspensions WHERE resident_id = ? AND until > ?",
      residentId,
      this.o.now(),
    )[0];
    return row ? Number(row.until) : undefined;
  }

  private close(kind: ReportKind, id: string, status: "actioned" | "dismissed", by: string) {
    this.o.sql.exec(
      `UPDATE reports SET status = ?, closed_at = ?, closed_by = ?
        WHERE kind = ? AND target = ? AND status = 'open'`,
      status,
      this.o.now(),
      by,
      kind,
      id,
    );
  }

  private log(
    actor: string,
    action: ModerationAction,
    kind: ReportKind,
    id: string,
    reason: string,
    until?: number,
  ): ModerationLogEntry {
    const at = this.o.now();
    const values = [at, actor, action, kind, id, reason, ...(until === undefined ? [] : [until])];
    this.o.sql.exec(
      `INSERT INTO moderation_log (at, actor, action, kind, target, reason${until === undefined ? "" : ", until"})
        VALUES (${values.map(() => "?").join(", ")})`,
      ...values,
    );
    // Who and what, never the text that was moderated.
    console.info(`Moderation log: ${action} ${kind} ${id} by ${actor}`);
    return {
      action,
      kind,
      id,
      reason,
      at: iso(at),
      ...(until === undefined ? {} : { until: iso(until) }),
    };
  }

  // ---------- transparency ----------

  transparency(): TransparencyResponse {
    const byReason = Object.fromEntries(REPORT_REASONS.map((r) => [r, 0])) as Record<
      ReportReason,
      number
    >;
    for (const row of this.rows("SELECT reason, COUNT(*) AS c FROM reports GROUP BY reason")) {
      const reason = String(row.reason) as ReportReason;
      if (reason in byReason) byReason[reason] = Number(row.c);
    }
    const actions = Object.fromEntries(MODERATION_ACTIONS.map((a) => [a, 0])) as Record<
      ModerationAction,
      number
    >;
    for (const row of this.rows(
      "SELECT action, COUNT(*) AS c FROM moderation_log GROUP BY action",
    )) {
      const action = String(row.action) as ModerationAction;
      if (action in actions) actions[action] = Number(row.c);
    }
    const filters = this.o.moderation();
    const refused = filters.reduce(
      (sum, m) => {
        for (const [k, v] of Object.entries(m.counts())) sum[k as keyof typeof sum] += v;
        return sum;
      },
      { injection: 0, hate: 0, vulgar: 0, scam: 0, spam: 0, cooldown: 0 },
    );
    return {
      generatedAt: iso(this.o.now()),
      reports: {
        total: this.count("SELECT COUNT(*) AS c FROM reports"),
        open: this.count("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'"),
        byReason,
      },
      actions,
      suspendedNow: this.count(
        "SELECT COUNT(*) AS c FROM suspensions WHERE until > ?",
        this.o.now(),
      ),
      filters: { since: iso(Math.min(...filters.map((m) => m.since))), refused },
    };
  }
}

const NOT_FOUND: Record<ReportKind, string> = {
  post: "No such post.",
  resident: "No such resident.",
  letter: "No such letter.",
  notice: "No such notice.",
  proposal: "No such proposal.",
};

function reportView(row: Row): ReportView {
  return {
    id: String(row.id),
    kind: String(row.kind) as ReportKind,
    target: String(row.target),
    reason: String(row.reason) as ReportReason,
    status: String(row.status) as ReportView["status"],
    createdAt: iso(Number(row.created_at)),
  };
}
