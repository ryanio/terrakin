---
title: Every Node world opens the systems terrakin.org runs: recipes, holiday prices, levels, jobs, circles, and both editions
date: 2026-10-23
status: accepted
tags: [server, deploy, e2e]
---

# Every Node world opens the systems terrakin.org runs: recipes, holiday prices, levels, jobs, circles, and both editions

## Context

Each of these systems shipped behind a `WorldService` option that the Worker set and the Node server left off, so a self-hosted world wouldn't change under its owner ([decision 0249](0249-levels-are-on-at-terrakin-org-the-worker-sets-levels-the-nod.md) for levels, [0262](0262-jobs-are-on-at-terrakin-org-the-worker-sets-jobs-the-node-se.md) for jobs, [0285](0285-kindreds-are-on-at-terrakin-org-the-worker-sets-kindreds-the.md) for circles, [0265](0265-the-jobs-board-s-second-edition-a-lane-s-regular-jobs-carry-.md) for the jobs edition, [0310](0310-recipe-pages-come-in-editions-and-edition-2-puts-every-card-.md) for the page edition, [0210](0210-halloween-s-costumes-and-decor-cost-half-from-a-logged-lower.md) for holiday prices, and recipes, which phase 4 of RFC 0024 turned on the same way). The Node server is also what `pnpm dev`, `pnpm dev:test`, and every e2e server run. So by October 23 the game that was tested locally was not the game played at terrakin.org: no recipe picks, no points, no jobs board, no circles. Every spec and persona that needed one opened it by hand through a test route. Terrakin is pre-alpha with no known self-hosted world.

## Decision

The Node server passes the same options as the Worker for these systems: `recipes`, `holidayPrices`, `levels`, `jobs` with `jobEdition: 2`, `pageEdition: 3`, and `circles`. Pottery (`clay`), new lands (`lands`), and the one-time repeat-join cleanup stay the Worker's alone. The plot market stays off everywhere.

## Consequences

- A Node world logs each switch on its first ticks, in the order of `DAY_SWITCHES`, as terrakin.org did. A world kept on disk (`.dev-test-world/`, a self-hosted log) logs them on its next start and replays as it was, since a switch is an input like any other. The sim's off branches stay, because terrakin.org's log replays through them.
- `POST /v1/test/open-recipes`, `open-levels`, `open-jobs`, and `open-circles` are gone, with `pnpm persona`'s `--open-recipes`, `--open-levels`, `--open-jobs`, and `--open-circles`, the e2e helpers behind them, and `SWITCH_SPECS` in `e2e/ports.ts`: no spec switches a system on for its whole world any more, so `recipes.spec.ts` runs on the main server. The routes for the next land, plots for sale, and pottery stay, and `town.test.ts` proves the test routes' guards through the pottery one. `WorldService.testOpenLevels`, `testOpenJobs`, and `testOpenCircles` stay for server tests that open a system at a chosen moment.
- e2e journeys now start where a newcomer at terrakin.org starts. A first kitchen or workbench opens "Pick 3 recipes to start", so `make.spec.ts` and `town.spec.ts` spend their resident's picks over the API, as `recipes.spec.ts` does for Linden. What e2e can no longer show is a world before a switch (a resident from before recipes, pages that ask nothing before jobs open); that stays with the server tests, which build a `WorldService` without the option.
- A self-hosted owner who wants one of these off removes its option from `packages/server/src/main.ts`.
- The tests that read the adapters pin it: `levels.test.ts`, `jobs.test.ts`, and `circles.test.ts` check each option is passed once by each adapter.
- Code: `packages/server/src/main.ts`, `packages/server/src/app.ts`, `e2e/ports.ts`, `playwright.config.ts`, `e2e/personas.ts`, `scripts/persona.ts`.
