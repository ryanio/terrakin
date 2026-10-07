import { describe, expect, it } from "vitest";
import { baseOf, needsE2e } from "./e2e-needed";

describe("needsE2e", () => {
  it("skips a change e2e can't see: the sim, scripts, docs, and Markdown", () => {
    expect(needsE2e(["packages/sim/src/shop.ts", "packages/sim/src/shop.test.ts"])).toBe(false);
    expect(needsE2e(["scripts/kb.ts", "docs/knowledge/INDEX.md", "docs/rfcs/0024-x.md"])).toBe(
      false,
    );
    expect(needsE2e(["AGENTS.md", "e2e/AGENTS.md", "packages/client/AGENTS.md"])).toBe(false);
    expect(needsE2e([])).toBe(false);
  });

  it("runs for anything the browser loads or the e2e servers run", () => {
    for (const path of [
      "packages/client/src/world.ts",
      "packages/client/src/style.css",
      "packages/ui/src/base.css",
      "packages/server/src/api.ts",
      "packages/protocol/src/routes.ts",
      "packages/cards/src/card.ts",
      "packages/admin/src/main.ts",
    ])
      expect(needsE2e([path]), path).toBe(true);
  });

  it("runs for the specs, their config, the dependencies, and the workflows", () => {
    for (const path of [
      "e2e/shop.spec.ts",
      "e2e/support.ts",
      "playwright.config.ts",
      "package.json",
      "pnpm-lock.yaml",
      ".github/workflows/ci.yml",
      ".nvmrc",
    ])
      expect(needsE2e([path]), path).toBe(true);
  });

  it("runs for the site pages and devlog posts the client is built from, though they're docs", () => {
    expect(needsE2e(["docs/site/about.md"])).toBe(true);
    expect(needsE2e(["docs/devlog/2026-10-07-recipes.md"])).toBe(true);
  });

  it("runs when one file of many needs it", () => {
    expect(needsE2e(["packages/sim/src/shop.ts", "docs/plans/README.md", "e2e/shop.spec.ts"])).toBe(
      true,
    );
  });
});

describe("baseOf", () => {
  it("compares with the newest green run this commit contains", () => {
    const contained = new Set(["c", "a"]);
    expect(baseOf(["d", "c", "b", "a"], (sha) => contained.has(sha))).toBe("c");
  });

  it("gives nothing to compare with when no green run is in this commit's history", () => {
    expect(baseOf(["d", "e"], () => false)).toBeNull();
    expect(baseOf([], () => true)).toBeNull();
  });
});
