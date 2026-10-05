/**
 * The Playwright specs share their helpers through `e2e/support.ts`. This fails when a spec
 * defines its own copy of one again, which is how the copies drifted apart before.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const E2E = join(import.meta.dirname, "../../e2e");
const SHARED = [
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
];
const COPY = new RegExp(`^(?:async )?function (${SHARED.join("|")})\\(`);

describe("e2e specs use e2e/support.ts", () => {
  const specs = readdirSync(E2E).filter((name) => name.endsWith(".spec.ts"));

  it("finds the specs", () => {
    expect(specs).toContain("smoke.spec.ts");
  });

  it("no spec defines its own copy of a shared helper", () => {
    const hits = specs.flatMap((name) =>
      readFileSync(join(E2E, name), "utf8")
        .split("\n")
        .flatMap((line, i) => (COPY.test(line) ? [`e2e/${name}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it("every shared helper is still exported", () => {
    const support = readFileSync(join(E2E, "support.ts"), "utf8");
    for (const name of SHARED)
      expect(support).toMatch(new RegExp(`export (async )?function ${name}\\(`));
  });
});
