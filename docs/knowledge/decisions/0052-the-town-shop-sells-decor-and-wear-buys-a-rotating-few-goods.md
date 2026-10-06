---
title: The town shop sells decor and wear, buys a rotating few goods, and opens with a logged input
date: 2026-10-05
status: accepted
tags: [sim, economy, numbers, protocol, server, client]
---

# The town shop sells decor and wear, buys a rotating few goods, and opens with a logged input

## Context

[RFC 0008](../../rfcs/0008-coins-karma-and-the-market.md) phase 2 is the town shop: the first coin sink, and a buyer for what residents grow and make ([decision 0051](0051-items-open-with-a-logged-input-grow-by-the-world-s-day-and-s.md)). The RFC gives a catalog shape and sample prices and leaves the numbers to a simulation. Three things had to be settled before the numbers meant anything:

- Every block and every piece of wear is free today, and the RFC says what is free stays free. So the shop needs things that are new, and a reason a bought block isn't just placed for nothing.
- A garden is a permanent machine. A harvest gives its seed back, planters are free, and one seed bought is a crop every few days forever. Any price the town pays for produce, times an unbounded garden, prints coins.
- The live log has to replay to the hash it has, and the pantry numbers (`ITEMS.pantry`) are read on every resident's input.

## Decision

**A logged input opens the shop.** The server appends `open_shop` once coins and items are open, as it does `open_economy` and `open_items`. Everything here, the smaller pantry included, reads `state.shop`, so a log without `open_shop` replays as it always did. `src/fixtures/shop-log.ts` pins a log with the shop open.

**What the shop sells is new.** Four decor blocks (`lantern`, `frame`, `fence`, `bench`) are block kinds that also stack in your things: `place` uses one you hold, `remove` puts it back, and a starter home can't be built from them. Three pieces of wear (`top_hat`, `raincoat`, `umbrella`) are bought once and kept for good in `shop.wardrobe`; wearing one you don't own is refused. The free blocks and wear stay free. The shop also sells seeds, sugar, and jars. The catalog is data keyed by item kind and wear name (`SHOP_CATALOG` in `packages/sim/src/shop.ts`).

**5% of every purchase goes to the treasury and the rest is burned.** The treasury's share rounds down, so a purchase under 20 coins is all burned. Its ledger line says `shop` and never who bought, because purses are private and the treasury's history is public. The shop opened at 50% and moved to 5% the same day, once the simulated treasury showed half was far more than it needs. The share is `SHOP.treasuryShare`; the server logs `set_shop_share` whenever the world's share differs, so the live log's first purchases replay at 50% and everything after at 5%.

**The town buys a few kinds a day, one or three of each per resident.** `townBuys(day)` is a fixed rotation over the day number: three of the eight made things and one of the five crops each UTC day, every kind coming up within eight days. Everything else is refused as `not_buying`. What the town pays is minted, like the allowance. The day's whole offer is worth at most 17 coins to one resident, however big their garden.

**The pantry shrinks once the shop sells staples.** From `open_shop` on, the daily pantry gives 1 bag of sugar and 1 jar, up to 6 of each (it was 2 and 2, up to 10).

**Townsfolk keep the shop and never shop.** Clem, who already runs the cafe, is the shopkeeper: `GET /v1/shop` names whoever holds the handle `clem` while they are townsfolk. Townsfolk are refused at the counter (`not_eligible`), since their coins are the town's.

### The numbers

| Thing | Price | | Town buys | Pays | Per day |
|-------|-------|-|-----------|------|---------|
| Paper lantern | 40 | | Lemon jam, strawberry jam | 5 | 1 |
| Picture frame | 30 | | Tomato sauce, flower wreath | 6 | 1 |
| Garden bench | 25 | | Lemonade | 4 | 1 |
| Fence post | 3 | | Herb tea, bouquet, herb sachet | 3 | 1 |
| Top hat | 80 | | Any one crop | 1 | 3 |
| Raincoat | 90 | | | | |
| Umbrella | 60 | | | | |
| Lemon, strawberry, tomato seed | 4 | | | | |
| Herb, flower seed | 3 | | | | |
| Sugar, jar | 3 | | | | |

`scripts/economy-sim.ts` now plays gardens and shopping through the real sim: about half the settled residents garden (70% of regulars), place a kitchen, a workbench, and a planter per seed, buy seeds up to 10 to 22 planters, and each day make and sell what the town buys; everyone buys from a short wish list when they can afford it with 10 to spare. Gardens and shopping draw from their own random stream, so `--no-shop` plays exactly the month decision 0039 recorded, with the same people visiting on the same days. Coins per active resident at month end:

| Run | Phase 1 (`--no-shop`) | With the shop | Sold to the town, last 7 days | Spent at the shop, last 7 days |
|-----|----------------------|---------------|-------------------------------|--------------------------------|
| Seed 1, 300 residents | 377 | 335 | 670 a day | 701 a day (355 burned) |
| Seed 2 | 356 | 318 | 618 | 714 |
| Seed 3 | 378 | 331 | 566 | 680 |
| 600 residents | 285 | 280 | 1,240 | 1,304 |
| 150 residents | 447 | 391 | 315 | 352 |

Seed 1, day by day:

| Day | Active | Per active resident | Sold | Spent | Burned |
|-----|--------|---------------------|------|-------|--------|
| 0 | 25 | 44 | 0 | 153 | 78 |
| 7 | 59 | 141 | 282 | 694 | 350 |
| 14 | 77 | 212 | 403 | 635 | 320 |
| 21 | 110 | 248 | 592 | 837 | 424 |
| 29 | 125 | 335 | 570 | 408 | 208 |

In every run supply per active resident ends below the phase 1 world, and residents spend 5% to 20% more at the shop than the town pays them. A regular's month-end purse barely moves (median 432 against 422): what they earn selling, they spend. Gardeners who arrived in the first week end with a median of 175 to 441, depending on the seed, since they spend on seeds as well.

Why these values:

- **A gardener earns about what coming home earns.** Selling brings a gardener 10 to 12 coins a day, next to the allowance's 10 to 15. Making things is worth doing without becoming the way to get rich.
- **One of each made thing a day.** With the first draft (two of each, two crops a day, jam at 6) the town minted far more than residents spent and supply per active resident ended above phase 1. Caps of one, a single crop a day, and prices a coin lower brought sales just under spending.
- **Made things pay from the free pantry, not from bought staples.** Jam fetches more than the three lemons in it, so making beats selling raw produce. But no recipe fetches more than its staples cost at the shop plus its produce at the town's price (`shop.test.ts` checks every one). The town takes only three of one crop a day, so spare produce can still turn a small profit through a bought jar: tomato sauce, for example, earns 3 coins over its jar on a day the town buys sauce. That is the most a kitchen can gain from the shop's staples, so the pantry still sets what a kitchen earns.
- **A smaller pantry.** With the first draft of the script, a pantry of 2 and 2 had the town minting about a third more than at 1 and 1, and a pantry of 0 left gardeners earning little. 1 and 1 sits between, and the shop sells more to anyone making gifts rather than sales.
- **Decor and wear priced against the allowance.** A regular can buy a lantern in three or four days and a raincoat in about a week, as decision 0039 planned. Fence posts are cheap on purpose: a fence is many of them, and that is a sink people will enjoy.

## Consequences

- At 5% the treasury ends the default month at 3,367, against 11,409 at 50% and 2,690 with no shop, and supply per active resident is unchanged (335): the share only decides whether spent coins sit in the treasury or leave the world. At 600 residents the treasury runs near empty and welcome gifts wait for a `new_day` (355 waited in the month, 16 at its end), as decision 0039 found without the shop (358 and 36); at 50% none would have waited, which is the reason to raise the share if the town grows that fast. If grants and bounties (RFC 0008 phase 5) need more, raise the share with `set_shop_share` by a decision, not the mint.
- Changing the share is a logged input, so it never changes how an earlier purchase replays. A new share is a change to `SHOP.treasuryShare` and a deploy.
- The script's spending is a floor: simulated residents stop at a short wish list, real ones won't. If supply per active resident grows faster than the default run, lower a buy order's price or count first.
- Changing `SHOP_CATALOG`, `BUY_ORDERS`, `SHOP`, or `townBuys` changes how a log with the shop replays, and `shop.test.ts` pins both the prices and the shop log's hash. Such a change needs a decision that says how old logs replay (for example, a new logged input that switches to the new numbers).
- Selling to the town is a faucet with a fixed daily ceiling per resident, so it scales with active residents like the allowance. The market (phase 4) will price goods against the town's buy prices.
- Code: `packages/sim/src/shop.ts`, `pantryNumbers` and the decor helpers in `packages/sim/src/items.ts`, `shopTiles` in `packages/sim/src/world.ts`, `packages/protocol/src/shop.ts`, `packages/server/src/shop.ts`, `packages/client/src/shop-view.ts`.
