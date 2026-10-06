---
title: "Autumn's numbers: pumpkins, pumpkin pie and soup, hay bales, and scarecrows"
date: 2026-10-06
status: accepted
tags: [sim, economy, numbers, seasons]
---

# Autumn's numbers: pumpkins, pumpkin pie and soup, hay bales, and scarecrows

## Context

[RFC 0017](../../rfcs/0017-seasons.md) builds autumn: a crop, two kitchen recipes, two pieces of decor, and things the town buys every day of autumn ([decision 0078](0078-seasons-follow-the-utc-calendar-and-add-stock-crops-recipes-.md)). The numbers had to fit the shop's ([decision 0052](0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md)): what the town pays is minted, so a big garden must not print coins, and no recipe may fetch more than its staples cost at the shop plus its produce at the town's price.

## Decision

| Thing | Number |
|---|---|
| Pumpkin | ready in 5 days; a harvest gives 2 pumpkins and a seed back |
| `pumpkin_pie`, at a kitchen | 2 pumpkins and a bag of sugar |
| `pumpkin_soup`, at a kitchen | a pumpkin, a bunch of herbs, and a jar |
| Pumpkin seed | 4 coins, sold in autumn only |
| Hay bale | 8 coins, sold in autumn only |
| Scarecrow | 35 coins, sold in autumn only |
| What the town pays every day of autumn | pumpkins 2 coins each, up to 2 a day from each resident; pumpkin pie 6, up to 1; pumpkin soup 5, up to 1 |

Why these values:

- A pumpkin is big and slow: five days and two to a harvest, where the other crops take two to four days and give three or four. At 2 coins each, a pumpkin planter earns about what a lemon planter does (0.8 coins a day against 0.75).
- The goods follow the jams. Pie fetches 2 coins more than the two pumpkins in it, and soup 2 more than its pumpkin and herbs, as jam does over its lemons. Neither fetches more than its staples at the shop plus its produce at the town's price (`shop.test.ts` checks every recipe), so buying sugar and jars to make them for the town still loses coins.
- Pie needs no flour. Decision 0051 held pies back until there was a grain crop. A pumpkin pie is mostly its filling, and an autumn kitchen without one would feel wrong, so its crust is taken as given. A grain crop and flour stay for a later season, for bread and other pies. Once live, this recipe can't gain flour without changing how old logs replay.
- Pumpkin seeds cost what lemon, strawberry, and tomato seeds do. One pays for itself with its first harvest sold to the town. Pumpkin seeds aren't in the starter kit (decision 0078), so the shop is the way into pumpkins, apart from gifts and the market.
- Decor is priced against the allowance. A hay bale is a step up from a fence post and cheap enough for a few in a corner: three cost about a bench. A scarecrow is a centerpiece between a frame and a lantern, and a regular buys one in about three days.
- Autumn adds at most 15 coins a day. The rotation still offers one resident at most 17 coins a day. Autumn's three buys add at most 15 on top (two pumpkins, a pie, and a soup), and only for a resident with about a dozen pumpkin planters. The pantry's one sugar and one jar a day still cap what a kitchen makes for the town without losing coins.

### The simulated month

`scripts/economy-sim.ts` takes `--start` now. Its default, 2024-10-04, is the month it always played, which is in autumn, so the default run has autumn in it. Gardeners pick pumpkin seeds as one more crop when the shop sells them, and two of the five wish lists now want a scarecrow or a couple of hay bales, skipped in other seasons. Coins per active resident at month end, then what residents sold to the town and spent at the shop a day over the last week:

| Run | October before autumn existed | Autumn, if nobody wanted its decor | Autumn (the default run now) | A spring month (`--start 2025-04-04`) |
|---|---|---|---|---|
| Seed 1 | 354 (661 sold, 703 spent) | 365 (722, 620) | 348 (717, 810) | 358 (668, 636) |
| Seed 2 | 341 (609, 642) | 348 (667, 667) | 338 (669, 719) | 341 (610, 641) |
| Seed 3 | 344 (560, 756) | 346 (579, 775) | 350 (576, 676) | 344 (558, 750) |
| 600 residents | 283 (1,215, 1,218) | 288 (1,324, 1,196) | 282 (1,319, 1,328) | 282 (1,220, 1,185) |
| 150 residents | 406 (315, 373) | 412 (337, 376) | 406 (337, 458) | 409 (318, 354) |

The first column is the base code's run of the same month. The second is the new code with the old wish lists, so nobody buys autumn's decor: an upper bound on what autumn adds.

Autumn's buying adds 3% to 10% to what the town pays. If nobody bought the autumn decor, supply per active resident would end 1% to 3% higher; with it, supply ends about where it does without autumn, and residents spend more at the shop than the town pays them in every run. Every run stays below the world with no shop (397, 376, and 397 coins per active resident with `--no-shop`).

## Consequences

- These numbers replay. `seasons.test.ts` pins them and the autumn log's hash, so changing one needs a decision that says how old logs replay.
- If supply per active resident grows faster in a real autumn than in the run, lower the pie's or the soup's price first: they're most of the 15.
- Code: `CROP_INFO.pumpkin` and `RECIPES` in `packages/sim/src/items.ts`; `SHOP_CATALOG`, `BUY_ORDERS`, `SEASON_STOCK`, and `SEASON_BUYS` in `packages/sim/src/shop.ts`; `scripts/economy-sim.ts`.
