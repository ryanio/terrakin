import { byPrefix } from "./models";
import type { SqlExec } from "./sql-store";

/**
 * The AI spend ledger: one row for every model call that went out, from triage and from townsfolk
 * chatter, kept for good (a few rows a day) so spend can be read back by day, purpose, and model.
 *
 * The caps never read it. Each caller keeps its own counters and checks them before it fetches, so
 * a guard never depends on this table, and a call a guard refused spent nothing and has no row.
 *
 * A row holds codes and counts only: the purpose, a trigger code (`report` or `filter` for triage,
 * the persona's handle for chatter), the model, the token counts from the response's `usage`, the
 * cost, and the outcome. Never resident text, never a resident id (packages/server/AGENTS.md,
 * telemetry).
 */

type SpendPurpose = "triage" | "chatter";

/** Token counts as the Messages API reports them in `usage`. Input excludes cache reads and writes. */
export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const NO_TOKENS: TokenCounts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** US dollars per million tokens. A cache write is the 5-minute one (1.25 times input). */
interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface Price extends Rates {
  /**
   * Rates for every token of a call whose prompt (input plus cache reads and writes) is over
   * `promptOver` tokens, for a model priced by prompt size.
   */
  long?: Rates & { promptOver: number };
}

/**
 * Anthropic's first-party prices when this was written, matched by model id prefix, longest first.
 * Each row's cost is worked out when the call is made, so a later change here never rewrites
 * history. Add a model before pointing a setting at it.
 */
const PRICES: readonly (readonly [prefix: string, price: Price])[] = [
  ["claude-fable-5", { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  ["claude-opus-5-5", { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }],
  ["claude-opus-5", { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["claude-opus-4-8", { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["claude-opus-4-7", { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["claude-opus-4-6", { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ["claude-opus-4-5", { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  // Opus 4 and 4.1.
  ["claude-opus-4", { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 }],
  ["claude-sonnet-5-5", { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ["claude-sonnet-5", { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ["claude-sonnet-4", { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  [
    "claude-haiku-5-5",
    {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
      long: { promptOver: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
    },
  ],
  ["claude-haiku-4", { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
];

/** An unknown model is priced as the dearest one we know, so the ledger never reads low. */
const DEAREST = PRICES.reduce<Price>((most, [, p]) => (p.output > most.output ? p : most), {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

export function priceOf(model: string): Price {
  return byPrefix(PRICES, model) ?? DEAREST;
}

/** What a call cost, in millionths of a US dollar. A price per million tokens is micro-dollars per token. */
export function costMicroUsd(model: string, tokens: TokenCounts): number {
  const price = priceOf(model);
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  const p = price.long && prompt > price.long.promptOver ? price.long : price;
  return Math.round(
    tokens.input * p.input +
      tokens.output * p.output +
      tokens.cacheRead * p.cacheRead +
      tokens.cacheWrite * p.cacheWrite,
  );
}

const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** The token counts in a Messages API response's `usage`, with anything missing as zero. */
export function tokensOf(usage: unknown): TokenCounts {
  const u = (usage ?? {}) as Record<string, unknown>;
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheRead: count(u.cache_read_input_tokens),
    cacheWrite: count(u.cache_creation_input_tokens),
  };
}

export interface SpendEntry {
  purpose: SpendPurpose;
  /** `report` or `filter` for triage; the persona's handle for chatter. A code, never an id. */
  trigger: string;
  /** The model that answered (the response's `model`), else the one asked for. */
  model: string;
  tokens: TokenCounts;
  /** For triage, the suggested action, `invalid`, `refusal`, or `error`; for chatter, see `ChatterOutcome`. */
  outcome: string;
  /** For chatter: `post`, `reply`, `like`, or `none`. */
  action?: string;
}

/** One line of the staff summary: a purpose and model over the window. */
interface SpendLine {
  purpose: string;
  model: string;
  calls: number;
  microUsd: number;
  /** Cache reads as a share of all input tokens, 0 to 1. */
  cacheReadShare: number;
}

export interface SpendSummary {
  todayMicroUsd: number;
  /** The last `SUMMARY_DAYS` UTC days, today included. */
  windowMicroUsd: number;
  lines: SpendLine[];
  /**
   * Chatter outcomes over the window, for cost per note and the share refused: notes that went up,
   * a dry run's would-be notes, and answers turned away.
   */
  chatter: { calls: number; notes: number; drafts: number; refused: number; microUsd: number };
}

const DAY_MS = 86_400_000;
export const SUMMARY_DAYS = 30;

/** Chatter outcomes that put a note on the wall. */
const NOTE_OUTCOMES = ["posted", "replied"];
/** A dry run's would-be notes. */
const DRAFT_OUTCOMES = ["draft_post", "draft_reply"];
/** Chatter outcomes where the answer was turned away. */
const REFUSED_OUTCOMES = ["filtered", "invalid", "refusal"];

export class AiSpend {
  constructor(
    private readonly sql: SqlExec,
    private readonly now: () => number = Date.now,
  ) {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS ai_spend (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        day INTEGER NOT NULL,
        purpose TEXT NOT NULL,
        trigger TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        cost_micro_usd INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        action TEXT NOT NULL
      )`,
    );
    sql.exec("CREATE INDEX IF NOT EXISTS ai_spend_day ON ai_spend (day, purpose)");
  }

  /** Add a row for one call that went out. Never throws: the ledger can't break the call it records. */
  record(entry: SpendEntry): void {
    const at = this.now();
    try {
      this.sql.exec(
        `INSERT INTO ai_spend (at, day, purpose, trigger, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, cost_micro_usd, outcome, action)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        at,
        Math.floor(at / DAY_MS),
        entry.purpose,
        entry.trigger,
        entry.model,
        entry.tokens.input,
        entry.tokens.output,
        entry.tokens.cacheRead,
        entry.tokens.cacheWrite,
        costMicroUsd(entry.model, entry.tokens),
        entry.outcome,
        entry.action ?? "none",
      );
    } catch (err) {
      console.error("AI spend row not written", err instanceof Error ? err.name : "");
    }
  }

  /** Spend today and over the last `days` UTC days, by purpose and model, for the staff app. */
  summary(days = SUMMARY_DAYS): SpendSummary {
    const today = Math.floor(this.now() / DAY_MS);
    const from = today - days + 1;
    const rows = [
      ...this.sql.exec(
        `SELECT purpose, model, COUNT(*) AS calls, SUM(cost_micro_usd) AS cost,
            SUM(input_tokens) AS input, SUM(cache_read_tokens) AS cache_read,
            SUM(cache_write_tokens) AS cache_write
          FROM ai_spend WHERE day >= ? GROUP BY purpose, model ORDER BY cost DESC`,
        from,
      ),
    ];
    const lines: SpendLine[] = rows.map((r) => {
      const read = Number(r.cache_read ?? 0);
      const allInput = Number(r.input ?? 0) + read + Number(r.cache_write ?? 0);
      return {
        purpose: String(r.purpose),
        model: String(r.model),
        calls: Number(r.calls ?? 0),
        microUsd: Number(r.cost ?? 0),
        cacheReadShare: allInput > 0 ? read / allInput : 0,
      };
    });
    const total = (where: string, ...bindings: (string | number)[]) =>
      Number(
        [
          ...this.sql.exec(
            `SELECT COALESCE(SUM(cost_micro_usd), 0) AS c FROM ai_spend WHERE ${where}`,
            ...bindings,
          ),
        ][0]?.c ?? 0,
      );
    const counted = (outcomes: string[]) =>
      Number(
        [
          ...this.sql.exec(
            `SELECT COUNT(*) AS c FROM ai_spend WHERE day >= ? AND purpose = 'chatter'
              AND outcome IN (${outcomes.map(() => "?").join(", ")})`,
            from,
            ...outcomes,
          ),
        ][0]?.c ?? 0,
      );
    const chatterLines = lines.filter((l) => l.purpose === "chatter");
    return {
      todayMicroUsd: total("day = ?", today),
      windowMicroUsd: total("day >= ?", from),
      lines,
      chatter: {
        calls: chatterLines.reduce((sum, l) => sum + l.calls, 0),
        notes: counted(NOTE_OUTCOMES),
        drafts: counted(DRAFT_OUTCOMES),
        refused: counted(REFUSED_OUTCOMES),
        microUsd: chatterLines.reduce((sum, l) => sum + l.microUsd, 0),
      },
    };
  }
}
