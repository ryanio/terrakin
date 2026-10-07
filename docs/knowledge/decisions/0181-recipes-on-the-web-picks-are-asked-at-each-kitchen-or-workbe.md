---
title: Recipes on the web: picks are asked at each kitchen or workbench while they last, and e2e opens recipes on a borrowed server
date: 2026-10-07
status: accepted
tags: [client, e2e, testing, items]
---

# Recipes on the web: picks are asked at each kitchen or workbench while they last, and e2e opens recipes on a borrowed server

## Context

Phase 2 of [RFC 0024](../../rfcs/0024-recipes-you-learn.md) builds the web: the picks sheet, a station sheet that lists only what you know, and the shop's Recipes shelf. The RFC says the web asks "the first time you open a kitchen or workbench" and leaves out what happens when someone closes the sheet, how it and the station's sheet share the one overlay, and what the shelf's button says when you have picks and coins both.

E2e needed recipes open in a test world with a resident from before the switch. `open_recipes` is one-time and changes the world for everyone, so it can't run on the main e2e server, where `make.spec.ts` and `fishing.spec.ts` open kitchens and workbenches as newcomers. A server of its own would be an eleventh port, and parallel suites from other worktrees are spaced ten apart.

## Decision

- A kitchen or workbench asks "Pick 3 recipes to start" every time it's opened while `inventory.recipePicks` is above 0, not only the first time. Closing the picks sheet (its close button, a pull down, Back) puts it off until the next tap. Not now, or the last pick, opens the station's own sheet in its place, read afresh.
- The station's sheet opens at once, as before, and the picks sheet replaces it once the inventory and the shelf say there are picks and cards; the overlay holds one sheet, so they swap rather than stack.
- A pick from the sheet goes over REST and the sheet counts down itself; the toast comes from the private `recipe_learned` on the world's socket, so a pick is said once.
- On the shop's shelf a card you don't know says "Free pick" while you have picks, even if you could buy it: a pick is free and buys nothing a pick can't.
- The Recipes shelf comes before decor, and `/shop#recipes` lands on it once.
- The server's test clock gains `POST /v1/test/open-recipes` (loopback only, never in the Worker), and specs that flip a world-wide switch run on the server of a clock spec that never meets it (`SWITCH_SPECS` in `e2e/ports.ts`: `recipes` on `bounties`).

## Consequences

- A newcomer who closes the sheet sees it again at the next kitchen until all three are picked. If that grows annoying, a per-device "not now" is a client change.
- The bounties spec's world has recipes open partway through its run. A later change that has `bounties.spec.ts` make something or read the shop must move one of the two.
- `pnpm persona <stage> --open-recipes` opens recipes in a `pnpm dev:test` world for checking by hand, once per world.
- Code: `packages/client/src/recipe-picks.ts`, `garden-sheet.ts`, `shop-view.ts`, `things.ts` (`knownAt`, `moreToLearn`, `learnedLine`), `packages/server/src/app.ts` (`TEST_OPEN_RECIPES_PATH`), `e2e/recipes.spec.ts`.
