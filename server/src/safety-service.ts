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
  type ModerationLogView,
  REPORT_REASONS,
  type ReportKind,
  type ReportQueueItem,
  type ReportQueueResponse,
  type ReportReason,
  type ReportTarget,
  type ReportView,
  SEVERITIES,
  type Severity,
  type TransparencyResponse,
  type TriageAction,
  type TriageCategory,
  type TriageVerdictView,
} from "@terrakin/protocol";
import type { Resident } from "@terrakin/sim";
import { aimedAtReader, readerMessage } from "./injection";
import type { Moderation } from "./moderation";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";
import { cleanMultiline } from "./text";
import type { RawVerdict, TriageClient } from "./triage";

/**
 * Reports, the review queue, hiding posts, quarantining bios and notes, suspensions, AI triage
 * verdicts and how staff agreed with them, the moderation log, and the transparency numbers
 * (RFC 0006, decisions 0033 and 0040). Owned by `SocialService` as `social.safety`, sharing its
 * tables. Who may call the staff methods is checked by the API before they run.
 */

export interface SafetyOptions {
  sql: SqlExec;
  now: () => number;
  resident: (id: string) => Resident | undefined;
  author: (id: string) => AuthorView | undefined;
  /** Maintainers and moderators: they can't be suspended or quarantined through the API. */
  cannotBeSuspended: (id: string) => boolean;
  /** Staff and townsfolk: their posts are never hidden automatically, by reports or by triage. */
  neverAutoHidden: (id: string) => boolean;
  /** Whole days since a resident joined, for the auto-hide rule and the queue's context. */
  residentAgeDays: (id: string) => number;
  /** A Town Hall proposal from the world, for reports on one. */
  proposal: (id: string) => { author: string; title: string; text: string } | undefined;
  /** A post's files, as its view shows them. */
  postMedia: (postId: string) => MediaView[];
  /** A resident's avatar and banner files, so a profile report shows its pictures. */
  profileMedia: (residentId: string) => MediaView[];
  /** Take down every file on a post, everywhere it's used. Resolves to how many couldn't be deleted. */
  dropPostMedia: (postId: string) => Promise<number>;
  /** Take one file down everywhere, storage first. False when storage refused and nothing changed. */
  purgeMedia: (mediaId: string) => Promise<boolean>;
  /** The edge filters, for their refusal counts and strikes. */
  moderation: () => Moderation[];
  /** AI triage. Without it (or without a key), reports wait for people as before. */
  triage?: TriageClient | undefined;
}

type Row = Record<string, unknown>;

const fail = (code: ErrorCode, message: string) => ({ ok: false as const, code, message });
const ok = <T>(value: T) => ({ ok: true as const, value });
const iso = (ms: number) => new Date(ms).toISOString();
const DAY_MS = 86_400_000;

const randomId = (prefix: string) =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** `posts.hidden`: 0 shown, 1 hidden by staff, 2 hidden automatically until reviewed. */
export const HIDDEN = { no: 0, maintainer: 1, auto: 2 } as const;

/** Posts by a suspended resident stay out of view. Bind `now` once for each use. */
export const NOT_SUSPENDED = (column: string) =>
  `${column} NOT IN (SELECT resident_id FROM suspensions WHERE until > ?)`;

/** How many report groups the queue reads at most, most urgent first. */
export const QUEUE_WINDOW = 500;

/** The actors that aren't people, in the moderation log and on triage-raised reports. */
export const TRIAGE_ACTOR = "triage";
export const SYSTEM_ACTOR = "system";

/** Categories triage acts on by itself, at high confidence and high or critical severity. */
const AUTO_CATEGORIES: ReadonlySet<TriageCategory> = new Set(["spam", "scam", "hate", "sexual"]);
/** Categories a person must see today, and triage never acts on against the person. */
const NEEDS_HUMAN: ReadonlySet<TriageCategory> = new Set(["minors", "csam", "self_harm"]);
const AUTO_CONFIDENCE = 0.9;
/**
 * Suspected CSAM is hidden at once when triage is at least this sure and something besides triage
 * backs it up (see `corroborated`). A person still has to look the same day.
 */
const CSAM_CONFIDENCE = 0.7;

/** The report reason a triage-raised item is filed under. */
const REASON_FOR: Record<TriageCategory, ReportReason> = {
  none: "other",
  spam: "spam",
  scam: "scam",
  hate: "hate",
  harassment: "harassment",
  sexual: "sexual",
  minors: "other",
  csam: "sexual",
  self_harm: "self_harm",
  impersonation: "impersonation",
  doxxing: "harassment",
  prompt_injection: "spam",
  other: "other",
};

/** Which staff actions count as following each triage suggestion, for the agreement numbers. */
const AGREES: Record<TriageAction, ReadonlySet<ModerationAction> | "any"> = {
  hide: new Set([
    "hide_post",
    "quarantine",
    "remove_pictures",
    "remove_notice",
    "void_proposal",
    "suspend",
  ]),
  suspend: new Set(["suspend"]),
  dismiss: new Set(["dismiss_reports", "unhide_post", "release"]),
  warn: new Set(["dismiss_reports", "unhide_post", "release"]),
  escalate: "any",
};

/** FNV-1a, enough to tell evidence apart. Not for anything secret. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}:${text.length}`;
}

export class SafetyService {
  private readonly o: SafetyOptions;
  /** Triage calls in flight, by target, so one target is never read twice at once. */
  private readonly inFlight = new Set<string>();
  private readonly pending = new Set<Promise<void>>();

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
      // Bios and notes held back from view, pending review. Deleted on release.
      `CREATE TABLE IF NOT EXISTS quarantine (
        resident_id TEXT PRIMARY KEY, by TEXT NOT NULL, at INTEGER NOT NULL
      )`,
      // Every staff, triage, and automatic action: who, what, when, and why. Rows are only added.
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
      // AI triage's verdicts. `evidence` fingerprints what it read, so new evidence reads again.
      `CREATE TABLE IF NOT EXISTS triage_verdicts (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        evidence TEXT NOT NULL,
        trigger TEXT NOT NULL,
        category TEXT NOT NULL,
        severity TEXT NOT NULL,
        confidence REAL NOT NULL,
        rationale TEXT NOT NULL,
        action TEXT NOT NULL,
        days INTEGER,
        injection INTEGER NOT NULL,
        auto_action TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS triage_verdicts_target ON triage_verdicts (kind, target, n)",
      "CREATE INDEX IF NOT EXISTS triage_verdicts_trigger ON triage_verdicts (trigger, created_at)",
      // What staff decided after triage suggested something: the agreement numbers.
      `CREATE TABLE IF NOT EXISTS triage_evals (
        verdict_id TEXT PRIMARY KEY,
        suggested TEXT NOT NULL,
        decision TEXT NOT NULL,
        agree INTEGER NOT NULL,
        actor TEXT NOT NULL,
        at INTEGER NOT NULL
      )`,
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
    // Notes skip the other filters, since a fair note may quote what was said. Orders aimed at
    // an AI reader are still turned away: staff may read the queue through an assistant.
    const aimed = aimedAtReader(request.note ?? "");
    if (aimed) return fail("bad_request", readerMessage("A report note", aimed));
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
    this.requestTriage(kind, id, reporter);
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
    const post = this.rows("SELECT hidden, author FROM posts WHERE id = ?", postId)[0];
    if (!post || Number(post.hidden) !== HIDDEN.no) return;
    // Free accounts could gang up on the team's posts. Those wait for a person in the queue.
    if (this.o.neverAutoHidden(String(post.author))) return;
    const reporters = this.rows(
      "SELECT DISTINCT reporter FROM reports WHERE kind = 'post' AND target = ? AND status = 'open'",
      postId,
    ).filter((r) => this.o.residentAgeDays(String(r.reporter)) >= AUTO_HIDE.reporterAgeDays);
    if (reporters.length < AUTO_HIDE.reports) return;
    this.o.sql.exec("UPDATE posts SET hidden = ? WHERE id = ?", HIDDEN.auto, postId);
    this.log(
      SYSTEM_ACTOR,
      "auto_hide_post",
      "post",
      postId,
      `${reporters.length} reports from residents here at least ${AUTO_HIDE.reporterAgeDays} days`,
    );
  }

  // ---------- AI triage ----------

  get triageEnabled(): boolean {
    return this.o.triage?.enabled === true;
  }

  /**
   * Ask AI triage to read something: after a report (`reporter` set), or when a filter saw a
   * borderline signal in public text (`reporter` undefined). Runs in the background. Skipped when
   * triage is off, when this exact evidence was already read, when it's being read right now, or
   * when one reporter has already caused their share of calls today.
   */
  requestTriage(kind: ReportKind, id: string, reporter?: string) {
    const triage = this.o.triage;
    if (!triage?.enabled) return;
    const target = this.target(kind, id);
    if (!target.exists || target.text.trim() === "") return;
    const reports = this.rows(
      "SELECT id, reason, note FROM reports WHERE kind = ? AND target = ? AND status = 'open' ORDER BY id",
      kind,
      id,
    );
    const evidence = fingerprint(`${target.text}\n${reports.map((r) => String(r.id)).join(",")}`);
    const key = `${kind}:${id}`;
    const latest = this.latestVerdictRow(kind, id);
    if (latest && String(latest.evidence) === evidence) return;
    if (this.inFlight.has(key)) return;
    const authorId = kind === "resident" ? id : target.author?.id;
    // Each reporter, and each author whose text a filter flagged, can cause only so many calls a
    // day, so nobody can spend the day's budget alone.
    const trigger = reporter ?? `filter:${authorId ?? key}`;
    const limit = reporter ? triage.config.perReporterPerDay : triage.config.perAuthorFilterPerDay;
    if (!triage.takeTrigger(trigger, limit)) return;

    const facts = [
      reports.length
        ? `Open reports: ${reports.length} (reasons: ${[...new Set(reports.map((r) => String(r.reason)))].join(", ")}).`
        : "No reports yet: Terrakin's filter flagged it as borderline.",
      ...(authorId ? this.authorFacts(authorId) : []),
      ...(target.media.length ? [`It has ${target.media.length} attached files (not shown).`] : []),
    ];
    this.inFlight.add(key);
    const run = triage
      .classify(
        {
          kind: kind === "resident" ? "resident profile (name, note, and bio)" : kind,
          text: target.text,
          notes: reports.map((r) => String(r.note)).filter(Boolean),
          facts,
        },
        reporter ? "report" : "filter",
      )
      .then((result) => {
        if (result.ok) this.applyVerdict(kind, id, evidence, trigger, result.verdict, result.model);
      })
      .catch((err: unknown) => {
        console.error("Triage failed", err instanceof Error ? err.name : "");
      })
      .finally(() => {
        this.inFlight.delete(key);
        this.pending.delete(run);
      });
    this.pending.add(run);
  }

  /** Wait for triage calls in flight. For tests and shutdown. */
  async settle() {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  private authorFacts(residentId: string): string[] {
    const record = this.record(residentId);
    if (!record) return [];
    return [
      `The author joined ${record.joinedDaysAgo} days ago, has had ${record.postsHidden} posts hidden and ${record.suspensions} suspensions, and ${record.reportsAgainst} reports against them.`,
    ];
  }

  /**
   * Whether triage may take its reversible step (hide a post, hold back a bio and note) without a
   * person. Every one of these must hold:
   *
   * - the content still exists, and the model saw the problem in the content itself, not only in
   *   what a report note claims, and didn't flag the text as aimed at an AI reader;
   * - the author isn't staff or townsfolk, who wait for a person instead;
   * - staff haven't already undone a step on it (unhid the post, released the bio and note);
   * - spam, scams, hate, or sexual content at high or critical severity and at least 90% sure; or
   *   suspected CSAM at least 70% sure and backed by something besides triage (`corroborated`).
   */
  private mayActAlone(kind: ReportKind, id: string, target: ReportTarget, v: RawVerdict): boolean {
    if (!target.exists || v.injection_attempt || v.content_shows_it !== true) return false;
    if (kind !== "post" && kind !== "resident") return false;
    const author = kind === "resident" ? id : target.author?.id;
    if (!author || this.o.neverAutoHidden(author)) return false;
    const undo = kind === "post" ? "unhide_post" : "release";
    const undone = this.count(
      "SELECT COUNT(*) AS c FROM moderation_log WHERE action = ? AND kind = ? AND target = ? AND actor <> ?",
      undo,
      kind,
      id,
      TRIAGE_ACTOR,
    );
    if (undone > 0) return false;
    if (v.category === "csam") {
      return v.confidence >= CSAM_CONFIDENCE && this.corroborated(kind, id, target);
    }
    return (
      v.confidence >= AUTO_CONFIDENCE &&
      AUTO_CATEGORIES.has(v.category) &&
      (v.severity === "high" || v.severity === "critical")
    );
  }

  /**
   * Something besides triage backs a report up: two or more residents reported it, or a resident
   * who's been here a while reported a post that has files.
   */
  private corroborated(kind: ReportKind, id: string, target: ReportTarget): boolean {
    const reporters = this.rows(
      "SELECT DISTINCT reporter FROM reports WHERE kind = ? AND target = ? AND status = 'open' AND reporter <> ?",
      kind,
      id,
      TRIAGE_ACTOR,
    ).map((r) => String(r.reporter));
    if (reporters.length >= 2) return true;
    return (
      target.media.length > 0 &&
      reporters.some((r) => this.o.residentAgeDays(r) >= AUTO_HIDE.reporterAgeDays)
    );
  }

  /** Store a verdict and take the automatic, reversible actions RFC 0006 allows. */
  private applyVerdict(
    kind: ReportKind,
    id: string,
    evidence: string,
    trigger: string,
    v: RawVerdict,
    model: string,
  ) {
    const target = this.target(kind, id);
    let autoAction: TriageVerdictView["autoAction"] = "none";
    const reason = `AI triage: ${v.category}, ${v.severity}, confidence ${v.confidence.toFixed(2)}`;
    if (this.mayActAlone(kind, id, target, v)) {
      if (kind === "post" && target.hidden === "no") {
        this.o.sql.exec("UPDATE posts SET hidden = ? WHERE id = ?", HIDDEN.auto, id);
        this.log(TRIAGE_ACTOR, "auto_hide_post", "post", id, reason);
        autoAction = "hide_post";
      } else if (kind === "resident" && !target.quarantined) {
        this.o.sql.exec(
          "INSERT OR IGNORE INTO quarantine (resident_id, by, at) VALUES (?, ?, ?)",
          id,
          TRIAGE_ACTOR,
          this.o.now(),
        );
        this.log(TRIAGE_ACTOR, "quarantine", "resident", id, reason);
        autoAction = "quarantine";
      }
    }
    this.o.sql.exec(
      `INSERT INTO triage_verdicts (id, kind, target, evidence, trigger, category, severity, confidence,
        rationale, action, days, injection, auto_action, model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomId("tv"),
      kind,
      id,
      evidence,
      trigger,
      v.category,
      v.severity,
      v.confidence,
      v.rationale,
      v.action,
      v.suspend_days ?? 0,
      v.injection_attempt ? 1 : 0,
      autoAction,
      model,
      this.o.now(),
    );
    // A borderline item triage thinks needs a look goes into the queue under triage's name.
    const flagged = v.category !== "none" && v.action !== "dismiss";
    const open = this.count(
      "SELECT COUNT(*) AS c FROM reports WHERE kind = ? AND target = ? AND status = 'open'",
      kind,
      id,
    );
    if (flagged && open === 0) {
      this.o.sql.exec(
        `INSERT INTO reports (id, kind, target, reporter, reason, note, created_at)
          VALUES (?, ?, ?, ?, ?, '', ?)
          ON CONFLICT (reporter, kind, target) DO UPDATE SET status = 'open', reason = excluded.reason,
          created_at = excluded.created_at, closed_at = NULL, closed_by = NULL`,
        randomId("rp"),
        kind,
        id,
        TRIAGE_ACTOR,
        REASON_FOR[v.category],
        this.o.now(),
      );
    }
  }

  private latestVerdictRow(kind: ReportKind, id: string): Row | undefined {
    return this.rows(
      "SELECT * FROM triage_verdicts WHERE kind = ? AND target = ? ORDER BY n DESC LIMIT 1",
      kind,
      id,
    )[0];
  }

  private verdictView(row: Row | undefined): TriageVerdictView | null {
    if (!row) return null;
    const days = Number(row.days);
    return {
      id: String(row.id),
      category: String(row.category) as TriageCategory,
      severity: String(row.severity) as Severity,
      confidence: Number(row.confidence),
      rationale: String(row.rationale),
      action: String(row.action) as TriageAction,
      ...(days > 0 ? { days } : {}),
      injectionAttempt: Number(row.injection) === 1,
      autoAction: String(row.auto_action) as TriageVerdictView["autoAction"],
      model: String(row.model),
      createdAt: iso(Number(row.created_at)),
    };
  }

  /** Record what staff decided about something triage read, once per verdict. */
  private recordDecision(actor: string, kind: ReportKind, id: string, action: ModerationAction) {
    if (actor === TRIAGE_ACTOR || actor === SYSTEM_ACTOR) return;
    const latest = this.latestVerdictRow(kind, id);
    if (!latest) return;
    const suggested = String(latest.action) as TriageAction;
    const agrees = AGREES[suggested];
    const agree = agrees === "any" || agrees.has(action);
    this.o.sql.exec(
      `INSERT OR IGNORE INTO triage_evals (verdict_id, suggested, decision, agree, actor, at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      String(latest.id),
      suggested,
      action,
      agree ? 1 : 0,
      actor,
      this.o.now(),
    );
  }

  /** How triage is doing today, for the admin overview. */
  triageStatus() {
    const triage = this.o.triage;
    const usage = triage?.usage() ?? { calls: 0, tokens: 0 };
    const paused = triage?.pausedUntil() ?? null;
    const evals = this.rows(
      "SELECT COUNT(*) AS c, COALESCE(SUM(agree), 0) AS a FROM triage_evals",
    )[0];
    return {
      enabled: triage?.enabled === true,
      model: triage?.config.model ?? "",
      callsToday: usage.calls,
      callsPerDay: triage?.config.callsPerDay ?? 0,
      tokensToday: usage.tokens,
      tokensPerDay: triage?.config.tokensPerDay ?? 0,
      pausedUntil: paused === null ? null : iso(paused),
      agreement: { decided: Number(evals?.c ?? 0), agreed: Number(evals?.a ?? 0) },
    };
  }

  // ---------- the queue ----------

  /**
   * Open reports grouped by what they point at: anything a person must see today first, then by
   * triage severity (untriaged counts as medium), then oldest first.
   */
  queue(limit?: number, window = QUEUE_WINDOW): ReportQueueResponse {
    const n = Math.floor(Number(limit));
    const size = Number.isFinite(n) ? Math.max(1, Math.min(FEED_MAX_LIMIT, n)) : FEED_DEFAULT_LIMIT;
    // The database puts urgent items first before it cuts the window, so a flood of ordinary
    // reports can never push a suspected minor, CSAM, or self-harm report out of view.
    const latest = (column: string) =>
      `(SELECT v.${column} FROM triage_verdicts v WHERE v.kind = r.kind AND v.target = r.target
        ORDER BY v.n DESC LIMIT 1)`;
    const groups = this.rows(
      `SELECT kind, target, MIN(created_at) AS first, MAX(created_at) AS last,
          MAX(reason = 'self_harm') AS self_harm, ${latest("category")} AS category,
          ${latest("severity")} AS severity
        FROM reports r WHERE status = 'open' GROUP BY kind, target
        ORDER BY (self_harm = 1 OR category IN (${[...NEEDS_HUMAN].map((c) => `'${c}'`).join(", ")})) DESC,
          CASE COALESCE(severity, 'medium')
            ${SEVERITIES.map((sev, i) => `WHEN '${sev}' THEN ${i}`).join(" ")} ELSE 0 END DESC,
          first ASC
        LIMIT ?`,
      window,
    );
    const items: ReportQueueItem[] = groups.map((g) => {
      const kind = String(g.kind) as ReportKind;
      const id = String(g.target);
      const reports = this.rows(
        "SELECT * FROM reports WHERE kind = ? AND target = ? AND status = 'open' ORDER BY n",
        kind,
        id,
      ).map((r) => {
        const triaged = r.reporter === TRIAGE_ACTOR;
        return {
          id: String(r.id),
          reason: String(r.reason) as ReportReason,
          note: String(r.note),
          reporter: triaged ? null : (this.o.author(String(r.reporter)) ?? null),
          source: triaged ? ("triage" as const) : ("resident" as const),
          createdAt: iso(Number(r.created_at)),
        };
      });
      const target = this.target(kind, id);
      const triage = this.verdictView(this.latestVerdictRow(kind, id));
      const authorId = kind === "resident" ? id : target.author?.id;
      return {
        kind,
        id,
        reports,
        firstReportedAt: iso(Number(g.first)),
        lastReportedAt: iso(Number(g.last)),
        target,
        context: {
          reporters: reports.filter((r) => r.source === "resident").length,
          author: authorId ? this.record(authorId) : null,
        },
        triage,
        needsHuman:
          (triage !== null && NEEDS_HUMAN.has(triage.category)) ||
          reports.some((r) => r.reason === "self_harm"),
      };
    });
    const rank = (item: ReportQueueItem) => SEVERITIES.indexOf(item.triage?.severity ?? "medium");
    items.sort(
      (a, b) =>
        Number(b.needsHuman) - Number(a.needsHuman) ||
        rank(b) - rank(a) ||
        a.firstReportedAt.localeCompare(b.firstReportedAt),
    );
    return {
      items: items.slice(0, size),
      open: this.count("SELECT COUNT(*) AS c FROM reports WHERE status = 'open'"),
    };
  }

  /** A resident's record, for the queue and for triage's facts. */
  private record(residentId: string) {
    if (!this.o.resident(residentId)) return null;
    const strikes = Math.max(0, ...this.o.moderation().map((m) => m.strikeCount(residentId)));
    return {
      joinedDaysAgo: Math.max(0, Math.min(100_000, this.o.residentAgeDays(residentId))),
      postsHidden: this.count(
        "SELECT COUNT(*) AS c FROM posts WHERE author = ? AND hidden != 0",
        residentId,
      ),
      suspensions: this.count(
        "SELECT COUNT(*) AS c FROM moderation_log WHERE action = 'suspend' AND target = ?",
        residentId,
      ),
      reportsAgainst: this.count(
        `SELECT COUNT(*) AS c FROM reports r WHERE r.reporter != ? AND (
          (r.kind = 'resident' AND r.target = ?)
          OR (r.kind = 'post' AND r.target IN (SELECT id FROM posts WHERE author = ?)))`,
        TRIAGE_ACTOR,
        residentId,
        residentId,
      ),
      strikes,
    };
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
      quarantined: author ? this.isQuarantined(author) : false,
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
      return base(id, [r.name, r.note, String(bio ?? "")].filter(Boolean).join("\n"), {
        media: this.o.profileMedia(id),
      });
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

  // ---------- staff actions ----------

  async hidePost(
    by: string,
    postId: string,
    reason: string,
  ): Promise<SocialResult<ModerationLogEntry>> {
    if (!this.rows("SELECT id FROM posts WHERE id = ?", postId)[0]) {
      return fail("not_found", "No such post.");
    }
    this.o.sql.exec("UPDATE posts SET hidden = ? WHERE id = ?", HIDDEN.maintainer, postId);
    const kept = await this.o.dropPostMedia(postId);
    this.close("post", postId, "actioned", by);
    const entry = this.act(by, "hide_post", "post", postId, reason);
    // Never report a takedown that didn't happen: the file would still be served.
    if (kept > 0) {
      return fail(
        "internal",
        `The post is hidden, but ${kept === 1 ? "1 of its files" : `${kept} of its files`} couldn't be deleted from storage yet. Hide it again to retry.`,
      );
    }
    return ok(entry);
  }

  unhidePost(by: string, postId: string, reason: string): SocialResult<ModerationLogEntry> {
    const row = this.rows("SELECT hidden FROM posts WHERE id = ?", postId)[0];
    if (!row) return fail("not_found", "No such post.");
    if (Number(row.hidden) === HIDDEN.no) return fail("bad_request", "That post isn't hidden.");
    this.o.sql.exec("UPDATE posts SET hidden = ? WHERE id = ?", HIDDEN.no, postId);
    // Unhiding says the reports were wrong, so they close, and the post can't be hidden again by them.
    this.close("post", postId, "dismissed", by);
    return ok(this.act(by, "unhide_post", "post", postId, reason));
  }

  suspend(
    by: string,
    residentId: string,
    days: number,
    reason: string,
  ): SocialResult<ModerationLogEntry> {
    if (!this.o.resident(residentId)) return fail("not_found", "No such resident.");
    if (residentId === by) return fail("bad_request", "You can't suspend yourself.");
    if (this.o.cannotBeSuspended(residentId)) {
      return fail(
        "bad_request",
        "Maintainers and moderators can't be suspended. Take them off the staff list first.",
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
    return ok(this.act(by, "suspend", "resident", residentId, reason, until));
  }

  unsuspend(by: string, residentId: string, reason: string): SocialResult<ModerationLogEntry> {
    if (!this.o.resident(residentId)) return fail("not_found", "No such resident.");
    if (this.suspendedUntil(residentId) === undefined) {
      return fail("bad_request", "That resident isn't suspended.");
    }
    this.o.sql.exec("DELETE FROM suspensions WHERE resident_id = ?", residentId);
    return ok(this.act(by, "unsuspend", "resident", residentId, reason));
  }

  quarantine(by: string, residentId: string, reason: string): SocialResult<ModerationLogEntry> {
    if (!this.o.resident(residentId)) return fail("not_found", "No such resident.");
    if (this.o.cannotBeSuspended(residentId))
      return fail("bad_request", "Staff can't be quarantined.");
    if (this.isQuarantined(residentId)) return fail("bad_request", "Already quarantined.");
    this.o.sql.exec(
      "INSERT INTO quarantine (resident_id, by, at) VALUES (?, ?, ?)",
      residentId,
      by,
      this.o.now(),
    );
    this.close("resident", residentId, "actioned", by);
    return ok(this.act(by, "quarantine", "resident", residentId, reason));
  }

  release(by: string, residentId: string, reason: string): SocialResult<ModerationLogEntry> {
    if (!this.o.resident(residentId)) return fail("not_found", "No such resident.");
    if (!this.isQuarantined(residentId))
      return fail("bad_request", "That resident isn't quarantined.");
    this.o.sql.exec("DELETE FROM quarantine WHERE resident_id = ?", residentId);
    this.close("resident", residentId, "dismissed", by);
    return ok(this.act(by, "release", "resident", residentId, reason));
  }

  /**
   * Take a resident's avatar and banner down everywhere, storage first. Like hiding a post, it never
   * reports success while a file is still stored; one that storage refused stays on the profile, so
   * calling again retries it.
   */
  async removePictures(
    by: string,
    residentId: string,
    reason: string,
  ): Promise<SocialResult<ModerationLogEntry>> {
    if (!this.o.resident(residentId)) return fail("not_found", "No such resident.");
    if (this.o.cannotBeSuspended(residentId)) {
      return fail(
        "bad_request",
        "Staff's pictures can't be removed. Take them off the staff list first.",
      );
    }
    const row = this.rows(
      "SELECT avatar, banner FROM profiles WHERE resident_id = ?",
      residentId,
    )[0];
    const files = [...new Set([row?.avatar, row?.banner].filter((id) => id != null).map(String))];
    if (files.length === 0) return fail("bad_request", "They have no avatar or banner.");
    let kept = 0;
    for (const id of files) if (!(await this.o.purgeMedia(id))) kept++;
    // Logged only when a file actually went. A picture storage refused is still on the profile, so
    // its reports stay open and the item stays in the queue, where the retry is.
    const entry =
      kept < files.length
        ? this.act(by, "remove_pictures", "resident", residentId, reason)
        : undefined;
    if (kept > 0 || !entry) {
      return fail(
        "internal",
        `${kept === 1 ? "1 picture" : `${kept} pictures`} couldn't be deleted from storage yet. Remove them again to retry.`,
      );
    }
    this.close("resident", residentId, "actioned", by);
    return ok(entry);
  }

  /**
   * Who each report staff upheld between two times was against: one entry per reported thing,
   * named by its author (the resident, for a profile). For karma (decision 0055).
   */
  upheldAgainst(fromMs: number, toMs: number): string[] {
    const rows = this.rows(
      `SELECT DISTINCT kind, target,
        CASE kind
          WHEN 'resident' THEN target
          WHEN 'post' THEN (SELECT author FROM posts WHERE id = target)
          WHEN 'notice' THEN (SELECT author FROM notices WHERE id = target)
          WHEN 'letter' THEN (SELECT sender FROM letters WHERE id = target)
        END AS against
        FROM reports WHERE status = 'actioned' AND closed_at >= ? AND closed_at < ?`,
      fromMs,
      toMs,
    );
    return rows.flatMap((row) => {
      const against =
        row.kind === "proposal" ? this.o.proposal(String(row.target))?.author : row.against;
      return typeof against === "string" && against !== "" ? [against] : [];
    });
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
    return ok(this.act(by, "dismiss_reports", kind, id, reason));
  }

  /** Staff acted through another route (removed a notice, voided a proposal). */
  recordAction(by: string, action: ModerationAction, kind: ReportKind, id: string, reason: string) {
    this.close(kind, id, "actioned", by);
    this.act(by, action, kind, id, reason);
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

  /** A suspension in force: who set it and how long it has left. */
  currentSuspension(residentId: string): { by: string; remainingMs: number } | undefined {
    const now = this.o.now();
    const row = this.rows(
      "SELECT until, by FROM suspensions WHERE resident_id = ? AND until > ?",
      residentId,
      now,
    )[0];
    return row ? { by: String(row.by), remainingMs: Number(row.until) - now } : undefined;
  }

  /** Who held back a resident's bio and note, if anyone did. */
  quarantinedBy(residentId: string): string | undefined {
    const row = this.rows("SELECT by FROM quarantine WHERE resident_id = ?", residentId)[0];
    return row ? String(row.by) : undefined;
  }

  /** Whether a resident's bio and note are held back from view. */
  isQuarantined(residentId: string): boolean {
    return this.count("SELECT COUNT(*) AS c FROM quarantine WHERE resident_id = ?", residentId) > 0;
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

  /** A staff action: logged, and counted against triage's suggestion when there was one. */
  private act(
    actor: string,
    action: ModerationAction,
    kind: ReportKind,
    id: string,
    reason: string,
    until?: number,
  ): ModerationLogEntry {
    this.recordDecision(actor, kind, id, action);
    return this.log(actor, action, kind, id, reason, until);
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

  /** The log, newest first, for staff. */
  logPage(options: { limit?: number | undefined; before?: string | undefined }) {
    const n = Math.floor(Number(options.limit));
    const size = Number.isFinite(n) ? Math.max(1, Math.min(FEED_MAX_LIMIT, n)) : FEED_DEFAULT_LIMIT;
    const before = Number.parseInt(options.before ?? "", 36);
    const rows = Number.isFinite(before)
      ? this.rows(
          "SELECT * FROM moderation_log WHERE n < ? ORDER BY n DESC LIMIT ?",
          before,
          size + 1,
        )
      : this.rows("SELECT * FROM moderation_log ORDER BY n DESC LIMIT ?", size + 1);
    const page = rows.slice(0, size);
    const entries: ModerationLogView[] = page.map((row) => {
      const until = row.until === null || row.until === undefined ? undefined : Number(row.until);
      const actor = String(row.actor);
      return {
        action: String(row.action) as ModerationAction,
        kind: String(row.kind) as ReportKind,
        id: String(row.target),
        reason: String(row.reason),
        at: iso(Number(row.at)),
        ...(until === undefined ? {} : { until: iso(until) }),
        actor,
        actorView: this.o.author(actor) ?? null,
      };
    });
    const last = page.at(-1);
    return { entries, next: rows.length > size && last ? Number(last.n).toString(36) : null };
  }

  // ---------- transparency ----------

  transparency(): TransparencyResponse {
    const byReason = Object.fromEntries(REPORT_REASONS.map((r) => [r, 0])) as Record<
      ReportReason,
      number
    >;
    for (const row of this.rows(
      "SELECT reason, COUNT(*) AS c FROM reports WHERE reporter != ? GROUP BY reason",
      TRIAGE_ACTOR,
    )) {
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
        total: this.count("SELECT COUNT(*) AS c FROM reports WHERE reporter != ?", TRIAGE_ACTOR),
        open: this.count(
          "SELECT COUNT(*) AS c FROM reports WHERE status = 'open' AND reporter != ?",
          TRIAGE_ACTOR,
        ),
        byReason,
      },
      actions,
      suspendedNow: this.count(
        "SELECT COUNT(*) AS c FROM suspensions WHERE until > ?",
        this.o.now(),
      ),
      filters: { since: iso(Math.min(...filters.map((m) => m.since))), refused },
      triaged: this.count("SELECT COUNT(*) AS c FROM triage_verdicts"),
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
