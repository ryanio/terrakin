---
title: "Winter's numbers: cranberries, hot cranberry punch, winter decor, the town's winter buys, and Midwinter's candy canes"
date: 2026-10-06
status: accepted
tags: [sim, economy, numbers, seasons, holidays]
---

# Winter's numbers: cranberries, hot cranberry punch, winter decor, the town's winter buys, and Midwinter's candy canes

## Context

[RFC 0017](../../rfcs/0017-seasons.md) builds each season's content on the seasons machinery ([decision 0078](0078-seasons-follow-the-utc-calendar-and-add-stock-crops-recipes-.md)), and winter starts on December 1. Its sketch named cranberries, a sauce, mulled cider, a little fir, and string lights. Two things changed the sketch. The catalog's jam family recipe ([RFC 0018](../../rfcs/0018-one-catalog-of-things.md)) already makes a jam from any fruit, so a cranberry sauce would be a second jam. And there are no apples for a cider, so the warm drink is a punch made from what a winter garden has.

The numbers had to sit with autumn's ([decision 0079](0079-autumn-s-numbers-pumpkins-pumpkin-pie-and-soup-hay-bales-and.md)) and the shop's ([decision 0052](0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md)): what the town pays is minted, so a big garden must not print coins, and no recipe may fetch more than its staples cost at the shop plus its produce at the town's price. A winter holiday, if there was one, had to fit [RFC 0022](../../rfcs/0022-holidays.md)'s model and stay small ([decision 0106](0106-holidays-are-dated-windows-read-from-the-world-s-day-candy-i.md)).

## Decision

| Thing | Number |
|---|---|
| Cranberry | ready in 4 days; a harvest gives 3 cranberries and a seed back |
| `cranberry_jam`, at a kitchen | the jam family recipe: 3 cranberries, a bag of sugar, and a jar |
| `cranberry_punch` (hot cranberry punch), at a kitchen | 2 cranberries, a lemon, and a jar |
| Cranberry seed | 4 coins, sold in winter only |
| Snowman | 30 coins, sold in winter only |
| String of lights | 12 coins, sold in winter only; it glows after dark |
| Little fir | 20 coins, sold in winter only |
| Sled | 25 coins, sold in winter only |
| What the town pays every day of winter | cranberries 1 coin each, up to 3 a day from each resident; cranberry jam 5, up to 1; hot cranberry punch 5, up to 1 |
| Midwinter | December 21 to December 31 |
| Candy cane at the shop | 2 coins, during Midwinter only |
| Candy cane at a kitchen | 5 from a bunch of herbs and a bag of sugar, any day |

Why these values:

- Cranberries like cold ground: they grow in northern bogs and live through frozen winters. As a fruit, they bring their jam with them. Four days and three to a harvest is a lemon's crop, and at 1 coin each a cranberry planter earns what a lemon planter does, 0.75 coins a day. The town takes 3 a day, as it does a rotation crop.
- The goods follow the jams. Cranberry jam fetches 5, like lemon and strawberry jam, 2 coins more than the three cranberries in it. The punch fetches 5 too, 2 more than its two cranberries and its lemon. Neither fetches more than its staples at the shop plus its produce at the town's price (9 and 6 coins), and `shop.test.ts` checks every recipe.
- Winter adds at most 13 coins a day, under autumn's 15: 3 for cranberries, 5 for jam, and 5 for punch, and only for a resident with about a dozen cranberry planters, a lemon, and two jars. Jam and punch each take a jar and the pantry gives one a day, so the second of them needs a bought jar, which leaves 2 coins for 3 coins' worth of produce. The pantry still sets what a kitchen earns, as decision 0052 intended.
- Cranberry seeds cost what every fruit's seeds cost. Three cranberries make a jar of jam worth 5, so a seed pays for itself with its first harvest. Cranberry seeds aren't in the starter kit (decision 0078): the shop, a gift, or the market is the way into them.
- Decor is priced against autumn's and Halloween's. A string of lights costs what bat bunting does, cheap enough to string a few along a path. A little fir in a pot sits between a hay bale and a bench. A sled costs a bench's price. A snowman is a centerpiece like a picture frame or a cauldron, 5 under a scarecrow, since it's made of snow.
- Midwinter runs from December 21, the longest night in the north, to December 31, the last night of the year, and stops there because a holiday never runs into the next year. It brings one thing to buy, candy canes, and no action of its own. A candy cane is a sweet that stacks, like candy, so a person or their AI can give a few to neighbors. At the shop it costs what candy does. From a kitchen, five candy canes cost at most 4 coins (herbs sell for 1, sugar costs 3), under a coin each. The town buys no sweets, so none of this mints a coin.
- Midwinter's evenings glow gold on the map and in 3D, and lamps, fires, and strings of lights shine a fifth brighter after dark. That is drawing only, from the world's day, like Halloween's purple.

### The simulated month

`scripts/economy-sim.ts --start 2024-12-04` plays a winter month. Gardeners pick cranberry seeds as one more crop when the shop sells them, and three of the five wish lists now want a snowman, two strings of lights, or a little fir and a sled, skipped in other seasons without a draw, so the autumn and spring months play exactly as before. Coins per active resident at month end, then what residents sold to the town and spent at the shop a day over the last week:

| Run | Winter before winter existed | Winter, if nobody wanted its decor | Winter (the run now) | Autumn (the default run), unchanged |
|---|---|---|---|---|
| Seed 1 | 355 (650 sold, 703 spent) | 360 (673, 626) | 347 (670, 761) | 348 (717, 810) |
| Seed 2 | 343 (595, 658) | 345 (617, 661) | 334 (612, 830) | 338 (669, 719) |
| Seed 3 | 343 (547, 756) | 343 (551, 769) | 341 (555, 707) | 350 (576, 676) |
| 600 residents | 280 (1,169, 1,230) | 281 (1,231, 1,251) | 279 (1,231, 1,299) | 282 (1,319, 1,328) |
| 150 residents | 405 (307, 374) | 411 (315, 354) | 400 (312, 460) | 406 (337, 458) |

The first column is the base code's run of the same month. The second is the new code with the old wish lists, so nobody buys winter's decor: an upper bound on what winter adds.

Winter's buying adds 1.5% to 5% to what the town pays, less than autumn's 3% to 10%. If nobody bought the winter decor, supply per active resident would end up to 1.5% higher; with it, supply ends 0.4% to 2.6% lower than before winter, and residents spend more at the shop than the town pays them in every run. Every run stays below the world with no shop (397, 376, and 397 coins per active resident with `--no-shop` for the three seeds).

A later winter month (`--start 2025-01-20`) agrees: 350, 334, 348, 280, and 400 coins per active resident, against 358, 344, 344, 283, and 409 before winter existed. At 600 residents in that month the town pays more than residents spend, with winter (1,331 against 1,238) and without it (1,263 against 1,189), since the wish lists run out.

## Consequences

- These numbers replay. `winter.test.ts` pins them and the winter log's hash (`packages/sim/src/fixtures/winter-log.ts`), so changing a price, a recipe, a crop, or a cap needs a decision that says how old logs replay. Adding a day to Midwinter only accepts what was refused, so it changes no logged purchase; taking one away does.
- If supply per active resident grows faster in a real winter than in the run, lower the punch's price first, then the jam's.
- Nothing joined a frozen list: cranberry seeds aren't starter seeds, cranberries and their goods aren't in the rotation, and holly stays the only winter find. `REPLAY_VERSION` stays 1.
- Code: the `cranberry`, `cranberry_punch`, `snowman`, `string_lights`, `little_fir`, `sled`, and `candy_cane` entries in `packages/sim/src/catalog.ts`; `BUY_ORDERS`, `SEASON_BUYS`, and `HOLIDAY_STOCK` in `packages/sim/src/shop.ts`; `HOLIDAY_INFO.midwinter` in `packages/sim/src/holiday.ts`; `scripts/economy-sim.ts`.
