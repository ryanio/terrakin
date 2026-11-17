/**
 * The e2e suite's gate and budget (e2e/AGENTS.md, decision 0200), checked so they hold without
 * anyone remembering them: every spec has a row in e2e/AGENTS.md saying where it runs and what
 * journey it covers, every spec runs in exactly one place (e2e/suite.ts), the suite every push
 * runs stays under its budget of files and tests, no spec adds a fixed wait, and specs share their
 * helpers through e2e/support.ts instead of defining their own copies.
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

/**
 * How many tests a source declares: each `test("title", ...)` inside a describe or not, including
 * `test.only`, `test.fixme`, `test.skip`, and `test.fail` with a title, which Playwright lists too.
 * A bare `test.skip()` inside a test skips that test and declares none.
 */
const countTests = (source: string) =>
  source.match(/^\s*test(?:\.(?:only|fixme|skip|fail))?\(\s*["'`]/gm)?.length ?? 0;

const testsIn = (spec: string) => countTests(readFileSync(join(E2E, `${spec}.spec.ts`), "utf8"));

/** Helpers every spec takes from e2e/support.ts. */
const SHARED = [
  "persona",
  "join",
  "act",
  "read",
  "signIn",
  "freePlots",
  "settler",
  "advanceDay",
  "watchErrors",
  "overflowsSideways",
  "tinyPng",
  "tapTile",
  "tapsTheMap",
  "signedInAs",
  "savedSignIn",
];
/** Specs that tap the 3D view by hand, where `tapTile`'s map math doesn't reach. */
const TAPS_IN_3D = ["smoke-3d", "world-3d"];

/** Each line of every spec that matches `pattern`, as `e2e/<spec>.spec.ts:<line>: <text>`. */
const linesMatching = (pattern: RegExp, skip: string[] = []) =>
  specs
    .filter((spec) => !skip.includes(spec))
    .flatMap((spec) =>
      readFileSync(join(E2E, `${spec}.spec.ts`), "utf8")
        .split("\n")
        .flatMap((line, i) =>
          pattern.test(line) ? [`e2e/${spec}.spec.ts:${i + 1}: ${line.trim()}`] : [],
        ),
    );

describe("the e2e suite", () => {
  it("runs every spec in exactly one place: a 2D shard, the 3D smoke, or nightly", () => {
    expect(specs).toContain("smoke");
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

  it("waits on what the page shows, never a fixed time", () => {
    for (const spec of specs) {
      const waits =
        readFileSync(join(E2E, `${spec}.spec.ts`), "utf8").match(/\bwaitForTimeout\(/g)?.length ??
        0;
      expect(waits, `${spec}.spec.ts waits a fixed time; wait for what the page shows`).toBe(0);
    }
  });

  it("has no spec define its own copy of a shared helper", () => {
    const copy = new RegExp(`^(?:async )?function (${SHARED.join("|")})\\(`);
    expect(linesMatching(copy)).toEqual([]);
  });

  it("reads who is signed in through signedInAs or savedSignIn, never local storage", () => {
    // A join or a passkey sign-in lands after the HUD shows, so a read the moment the page looks
    // ready can still find nothing; `signedInAs` waits for it.
    expect(linesMatching(/localStorage\.getItem\(/)).toEqual([]);
  });

  it("taps the map through tapTile, which waits for the world's buttons to settle", () => {
    // Gather all and the next-step chip take their places after the loader goes, so a tap
    // placed by hand can land on a button that wasn't there a moment before.
    expect(linesMatching(/\.mouse\.(click|down)\(/, TAPS_IN_3D)).toEqual([]);
    const support = readFileSync(join(E2E, "support.ts"), "utf8");
    for (const name of ["tapTile", "tapsTheMap"]) {
      const body = support.slice(support.indexOf(`export async function ${name}(`));
      expect(body.slice(0, body.indexOf("\n}\n")), name).toContain("await worldSettled(page);");
    }
  });

  it("counts tests the way Playwright lists them", () => {
    expect(testsIn("shop")).toBe(2);
    expect(testsIn("smoke-3d")).toBe(2);
    const source = [
      'test("one", async () => {',
      "  test.skip();",
      "});",
      'test.only("two", async () => {});',
      "test.fixme('three', async () => {});",
      'test.describe("a group", () => {',
      '  test.skip("four", async () => {});',
      "  test.fail(`five`, async () => {});",
      '  test.step("not a test", async () => {});',
      "});",
    ].join("\n");
    expect(countTests(source)).toBe(5);
  });
});
