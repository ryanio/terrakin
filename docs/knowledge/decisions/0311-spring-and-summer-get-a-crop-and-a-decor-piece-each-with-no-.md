---
title: Spring and summer get a crop and a decor piece each, with no new buy orders
date: 2026-10-18
status: accepted
tags: [sim, economy, numbers, seasons, items]
---

# Spring and summer get a crop and a decor piece each, with no new buy orders

## Context

Seasons were half built. Autumn has pumpkins, hay bales and a scarecrow; winter has cranberries, a snowman, a string of lights, a little fir and a sled ([decision 0079](0079-autumn-s-numbers-pumpkins-pumpkin-pie-and-soup-hay-bales-and.md), [decision 0124](0124-winter-s-numbers-cranberries-hot-cranberry-punch-winter-deco.md)). `SEASON_STOCK.spring` and `SEASON_STOCK.summer` were empty arrays. Half the year, the shop's seasonal shelf is simply not there, and the season shows only in the ground's color and what bites in the pond.

[Decision 0308](0308-a-basket-of-fourteen-crops-sold-all-year-with-ten-recipes-an.md) sold all fourteen of its new seeds all year rather than filling those two seasons, for a reason worth keeping: a kind's place in `SEASON_STOCK` is replay. `shop_buy` refuses seasonal stock out of its season, and replay re-checks every logged input, so moving a kind anyone has already bought into a season would refuse a purchase that was accepted and break the log. Only a new kind can join a season safely.

## Decision

Spring and summer each get one crop and one piece of decor, new kinds both, so nothing logged changes:

| | Spring | Summer |
|---|---|---|
| Crop | Pod of peas, 3 days, 3 and a seed | Chili, 3 days, 3 and a seed |
| Its seeds | 3 coins, spring only | 3 coins, summer only |
| Decor | Bird bath, 22 coins | Beehive, 18 coins |

The crops take the numbers the quicker vegetables already have (3 days, 3 a harvest, a seed back, 3 coins a packet), and the decor sits between a hay bale at 8 and a scarecrow at 35, where winter's pieces sit.

**No new buy orders**, exactly as decision 0308 settled it: nothing joins `BUY_ORDERS` or a season's buys, so what the town pays per resident per day is still the number `scripts/economy-sim.ts` was run with. Each season's own fish stays the one thing the town buys more of in it.

## Consequences

- Every season now has a shelf of its own in the shop, and a reason to plant something you cannot plant the rest of the year. Peas and chilis are for the kitchen, gifts and the market, like the rest of decision 0308's basket.
- Spring and summer still differ from autumn and winter in one way: their crops earn no coins, while pumpkins and cranberries do. Giving either a buy order is a decision of its own, with the simulated month run first, and it would want recipes to go with it.
- Two more blocks: `bird_bath` and `beehive` go on the end of `BLOCK_KINDS` with their colors, their item pictures, their drawing on the map, their 3D models, and their plot photo shapes. That is the full cost of a decor kind, and it is worth writing down before the next one.
- The crops use shapes the catalog already draws, except peas, which brought a `pod` outline that any later pod crop can use.
