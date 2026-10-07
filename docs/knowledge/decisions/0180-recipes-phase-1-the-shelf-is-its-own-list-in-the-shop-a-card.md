---
title: Recipes phase 1: the shelf is its own list in the shop, a card's season is its good's, and the switch waits for the shop
date: 2026-10-07
status: accepted
tags: [sim, protocol, server, economy, replay, items]
---

# Recipes phase 1: the shelf is its own list in the shop, a card's season is its good's, and the switch waits for the shop

## Context

[RFC 0024](../../rfcs/0024-recipes-you-learn.md) and [decision 0170](0170-recipes-are-learned-a-shared-base-three-free-picks-cards-pri.md) set the rules for recipes you learn. Building phase 1 (the sim and the API, with the switch off) needed a few shapes the RFC left open or only showed by example.

## Decision

- The Recipes shelf is its own list in `GET /v1/shop`, `shop.recipes`, present only once recipes are open. Each card still carries `section: "recipes"`, as the RFC's example does. Cards stay out of `shop.items`, so a client that draws `items` by sku (as the web does today) never meets a sku it can't draw.
- A card's `recipe.needs` is a list of `{kind, count}`, the shape the catalog and the inventory's recipes already use, where the RFC's example showed an object.
- A card is on the shelf in a season when the town buys what it makes every day of that season (`buySeason`): pumpkin pie and soup in autumn, hot cranberry punch in winter. Every other card is there all year. This gives the RFC's table and needs no list of its own.
- The catalog marks a holiday's kind with `holiday` on its entry when the shop doesn't sell it for one (the jack-o'-lantern). `kindHoliday` reads that mark, else `shop.holiday`, so candy and candy canes need nothing new.
- `open_recipes` uses `oneTimeSwitch` and needs the shop open, since cards are bought there and picks come off its shelf. `everything` is every resident in the world when it's logged, townsfolk and offline residents included, sorted.
- Residents who know everything (townsfolk, and everyone in `everything`) have 0 picks, so the web never asks them to pick.
- `recipe_unknown` names only the ways to learn that work that day: a free pick while one is left and the card is on the shelf, and the card with its price and sku (or when a seasonal card is back). Teaching and recipe pages join the message when phase 3 builds them.
- Before `open_recipes`, `pick_recipe` is refused as `already_known` (everyone knows everything), and a `recipe:` sku is an unknown sku (`unknown_item`), as it was.
- A card's checks run in this order: the shop's own (open, joined, not townsfolk), a card by that name, no `count` but 1, known (`already_known`), on the shelf (`out_of_season`), then coins (`not_enough_coins`).
- `recipe_learned` is private to its resident, like `wear_bought`.
- The server's `recipes` option logs `open_recipes` from `DAY_SWITCHES` once the shop is open. No adapter sets it, so it stays off on terrakin.org until phase 4.

## Consequences

- Old logs replay to the hashes they had: nothing reads `state.recipes` until it's set, and no `REPLAY_VERSION` bump is needed. `packages/sim/src/fixtures/recipes-log.ts` pins a log with recipes open.
- Phase 2 reads `shop.recipes` for the shelf and `inventory.recipes` to hide what the sim would refuse. The client's mirror is built from the world snapshot, which doesn't carry `state.recipes`, so `knows` on the mirror says yes to everything: the web goes by `inventory.recipes`.
- A recipe whose good the town starts buying in a season moves its card to that season's shelf. That is a buy-order decision with its own record, and it changes how logged picks and buys of that card replay, so it needs a logged switch once recipes are live.
- The same holds for a holiday mark: once recipes are live, marking an existing card recipe with a holiday makes everyone know it, so logged picks and buys of that card would replay as `already_known`. A new holiday mark on a card recipe needs a logged switch, like a change to the base.
- Code: `packages/sim/src/recipes.ts`, `packages/sim/src/catalog.ts` (`kindHoliday`, `RECIPE_NAMES`, `recipeOf`), `packages/protocol/src/shop.ts` (`RecipeCardView`), `packages/server/src/shop.ts` (`CARDS`, `cardsOn`).
