---
title: Recipe pages come in editions, and edition 2 puts every card on the ground
date: 2026-10-18
status: accepted
tags: [sim, protocol, server, client, recipes, replay]
---

The Node server's half is superseded by [decision 0373](0373-every-node-world-opens-the-systems-terrakin-org-runs-recipes.md): every Node world passes the Worker's `pageEdition` too.

# Recipe pages come in editions, and edition 2 puts every card on the ground

## Context

A recipe page is a find that teaches instead of filling your things ([RFC 0024](../../rfcs/0024-recipes-you-learn.md)). Which tiles hold one, and which recipe each teaches, come from a pure roll: `pageRoll(x, y, day) % (pageOneIn * list.length)`, a page when the result lands inside the list, and then that place in the list. Both halves read the list, so its length and its order are replay: a logged `gather` of a page only replays the same while the list is byte for byte what it was.

That is why `PAGE_RECIPES` was frozen, and why [decision 0308](0308-a-basket-of-fourteen-crops-sold-all-year-with-ten-recipes-an.md)'s ten new cards could not join it. Pages taught 16 of 26 cards, and the share would shrink with every batch of recipes. Foraging is one of the three ways to learn a recipe for nothing, so letting it fall behind the shelf quietly empties it.

## Decision

The page list comes in numbered editions, the way the jobs board's table does ([decision 0265](0265-the-jobs-board-s-second-edition-a-lane-s-regular-jobs-carry-.md)).

`PAGE_EDITIONS` holds them: edition 1 is `PAGE_RECIPES` exactly as it shipped, and edition 2 is edition 1 followed by the ten cards decision 0308 brought, in catalog order. `state.recipes.pages` says which a world reads, absent being 1, so a world that never switches rolls the pages it always rolled. `pageOn(x, y, day, edition)` takes the edition, and `pageEditionOf(state)` reads it.

The server-only `set_page_edition {edition}` from `TOWN_ACTOR` moves a world forward, refusing an edition that doesn't exist (`server_only`), the one in use (`already_set`), and any step backwards (`server_only`). `WorldService` logs it from its `pageEdition` option right after a `new_day`, never mid-day, since it changes which tiles hold a page and people may be looking at today's ground. The Worker passes 2; the Node server passes nothing, so self-hosted worlds, `pnpm dev`, and e2e keep edition 1.

Clients draw pages themselves, so the edition is on the wire: `pageEdition` on the world snapshot, absent for 1, which the mirror reads and hands to the sim's `pickupOn`. The `page_edition_set` event stays on the server, like `job_edition_set`: the snapshot is what a client draws from, and a client that was connected across the switch draws the old ground until its next snapshot, which is cosmetic, because `gather` is the server's to decide.

`src/fixtures/page-edition-log.ts` replays the switch and a gather of a page at (14, 7) that edition 1 has no page on at all, pinned by its hash, so a change to edition 2's list or order fails loudly.

## Consequences

- Every recipe card can now be found on the ground in a world on edition 2, and a future batch of cards is edition 3 rather than a frozen list nobody can add to.
- Which tiles hold a page changes on the day of the switch, because the modulus changes with the list's length. The share of finds that are pages does not: it stays about 1 in `RECIPES_RULES.pageOneIn`, since the roll scales with the list.
- An edition a live world has read is frozen, exactly as `PAGE_RECIPES` was. Edition 2 is frozen from the moment terrakin.org switches.
- The cost of adding cards is now in one place. A batch of recipes adds a catalog entry each, a line in the newest edition, and nothing else; before, pages needed a new frozen list and a new switch each time.
- Code: `PAGE_EDITIONS`, `pageEditionOf`, `pagesIn` and `checkSetPageEdition` in `packages/sim/src/recipes.ts`, the edition threaded through `packages/sim/src/gather.ts`, `pages` on `RecipesState`, `pageEdition` on the snapshot schema and `packages/client/src/mirror.ts`, and the `pageEdition` option in `packages/server/src/world-service.ts`.
