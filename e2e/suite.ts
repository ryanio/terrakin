/**
 * Which specs run where. Every push runs the 2D specs in CI's three shards and the one 3D smoke in
 * a job of its own; the deeper 3D specs run nightly (`.github/workflows/nightly.yml`). A spec is a
 * file's name without `.spec.ts`. `scripts/e2e-budget.test.ts` fails when a spec isn't in exactly
 * one place here, or when the per-push suite outgrows its budget (e2e/AGENTS.md).
 */

/** The per-push 3D smoke: the scene draws, a tap walks, a `view=3d` link, and the 2D fallback. */
export const SMOKE_3D = ["smoke-3d"] as const;

/** The 3D specs that run nightly, one after the other, with one worker. */
export const NIGHTLY = ["three-d", "world-3d"] as const;

/**
 * The 2D specs in CI's three shards, balanced by how long each shard takes alone (e2e/AGENTS.md has
 * the numbers). Playwright's own `--shard` splits by test count in file order, which left one shard
 * half again as slow as the others. Specs that share the main server slow each other down, so each
 * shard also mixes them with clock specs, which have servers of their own. A new spec goes in the
 * fastest shard.
 */
export const SHARDS = [
  ["make", "praise", "feed", "duo", "world-links", "galleries", "coins", "routines", "first-steps"],
  [
    "recipes",
    "gather",
    "town",
    "shop",
    "looks",
    "connect-x",
    "build",
    "fishing",
    "partners",
    "owner",
    "pets",
    "plot-photo",
  ],
  ["smoke", "docs", "games", "claim", "site", "safety", "sound", "market", "bounties"],
] as const;
