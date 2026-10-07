---
title: Refine pass: check-in table, links and server splits, sim helpers, steadier e2e, faster CI, UI copies, render split
date: 2026-10-07
tags: [refactor, server, sim, client, e2e, ci]
---

# Refine pass: check-in table, links and server splits, sim helpers, steadier e2e, faster CI, UI copies, render split

## Done

No new features. Same behavior, fewer copies, smaller files. Every workstream landed on main after `pnpm verify` (and `pnpm e2e` for client work), with the `reviewer` agent on the ones touching the sim, auth, or link keys.

- A first-visit step added after someone joined comes back a week after it was last suggested; other suggestions still wait 30 days (`f1a3da59`, decision 0129 updated, changelog entry).
- Check-in: `checkin.ts` split into `checkin-steps.ts`, `checkin-suggest.ts`, and `checkin-todo.ts`. The todo lines are one ordered table, the suggestion one rule over one list (`pickSuggestion`), and one test holds the whole todo order. Pumpkin and cranberry kinds come from the catalog (`649465c2`).
- Link routes: `links.ts` became `packages/server/src/links/`, a file per feature with shared helpers (`answer`, `reply`, `act`, `fromOutcome`, `refuse`, `paidSteps`). `walkLinks` uses the sim's new `walkLegs`. The "Next" list now uses the same plot-named rule as the first visit (`202cc386`, `6b2ed144`, changelog entry).
- Sim: one `Window` shape for seasonal stock, holiday stock, and season buys (first matching season still wins); `oneTimeSwitch` for 8 of 11 logged switches, with `tick()` turning them on from one table; one `outOfReach` for tile-reach refusals. No fixture hash or `REPLAY_VERSION` changed (`c4d82c60`, `e715b9da`, `3956275f`).
- Server: `api.ts` 1966 to 1225 lines (`live.ts`, `api-response.ts`, `api-wiring.ts`, `townsfolk-status.ts`); `world-service.ts` 2657 to 1746 (`world-actions.ts`, `world-credentials.ts`, `world-wire.ts`) (`186b4e5e`, `861f45fb`, `6c5226cc`).
- Tests and CI: the Node server keeps idle connections 65 seconds, which fixed smoke's ECONNRESET (decision 0130); town.spec is four serial tests; the newest-40 notice test runs in-process; the brand typesetter outlines each text once; the away card has its own module; CI runs `pnpm test` beside verify and e2e in five jobs (`468a1d10` to `f0246036`).
- Client: `shortDate`, `formatCount`, `pluralWord`, `whileBusyAll`, and one `.hint` class in `packages/ui`, with guard patterns in `shared-components.test.ts`; style.css has no lint warnings (`decbc4fb`, `2a22bd3a`, `3178a66d`). `render.ts` 2982 to 983 lines with drawing in `packages/client/src/render/`, and `scene3d/plot.ts` 1809 to 194 with a file per builder (`bdae0187`, `d83edecf`).
- Docs: stale paths fixed in decisions 0021, 0025, 0029 and RFC 0005, and seven exports only their own file used made private (`e011472b`). Decision records' Code lines follow the moved code.

Numbers: vitest about 30s to 12s on a loaded laptop (most of it load; the persona art test 16.7s to 2.7s), e2e about 99s to 85-94s, first-load script 139.1 kB to 137.9 kB, CI 3m31s to 3m06s-3m26s on the first three runs after the split (the slowest 2D e2e shard, 124 to 162 seconds, sets the pace).

## State of things

- `pnpm verify` green on main at `d83edecf` (2767 tests), `pnpm e2e` 50 of 50.
- The feed reactions flake was never reproduced (16 targeted runs and 4 full runs, up to load 32), so its spec is unchanged. Likely a 30-second budget under several parallel suites; unproven.
- Left on purpose: `render()` is still one 875-line function and `scene3d/world.ts` one closure (splitting either is a rewrite, not a move); the four duration-in-words helpers differ in rounding and wording, so they stay separate; `open_economy`, `open_shop`, and `solid_buildings` stay hand-written because their extra work belongs in the check.
- While stress-testing, one agent ran `pkill -f "vitest run"`, which matches any vitest on the machine and may have stopped another session's run.
- The main checkout has another session's uncommitted `.streak-line` edit in `packages/client/src/style.css`; nothing here touched it.

## Next

1. If feed reactions fails again, record the load average and the failing step before changing anything.
2. Balance the three 2D e2e shards (`.github/workflows/ci.yml`): shard 1 runs about 40 seconds longer than the others and sets CI's wall time.
3. Social refusals on link routes drop `retryAfter` on `rate_limited` where the JSON handlers' `fromResult` adds it (`packages/server/src/links/shared.ts`); add it if link-only agents need it.

## Open questions

None. Since this note: suggestions come back on day 30 (`129c6f5f`), and knip runs in the gate (decision 0131).
