---
title: Seasons follow the UTC calendar and add stock, crops, recipes, and buys without changing how old logs replay
date: 2026-10-06
status: accepted
tags: [sim, economy, protocol, replay, seasons]
---

# Seasons follow the UTC calendar and add stock, crops, recipes, and buys without changing how old logs replay

## Context

[RFC 0017](../../rfcs/0017-seasons.md) starts Phase 3 with seasons, and autumn is now. A season has to change what the town shop sells and what the town buys, while the live world's log replays to the hash it has. Three things in the sim were written as "every kind in the catalog", so they would have changed what old inputs did the moment a crop or a recipe joined it:

- The first pantry gave `ITEMS.starterSeeds` of every kind in `SEED_KINDS`.
- `townBuys(day)` picked the day's kinds from `GOOD_KINDS` and `CROPS` by the day modulo their lengths. A longer list changes what the town bought on every past day, and an old `sell_to_town` could be refused on replay.
- `SHOP_SKUS` is every decor kind, every seed, and the staples, so a new seed or piece of decor goes on sale all year unless something stops it.

## Decision

- The season is a pure function of the logged day: `seasonOf(state.day)` in `sim/src/season.ts`, where spring is March to May, summer June to August, autumn September to November, winter December to February, by the UTC calendar. There is no season state and no season input. The day is already in the log ([decision 0026](0026-time-enters-the-sim-as-logged-day-and-close-inputs.md)), so every replay sees the same season.
- A season's content is data in the sim. `SEASON_STOCK` lists the shop stock sold only in each season, and `SEASON_BUYS` what the town buys every day of each season, in `sim/src/shop.ts`. A season's crops, decor, and recipes join the catalog like any other kind.
- Only the shop's selling and buying are seasonal. `shop_buy` refuses seasonal stock out of its season with a new code, `out_of_season`, whose message says when the season starts. The town buys a season's kinds only in that season (`not_buying` otherwise). Planting, harvesting, crafting, placing, giving, and the market never read the season, so what you have keeps working when the season ends.
- The lists old logs depend on are frozen. The first pantry gives `STARTER_SEEDS`, the five seeds it always gave. The daily rotation cycles through `ROTATION_GOODS` and `ROTATION_CROPS`, the eight goods and five crops it always had, and `townBuys(day)` is that rotation followed by `SEASON_BUYS[seasonOf(day)]`. A new kind never joins a frozen list.
- Tests pin it. `sim/src/fixtures/autumn-log.ts` buys, plants, makes, and sells autumn's things on autumn days, then uses them in winter. `seasons.test.ts` pins its hash, the frozen rotation, and the refusals on either side of autumn, and `replay.test.ts` covers it at every split point. The items log's pinned hash covers the starter seeds.
- The API shows today's stock: `GET /v1/shop` lists only what's sold today, with `shop.season`, `season` and `lastDay` on seasonal items, and `season` on seasonal buy orders.

## Why

- Every past `sell_to_town`, `shop_buy`, and first pantry replays the same: a new kind could never have been accepted before it existed, and the frozen lists give every old input the answer it got. `REPLAY_VERSION` stays 1, and no switch input is needed.
- A calendar season needs nothing from the server and can't drift from the calendar people live by. A logged `set_season` input would let the server choose, but it would be one more thing to schedule, and the world would disagree with the calendar whenever it ran late.
- Keeping what you have usable is kinder than crops that die when the season ends, and it leaves seasonal things worth giving and trading after their season.

## Consequences

- Seasons change with the calendar, so a test that reads the shop on a real date has to say which season it means. The e2e shop spec moves its clock into autumn and out of it.
- A future season's crop, decor, or recipe is a catalog entry plus a line in `SEASON_STOCK` or `SEASON_BUYS`, with its numbers in a decision of its own, like [decision 0079](0079-autumn-s-numbers-pumpkins-pumpkin-pie-and-soup-hay-bales-and.md).
- Adding a kind to a season's buys, or making seasonal stock sold all year, never changes replay: it only accepts what was refused, and refusals aren't logged. Taking a kind out of `SEASON_BUYS`, making a sku seasonal after it was sold all year, or changing a price does change replay, and needs a decision that says how old logs replay.
- Code: `SEASON_STOCK`, `SEASON_BUYS`, `onSale`, `townBuys`, and the frozen rotation in `sim/src/shop.ts`; `STARTER_SEEDS` in `sim/src/items.ts`; `itemsOn` and `buyingToday` in `server/src/shop.ts`.
