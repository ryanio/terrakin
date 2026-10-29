/**
 * The Playwright specs share their helpers through `e2e/support.ts`. This fails when a spec
 * defines its own copy of one again, which is how the copies drifted apart before.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const E2E = join(import.meta.dirname, "../../../e2e");
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
const TAPS_IN_3D = ["smoke-3d.spec.ts", "world-3d.spec.ts"];
const COPY = new RegExp(`^(?:async )?function (${SHARED.join("|")})\\(`);

describe("e2e specs use e2e/support.ts", () => {
  const specs = readdirSync(E2E).filter((name) => name.endsWith(".spec.ts"));

  it("no spec defines its own copy of a shared helper", () => {
    expect(specs).toContain("smoke.spec.ts");
    const hits = specs.flatMap((name) =>
      readFileSync(join(E2E, name), "utf8")
        .split("\n")
        .flatMap((line, i) => (COPY.test(line) ? [`e2e/${name}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  /** Each line of every spec that matches `pattern`, as `e2e/<spec>:<line>: <text>`. */
  const linesMatching = (pattern: RegExp, skip: string[] = []) =>
    specs
      .filter((name) => !skip.includes(name))
      .flatMap((name) =>
        readFileSync(join(E2E, name), "utf8")
          .split("\n")
          .flatMap((line, i) =>
            pattern.test(line) ? [`e2e/${name}:${i + 1}: ${line.trim()}`] : [],
          ),
      );

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

  it("every shared helper is still exported", () => {
    const support = readFileSync(join(E2E, "support.ts"), "utf8");
    for (const name of SHARED)
      expect(support).toMatch(new RegExp(`export (async )?function ${name}\\(`));
  });
});
