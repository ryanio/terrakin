---
title: E2e keeps only journeys a lower test can't prove, with a budget, one 3D smoke a push, and the rest nightly
date: 2026-10-07
status: accepted
tags: [e2e, ci, tests, tooling]
---

# E2e keeps only journeys a lower test can't prove, with a budget, one 3D smoke a push, and the rest nightly

## Context

By October 2026 the Playwright suite had 32 specs and 60 tests. A full local run took 2:41, and on CI it ran as five jobs (three 2D shards and two 3D jobs) that `deploy` waited on, about 4 of the 6 minutes from a push to terrakin.org. Of the newest 20 red runs on `main`, 16 had a red e2e job, and 15 of those were the tests' own timing: software WebGL too slow for the 3D plot at midnight (10 runs), a 5-second wait the docs page outgrew (3), and a busy runner past the 30-second timeout (2). One was a real bug, a new chip covering tiles the smoke spec taps. Specs had also grown checks that belong lower down: which stock each season sells, shelves and tags, copy.

E2e still catches what nothing else does, like that chip. The aim was to keep that and drop the rest of the cost.

## Decision

- A check lives at the lowest layer that catches its failure. E2e holds journeys a person takes end to end that no unit, server, or client test can prove. A check leaves e2e only when a stronger owner covers the same failure, shown to fail when the behavior breaks.
- The per-push suite has a budget (e2e/AGENTS.md): 32 spec files and 58 tests, about 75 seconds locally, and 90 seconds of test time per CI shard. Going over means moving checks down or cutting first. `scripts/e2e-budget.test.ts` enforces the counts, a table row for every spec, and no new fixed waits.
- Every push runs one 3D smoke (`e2e/smoke-3d.spec.ts`): a `view=3d` link draws the scene, a tap on the 3D ground walks, and the toggle falls back to the map when WebGL won't start. The plot view, photos, night light, camera and d-pad checks run nightly (`.github/workflows/nightly.yml`), beside the whole 2D suite.
- CI's 2D shards are named lists in `e2e/suite.ts`, balanced by measured time, instead of Playwright's `--shard`, which splits by test count in file order. A shard starts only the clock servers its specs use.
- CI skips the e2e jobs when every file changed since the last green run on `main` is in `packages/sim/`, `scripts/`, `docs/` (not `docs/site/` or `docs/devlog/`), or a `.md` file (`scripts/e2e-needed.ts`). It compares with the last green run rather than the push before, so a run cancelled by a newer push, or a `[skip ci]` commit, can't carry an untested client change to production. `deploy` runs when e2e passed, or was skipped because `changes` said so, and never from a cancelled run.
- Every red e2e run on `main` or the nightly gets a line in `e2e/red-runs.md`: real bug, flake, or test out of date.

What moved in the first pass: the shop's autumn, winter, and Midwinter tests and the Halloween costume buy left e2e. Which stock each season and holiday sells was already proved by `packages/server/src/shop.test.ts` ("lists each season's stock and buying"), `packages/server/src/halloween.test.ts`, and `packages/sim/src/winter.test.ts` and `halloween.test.ts`; the tags and shelves moved into pure functions (`stockTag`, `shelvesOf` in `packages/client/src/shop-view.ts`) tested in `packages/client/src/shop.test.ts`, each shown to fail when its behavior breaks. The docs page's desktop run no longer repeats the phone run's operation and deep link, which use the same code at both sizes. The no-character `view=3d` step moved from `world-3d.spec.ts` to the smoke.

## Consequences

- The per-push suite went from 60 tests and 2:41 locally to 54 tests and about 1:03. CI runs four e2e jobs instead of five, the 3D one a few seconds of tests instead of two jobs near a minute each.
- A sim-only push deploys without e2e. If it broke something a spec sees, the nightly 2D run says so within a day, and the next push that runs e2e fails on it.
- Shards don't rebalance themselves: a new spec is placed by hand, and the budget test fails until it is.
- The `changes` job reads the run list, so it needs `actions: read`. When it can't decide, e2e runs.
- The `playwright install --with-deps` step's apt install still varies from 13 to 130 seconds a job; that's the next thing to look at for the slowest job.
