import { describe, expect, it } from "vitest";
import { AiSpend, costMicroUsd, NO_TOKENS, priceOf, tokensOf, worstCostMicroUsd } from "./ai-spend";
import { nodeSql } from "./node-sql";
import { DEFAULT_TRIAGE, TriageClient } from "./triage";

const START = Date.UTC(2026, 9, 6, 15);
const DAY = 86_400_000;

describe("prices", () => {
  it("match a model by its longest known prefix, and price an unknown model at the dearest", () => {
    expect(priceOf("claude-sonnet-5-5").input).toBe(2);
    expect(priceOf("claude-sonnet-5").input).toBe(2);
    expect(priceOf("claude-opus-5-5").input).toBe(4);
    expect(priceOf("claude-opus-5").input).toBe(5);
    expect(priceOf("claude-haiku-4-5").output).toBe(5);
    // Haiku 5.5 has its own row and never borrows Haiku 4's or the dearest.
    expect(priceOf("claude-haiku-5-5").input).toBe(0.1);
    expect(priceOf("claude-opus-4-8").output).toBe(25);
    // Opus 4 and 4.1 cost more than the Opus models after them.
    expect(priceOf("claude-opus-4-1").output).toBe(75);
    expect(priceOf("claude-opus-4-20250514").output).toBe(75);
    expect(priceOf("someone-elses-model").output).toBe(75);
    // A prefix has to end at a dash, so a made-up name can't borrow a cheaper row.
    expect(priceOf("claude-haiku-40").output).toBe(75);
  });

  it("cost each kind of token at its own rate, in millionths of a dollar", () => {
    const tokens = { input: 1_000, output: 200, cacheRead: 3_000, cacheWrite: 1_000 };
    // Sonnet 5.5: $2 in, $10 out, $0.20 cache read, $2.50 cache write per million tokens.
    expect(costMicroUsd("claude-sonnet-5-5", tokens)).toBe(2_000 + 2_000 + 600 + 2_500);
    expect(costMicroUsd("claude-haiku-4-5", tokens)).toBe(1_000 + 1_000 + 300 + 1_250);
  });

  it("cost Haiku 5.5 by prompt size: every token at the long rates once the prompt is over 100,000", () => {
    // The prompt is input plus cache reads and writes: 100,000 here, the most at the short rates.
    const short = { input: 40_000, output: 2_000, cacheRead: 50_000, cacheWrite: 10_000 };
    // $0.10 in, $0.50 out, $0.01 cache read, $0.125 cache write per million tokens.
    expect(costMicroUsd("claude-haiku-5-5", short)).toBe(4_000 + 1_000 + 500 + 1_250);
    // One more cache read: $0.50 in, $2.50 out, $0.05 cache read, $0.625 cache write.
    const long = { ...short, cacheRead: 50_001 };
    expect(costMicroUsd("claude-haiku-5-5", long)).toBe(
      Math.round(20_000 + 5_000 + 50_001 * 0.05 + 6_250),
    );
    expect(costMicroUsd("claude-haiku-5-5-20261007", long)).toBe(
      costMicroUsd("claude-haiku-5-5", long),
    );
  });

  it("put the most a call can cost above anything its prompt and answer could really cost", () => {
    // Every prompt token at the dearer of input and cache write, every answer token at output.
    expect(worstCostMicroUsd("claude-haiku-5-5", 10_000, 520)).toBe(10_000 * 0.125 + 520 * 0.5);
    expect(worstCostMicroUsd("claude-sonnet-5-5", 10_000, 520)).toBe(10_000 * 2.5 + 520 * 10);
    // Haiku 5.5 past 100,000 prompt tokens is priced at its long rates.
    expect(worstCostMicroUsd("claude-haiku-5-5", 200_000, 0)).toBe(200_000 * 0.625);
    for (const tokens of [
      { input: 10_000, output: 520, cacheRead: 0, cacheWrite: 0 },
      { input: 0, output: 520, cacheRead: 0, cacheWrite: 10_000 },
      { input: 2_000, output: 100, cacheRead: 8_000, cacheWrite: 0 },
    ]) {
      expect(costMicroUsd("claude-haiku-5-5", tokens)).toBeLessThanOrEqual(
        worstCostMicroUsd("claude-haiku-5-5", 10_000, 520),
      );
    }
  });

  it("read token counts from a response's usage, with anything odd as zero", () => {
    expect(
      tokensOf({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 3,
      }),
    ).toEqual({ input: 10, output: 5, cacheRead: 7, cacheWrite: 3 });
    expect(tokensOf({ input_tokens: -4, output_tokens: "9" })).toEqual(NO_TOKENS);
    expect(tokensOf(undefined)).toEqual(NO_TOKENS);
  });
});

describe("the ledger", () => {
  it("sums today and the window by purpose and model, with chatter's notes and refusals", () => {
    let t = START - 40 * DAY;
    const ledger = new AiSpend(nodeSql(), () => t);
    const tokens = { input: 1_000, output: 100, cacheRead: 1_000, cacheWrite: 0 };
    const row = (purpose: "triage" | "chatter", outcome: string, model = "claude-sonnet-5-5") =>
      ledger.record({ purpose, trigger: "juniper", model, tokens, outcome });
    // Too old for the 30-day window.
    row("chatter", "posted");
    t = START - DAY;
    row("chatter", "posted");
    row("chatter", "filtered");
    t = START;
    row("chatter", "replied");
    row("chatter", "draft_post");
    row("triage", "dismiss", "claude-haiku-4-5");
    const each = costMicroUsd("claude-sonnet-5-5", tokens);
    const summary = ledger.summary();
    expect(summary.todayMicroUsd).toBe(2 * each + costMicroUsd("claude-haiku-4-5", tokens));
    expect(summary.windowMicroUsd).toBe(4 * each + costMicroUsd("claude-haiku-4-5", tokens));
    expect(summary.lines).toEqual([
      {
        purpose: "chatter",
        model: "claude-sonnet-5-5",
        calls: 4,
        microUsd: 4 * each,
        cacheReadShare: 0.5,
      },
      {
        purpose: "triage",
        model: "claude-haiku-4-5",
        calls: 1,
        microUsd: costMicroUsd("claude-haiku-4-5", tokens),
        cacheReadShare: 0.5,
      },
    ]);
    expect(summary.chatter).toEqual({
      calls: 4,
      notes: 2,
      drafts: 1,
      refused: 1,
      microUsd: 4 * each,
    });
  });
});

describe("triage in the ledger", () => {
  const VERDICT = {
    category: "none",
    severity: "low",
    confidence: 0.8,
    rationale: "An ordinary post.",
    action: "dismiss",
    injection_attempt: false,
  };

  /** Answers with the next item: a verdict, or an HTTP status. */
  function fakeAnthropic(script: (object | number)[]) {
    let n = 0;
    const fetcher = (async () => {
      const next = script[Math.min(n++, script.length - 1)];
      if (typeof next === "number") return new Response("nope", { status: next });
      return Response.json({
        model: "claude-haiku-5-5",
        content: [{ type: "tool_use", id: "t1", name: "record_verdict", input: next }],
        usage: { input_tokens: 900, output_tokens: 120 },
      });
    }) as unknown as typeof fetch;
    return { fetcher, calls: () => n };
  }

  it("gets a row per call that went out, none for a call the cap refused, and no text or ids", async () => {
    const sql = nodeSql();
    const api = fakeAnthropic([VERDICT, 500, VERDICT]);
    const client = new TriageClient(
      { ...DEFAULT_TRIAGE, apiKey: "test-key-not-real", callsPerDay: 3 },
      sql,
      api.fetcher,
      () => START,
    );
    const input = { kind: "post", text: "secret words", notes: ["r_abc123"], facts: [] };
    expect((await client.classify(input, "report")).ok).toBe(true);
    expect(await client.classify(input, "report")).toEqual({ ok: false, reason: "error" });
    // Calls a filter caused may use only part of the cap, and two of three are spent.
    expect(await client.classify(input, "filter")).toEqual({ ok: false, reason: "cap" });
    expect(api.calls()).toBe(2);
    const rows = [...sql.exec("SELECT * FROM ai_spend ORDER BY n")];
    expect(rows.map((r) => [r.purpose, r.trigger, r.model, r.outcome, r.cost_micro_usd])).toEqual([
      // Haiku 5.5 under 100,000 prompt tokens: $0.10 in, $0.50 out per million.
      ["triage", "report", "claude-haiku-5-5", "dismiss", 900 * 0.1 + 120 * 0.5],
      ["triage", "report", "claude-haiku-5-5", "error", 0],
    ]);
    const everything = JSON.stringify(rows);
    for (const secret of ["secret words", "r_abc123", "test-key-not-real"]) {
      expect(everything).not.toContain(secret);
    }
  });
});
