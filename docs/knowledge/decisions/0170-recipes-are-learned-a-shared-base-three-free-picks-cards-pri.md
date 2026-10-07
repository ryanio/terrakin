---
title: Recipes are learned: a shared base, three free picks, cards priced from what the town pays, teaching within reach, townsfolk specialties, recipe pages, behind open_recipes
date: 2026-10-07
status: accepted
tags: [sim, economy, numbers, protocol, server, client, agents, replay, items]
---

# Recipes are learned: a shared base, three free picks, cards priced from what the town pays, teaching within reach, townsfolk specialties, recipe pages, behind open_recipes

## Context

Every kitchen offers all 14 kitchen recipes on day one, and every workbench all 4 goods and 11 pieces of furniture. A newcomer gets a wall of rows, and nothing is left to discover, choose, or share. [RFC 0024](../../rfcs/0024-recipes-you-learn.md) is the full design; this record keeps its main choices.

## Decision

Recipes belong to the resident, and `knows(state, id, recipe)` in `packages/sim` is the one check `craft` makes.

- Everyone knows the base: `herb_tea` and `jam` (every fruit's jam) at the kitchen; `bouquet`, `chair`, `table`, `stone_wall`, and `fishing_rod` at the workbench. The fishing rod is in the base because fishing (RFC 0023) needs it.
- Everyone knows every holiday recipe, all year (today `candy`, `candy_cane`, `jack_o_lantern`). A recipe the catalog marks with a holiday is free the same way, so nobody pays to join a holiday.
- Each resident gets 3 free picks (`pick_recipe`) from any card on the shop's Recipes shelf that day, seasonal cards included.
- Everyone who lives here when `open_recipes` is logged knows everything, now and for recipes added later. Townsfolk know everything by rule.
- More come from a card at the shop (`shop_buy` with sku `recipe:<name>`), a neighbor's lesson, a townsfolk's lesson, or a recipe page found on the ground.
- Card prices come from `recipeCardPrice`, not a table: 5 times the town's price for a good the town buys on its rotation, 8 times for a good it buys every day of a season, and otherwise 10 coins plus 3 per ingredient, rounded to the nearest 5. The economy run may change those three numbers, not single cards.
- `teach` needs both residents online and within `config.reach` of each other, so a lesson happens in the world. Each resident teaches 1 and is taught 1 per UTC day.
- Each townsfolk has a few specialties in the townsfolk seed, and the townsfolk run teaches one to a resident standing near them, at most once a week per resident, as an ordinary `teach` the sim checks (decision 0114).
- About 1 find in 20 is a recipe page for one non-base, non-holiday recipe, chosen from the day and the tile. Gathering it teaches it; a page you already know stays on the ground for someone else.
- Nothing changes until the server logs `open_recipes`, so every older log replays to the same hash.

## Consequences

- Cards are a coin sink with no source: the shop's split applies (5% to the treasury, the rest burned, decision 0052). Recipes can't be given, sold, or listed, so nothing can be duplicated.
- Teaching costs the shop some sales on purpose; the daily cap and the need to stand together keep it a favor between neighbors.
- Early income from made goods drops for newcomers, which helps the supply per active resident that decision 0052 tuned. The economy run with picks, cards, and teaching checks the numbers before the switch, and a test pins every card for a good in `BUY_ORDERS` to pay back in 5 to 30 days of selling.
- A new recipe is a card by default unless it's in the base or has a holiday. Adding a base recipe later is a rule change that needs its own logged input.
