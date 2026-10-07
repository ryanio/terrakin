/**
 * The e2e suite's gate and budget (e2e/AGENTS.md, decision 0200), checked so they hold without
 * anyone remembering them: every spec has a row in e2e/AGENTS.md saying where it runs and what
 * journey it covers, every spec runs in exactly one place (e2e/suite.ts), the suite every push
 * runs stays under its budget of files and tests, and no spec adds a fixed wait.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NIGHTLY, SHARDS, SMOKE_3D } from "../e2e/suite.ts";

/**
 * The most spec files and tests every push may run. Going over means moving checks down a layer
 * or cutting a test first, not raising these (e2e/AGENTS.md, "Before you add a test").
 */
const MAX_PUSH_FILES = 32;
const MAX_PUSH_TESTS = 58;

const GATE = "Over the e2e budget: move checks down a layer or cut a test first (e2e/AGENTS.md).";

const E2E = join(import.meta.dirname, "../e2e");
const specs = readdirSync(E2E)
  .filter((name) => name.endsWith(".spec.ts"))
  .map((name) => name.replace(/\.spec\.ts$/, ""))
  .sort();

/** Where e2e/suite.ts runs each spec, in the words of the AGENTS.md table. */
const placed: [string, string][] = [
  ...SHARDS.flatMap((shard, i) => shard.map((spec): [string, string] => [spec, `shard ${i + 1}`])),
  ...SMOKE_3D.map((spec): [string, string] => [spec, "3D smoke"]),
  ...NIGHTLY.map((spec): [string, string] => [spec, "nightly"]),
];

/** The spec table's rows: spec, where it runs, and what it covers. */
const rows = new Map(
  readFileSync(join(E2E, "AGENTS.md"), "utf8")
    .split("\n")
    .flatMap((line) => {
      const m = /^\| `([\w-]+)\.spec\.ts` \| ([^|]+) \| (.*) \|$/.exec(line);
      return m?.[1] && m[2] && m[3] ? [[m[1], { runs: m[2].trim(), covers: m[3].trim() }]] : [];
    }),
);

/** How many tests a spec declares: each `test(` call, inside a describe or not. */
const testsIn = (spec: string) =>
  readFileSync(join(E2E, `${spec}.spec.ts`), "utf8").match(/^\s*test\(\s*["'`]/gm)?.length ?? 0;

describe("the e2e suite", () => {
  it("finds the specs", () => {
    expect(specs).toContain("smoke");
  });

  it("runs every spec in exactly one place: a 2D shard, the 3D smoke, or nightly", () => {
    expect(placed.map(([spec]) => spec).sort()).toEqual(specs);
  });

  it("has a row in e2e/AGENTS.md for every spec, saying where it runs and what it covers", () => {
    expect([...rows.keys()].sort()).toEqual(specs);
    for (const [spec, where] of placed) {
      expect(rows.get(spec)?.runs, `${spec}.spec.ts`).toBe(where);
      expect(rows.get(spec)?.covers.length, `${spec}.spec.ts`).toBeGreaterThan(20);
    }
  });

  it("keeps what every push runs under its budget", () => {
    const push = placed.filter(([, where]) => where !== "nightly").map(([spec]) => spec);
    const tests = push.reduce((n, spec) => n + testsIn(spec), 0);
    expect(push.length, GATE).toBeLessThanOrEqual(MAX_PUSH_FILES);
    expect(tests, GATE).toBeLessThanOrEqual(MAX_PUSH_TESTS);
  });

  it("waits on what the page shows, never a fixed time, except where a spec already does", () => {
    // gather.spec.ts gives a refused tap time to have walked, which it must not have.
    const known: Record<string, number> = { gather: 1 };
    for (const spec of specs) {
      const waits =
        readFileSync(join(E2E, `${spec}.spec.ts`), "utf8").match(/\bwaitForTimeout\(/g)?.length ??
        0;
      expect(waits, `${spec}.spec.ts waits a fixed time; wait for what the page shows`).toBe(
        known[spec] ?? 0,
      );
    }
  });

  it("counts tests the way Playwright lists them", () => {
    expect(testsIn("shop")).toBe(2);
    expect(testsIn("smoke-3d")).toBe(2);
  });
});
