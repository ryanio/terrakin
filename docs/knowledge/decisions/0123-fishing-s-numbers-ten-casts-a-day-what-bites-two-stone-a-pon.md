---
title: "Fishing's numbers: ten casts a day, what bites, two stone a pond, and the town buying each season's own fish"
date: 2026-10-06
status: accepted
tags: [sim, economy, numbers, seasons]
---

# Fishing's numbers: ten casts a day, what bites, two stone a pond, and the town buying each season's own fish

## Context

[RFC 0023](../../rfcs/0023-fishing.md) adds fishing, and [decision 0122](0122-fishing-is-a-cast-beside-a-pond-dug-for-stone-rolled-and-sta.md) says how it works. Its numbers had to fit three things: what a pond and a rod cost against what gathering brings in, how often each fish turns up so that the sky matters and the rare ones stay rare, and what the town pays for fish, which is minted. [Decision 0039](0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md) set the rule for numbers that mint coins: tune them with the simulated month and record what it says. A cast costs nothing but a moment, so fish must never mint coins faster than coming home does.

## Decision

| Thing | Number |
|---|---|
| Casts | 10 a UTC day for each resident, whatever comes up |
| A tile of pond | 2 stone, given back to whoever takes it up |
| `fishing_rod`, at a workbench | 3 wood; it never wears out |
| `fried_minnows`, at a kitchen | 3 minnows and a bunch of herbs |
| `fish_stew`, at a kitchen | a carp, a tomato, and a bunch of herbs |
| What the town pays | each season's own fish (trout in spring, sunfish in summer, salmon in autumn, char in winter) every day of its season, 2 coins each, up to 2 a day from each resident |
| A cast with no water beside you | names the nearest pond within 12 tiles |

What bites, out of 10,000 a cast, in this order (`CATCHES`):

| Catch | Chance | Bites |
|---|---|---|
| old boot | 500 | always |
| minnow | 3,000 | always |
| perch | 1,500 | dawn and day |
| carp | 1,500 | always |
| catfish | 1,500 | dusk and night |
| eel | 1,000 | night, in rain or fog |
| trout | 1,200 | spring and summer, dawn and day, clear or cloudy |
| smelt | 1,200 | spring, dusk and night |
| sunfish | 1,200 | summer, by day, clear |
| salmon | 1,200 | autumn, any time |
| pike | 800 | autumn and winter, dawn, dusk, and night |
| char | 1,000 | winter, cloudy, fog, or snow |
| golden koi | 40 | dawn and day, clear or cloudy |
| moonfish | 120 | night, in rain, fog, or snow |

How often a cast at a random moment brings each up, in percent, from the table, the four quarters of the day, and how often each weather comes in each season (`weatherAt` over a year):

| Season | Minnow and carp | Its own fish | Pike | Eel | Golden koi | Moonfish | Boot | Nothing |
|---|---|---|---|---|---|---|---|---|
| Spring | 45 | trout 4.0 (and smelt 6.0) | none | 0.8 | 0.13 | 0.10 | 5 | 24 |
| Summer | 45 | sunfish 1.6 (and trout 4.7) | none | 0.5 | 0.16 | 0.06 | 5 | 28 |
| Autumn | 45 | salmon 12 | 6.0 | 1.0 | 0.12 | 0.12 | 5 | 16 |
| Winter | 45 | char 6.7 | 6.0 | 0.5 | 0.10 | 0.15 | 5 | 22 |

Perch and catfish add 7.5 each in every season. Nothing comes up 3.8% of the time on an autumn night in the rain, the best sky, and 35% at a rainy spring dawn, the worst.

Why these values:

- Ten casts. A few minutes at the water is a session, and ten fish at most can't crowd a 200-thing inventory. Every cast counts whatever it brings up, so nobody can cast until something good comes.
- Something bites most of the time. Minnows and carp bite in any sky, so a first cast usually brings something up and the common fish fill the book's first page fast. The boot (5%) and nothing (4% to 35%) keep it from being a sure thing, and nothing depends on the sky too.
- The sky matters. Most fish bite only at some times, in some weather, or in some seasons, so knowing the table pays: sunfish come up 12% of the time on a clear summer midday and 1.6% at a random moment. A wet night is the richest sky: eels, catfish, and the moonfish.
- Two rare fish, rare in different ways. The golden koi is the rarer cast (0.4%), but its sky is common: about one in 250 casts on a clear or cloudy morning or afternoon, so ten casts a day under that sky finds one in about 25 days. The moonfish is likelier a cast (1.2%) but only on a wet night, about one in 80 casts there. Over the simulated month's 176 to 350 casts a day, the town as a whole sees one of each every two to ten days, by the season and how many people fish: a little rarer than each rare find, which turns up somewhere every two or three days ([decision 0099](0099-finds-spawn-by-biome-and-season-after-a-logged-open-finds-fr.md)).
- A rod costs what a table or a barrel does, 3 wood. A tile of pond costs 2 stone, what a lamp post takes; a pond of four tiles is 8, a few days of gathering for one resident, and comes back whole when it's taken up. Neither is a sink that grows: they're the price of starting.
- The dishes use the commonest catches, minnows and carp, with produce from the garden. The town doesn't buy them, so they mint nothing.
- The town buys one fish a season, 2 coins each, 2 a day: at most 4 coins a day from one resident, under half the 10-coin allowance, in every season. A fish is priced like a pumpkin but needs no planter and no waiting, so the daily count, not the price, is what holds it down. The rotation still offers at most 17 a day, autumn's pumpkins 15 more, and winter's cranberries 13; fish add 4 to any season. A test (`never pay one resident more in a day than half the allowance` in `fishing.test.ts`) fails if a fish order ever goes over.

### The simulated month

`scripts/economy-sim.ts` plays anglers now: about 70% of regulars, half the visitors, and 30% of drifters fish, casting 4 to 10 times on a day at home once they have a rod and a pond. They settle where branches and stones lie near their hearth, gather until they have 3 wood and 2 stone, make the rod at a workbench and dig a tile north of the hearth, cast at random moments of the day with the server's weather, and sell the town what it's buying of their catch. Their choices come from a PRNG stream of their own, so `--no-fishing` plays the month exactly as before: its runs match decisions 0079 and 0124 to the coin.

Coins per active resident at month end, then what residents sold to the town and spent at the shop a day over the last week, and what the town paid a day for fish:

| Run | Without fishing | With fishing | Paid for fish |
|---|---|---|---|
| Autumn, seed 1 (the default) | 348 (717 sold, 810 spent) | 356 (744, 764) | 45 |
| Autumn, seed 2 | 338 (669, 719) | 347 (714, 775) | 60 |
| Autumn, seed 3 | 350 (576, 676) | 355 (607, 693) | 51 |
| Autumn, 600 residents | 282 (1,319, 1,328) | 286 (1,384, 1,384) | 81 |
| Autumn, 150 residents | 406 (337, 458) | 415 (352, 435) | 19 |
| Winter (`--start 2024-12-04`), seed 1 | 347 (670, 761) | 349 (670, 775) | 15 |
| Winter, seed 2 | 334 (612, 830) | 339 (620, 793) | 24 |
| Winter, seed 3 | 341 (555, 707) | 343 (577, 759) | 32 |
| Spring (`--start 2025-04-04`), seed 1 | 358 (668, 636) | 359 (667, 636) | 11 |
| Summer (`--start 2025-07-04`), seed 1 | 356 (663, 662) | 356 (664, 662) | 6 |

Fishing adds 0% to 2.7% to coins per active resident at month end, most in autumn, when salmon bites at any time in any weather, and least in summer, when sunfish wants a clear midday. Fish are about 1% to 8% of what the town pays. Every seed's run stays below the world with no shop (397, 376, and 397 coins per active resident with `--no-shop` for seeds 1, 2, and 3). In the default run 31 of the 35 anglers who arrived in the first week had a rod by month end, and all the anglers together cast 176 times a day in the last week.

## Consequences

- These numbers replay. `CATCHES` is frozen by name, and `fishing.test.ts` pins it, the costs, the casts, and the town's orders, so changing one needs a decision that says how old logs replay: a new table behind a logged switch for what bites, and a new decision for the rest.
- The month's anglers cast at random moments. One who casts under the right sky catches their season's fish up to seven times as often (sunfish), and no more often in autumn, when salmon bites in any sky; it matters only up to the town's 2 a day. If supply per active resident grows faster in a real autumn than in the run, lower salmon's daily count first.
- Code: `FISHING` and `CATCHES` in `packages/sim/src/fishing.ts`; `POND` in `packages/sim/src/items.ts`; the rod, the dishes, and the fish in `packages/sim/src/catalog.ts`; `BUY_ORDERS` and `SEASON_BUYS` in `packages/sim/src/shop.ts`; `scripts/economy-sim.ts`.
