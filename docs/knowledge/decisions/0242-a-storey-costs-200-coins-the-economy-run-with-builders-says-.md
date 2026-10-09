---
title: A storey costs 200 coins, the economy run with builders says, and the rest of RFC 0028's numbers stand
date: 2026-10-09
status: accepted
tags: [sim, economy, numbers, storeys, scripts]
---

# A storey costs 200 coins, the economy run with builders says, and the rest of RFC 0028's numbers stand

## Context

[RFC 0028](../../rfcs/0028-homes-with-storeys.md) starts `STOREYS.price` at 80 coins and leaves it to an economy run (its PR 3). Its decisions set the target: a regular who saves can afford storey 1 inside two weeks, never in their first days, and a storey is a coin sink that is felt without shrinking the supply. The RFC also asks whether saving crowds out a newcomer's seeds and first costume, and whether wood for stairs and a planked loft starves fishing.

`scripts/economy-sim.ts` now has builders: half the regulars, drawn from their own PRNG stream. A builder settles where branches lie near their hearth, picks up the wood within reach each day at home, skips any wish from the shop that would eat into the storey's price, adds the storey once they hold it with 10 coins to spare, then puts up stairs (4 wood) outside the hut and planks a loft over its 25 tiles (1 wood a tile), as the wood allows. `--no-storeys` draws none of it and plays the month exactly as before: its output matches the run before builders line for line, plus the new comparison lines.

## Decision

| Number | Value | RFC start |
|--------|-------|-----------|
| `max` | 1 storey above the ground floor | 1 |
| `price` | 200 coins | 80 |
| `span` | 2 tiles | 2 |
| `stairsWood` | 4 wood | 4 |

`storeys.test.ts` pins all four.

### What the run says

The default run (seed 1, 30 days, 300 residents, an autumn month with Halloween in it), with storeys and with `--no-storeys`:

| Day | Supply | Per active | Burned that day | Supply, no storeys | Per active, no storeys |
|-----|--------|------------|-----------------|--------------------|------------------------|
| 0 | 4,892 | 37 | 318 | 4,868 | 36 |
| 7 | 11,078 | 141 | 603 | 10,691 | 134 |
| 14 | 18,346 | 199 | 981 | 18,539 | 202 |
| 20 | 24,096 | 205 | 2,486 | 26,228 | 227 |
| 21 | 25,272 | 201 | 1,511 | 27,168 | 220 |
| 29 | 38,257 | 276 | 1,082 | 41,561 | 304 |

```
Storeys (RFC 0028): price 200, stairs 4 wood, a loft of 25 planks.
  Per active resident: day 7 141, day 14 199, day 21 201, day 29 276; 6.1 a day from day 7.
  Newcomers' first 7 days at the shop alone, median (p25, p90): regular 43 (25, 127), visitor 30 (15, 89), drifter 31 (12, 102), oneday 0 (0, 40).
  Of the regulars: builders 37 (15, 125), the rest 51 (30, 131).
  Anglers with a week or more left (n=92): a rod in median 3 days, p90 15, 69 of 92.
  Supply fell on 0 of 29 days.
  Builders: 46 regulars, 33 settled with a week or more left.
  Held the price of a storey: median 9 days after arriving, p25 7, p90 13, earliest 5, 28 of 33.
  Added it: median 9 days after arriving, p25 8, p90 16, earliest 5, 28 of 33.
  Stairs up (4 wood): median 11 days after arriving, p25 9, p90 21, earliest 6, 20 of 33.
  Stairs and a planked loft (29 wood): median 19 days after arriving, p25 19, p90 19, earliest 19, 1 of 33; 280 wood gathered for it in 589 builder-days at home, 0.48 a day.
  Storeys took 5600 coins in the month (5320 burned); in the last 7 days 271 burned a day against 2824 minted a day (10%).

Storeys (RFC 0028): off.
  Per active resident: day 7 134, day 14 202, day 21 220, day 29 304; 7.7 a day from day 7.
  Newcomers' first 7 days at the shop alone, median (p25, p90): regular 66 (30, 163), visitor 30 (15, 75), drifter 31 (6, 100), oneday 0 (0, 40).
  Anglers with a week or more left (n=92): a rod in median 3 days, p90 15, 70 of 92.
  Supply fell on 0 of 29 days.
```

Newcomers' first 7 days, purse plus shop spending (plus a storey, had they added one), median: regulars 191 with storeys and 192 without, visitors 95 and 98, drifters 117 both ways. Halloween: every builder who kept it bought a costume, 99 of 99, as without storeys.

The five checks:

1. Supply per active resident still grows in a straight line, 6.1 coins a day from day 7 against 7.7 without storeys. That is below decision 0039's 12 a day, which was coins alone before the shop's sinks, and close to where the shop and Halloween already put it.
2. A builder holds the price of a storey 9 days after arriving (median), 13 at p90, and never before day 5. At 80, the RFC's start, it was 2 days (median) and day 1 at the earliest: the welcome gift, a townsfolk tip, an allowance, and a first sale reach 80 in a day or two. At 120 the earliest was day 2, at 150 day 3 (median 7), at 250 the median was 11 with 24 of 33 there by month end.
3. Newcomers' first-week spending holds: purse plus shop spending is unchanged, and every builder still buys seeds and a costume. Builders spend less at the shop in their first week (37 against 51 for other regulars), because they hold wishes back for the storey. That is the saving the price asks for, not a crowding out: seeds, cards, and holiday stock aren't held back.
4. Wood at the hearth's reach comes slowly: about half a branch a day on a wooded plot. Stairs go up 2 days after the storey (median day 11), so 4 wood is no gate. A planked loft (29 wood) takes about two months of picking up only what lies within reach, so a builder who wants one sooner lays a free floor or planks part of it, and one who walks to gather would plank it sooner. Each resident gathers on their own plot, so builders take no branches from anglers. The anglers' rods are unchanged (median 3 days, p90 15); 69 of 92 had one against 70, since builders now settle on wooded plots an angler might have taken.
5. Storeys burned 5,320 coins in the month, about 10% of the day's mint in the last week. Supply never fell in this run. With seed 2 it dipped once, by 370, on Halloween's first day, when the costume rush and about two storeys landed together; without storeys that day grew by 375. Over every week the supply grows.

Other runs at 200: seed 2 held it at 8 days (median), earliest 6, p90 12; seed 3 at 8, earliest 6, p90 14; a winter month (`--start 2024-12-04`) at 8, earliest 5, p90 14.

### Where the build departs from the RFC

- The API stays as it was until the RFC's PR 6. The protocol builds its error codes, coin reasons, and block kinds from the sim's lists, so it leaves out what storeys add (`NOT_OPEN_YET` in `packages/protocol/src/schemas.ts`: the six storey refusals, the `storey` coin reason, and `stairs`). The OpenAPI document, SKILL.md, and the changelog don't change, and `move` takes no `up` or `down`. The server keeps `storey_added` off the wire.
- `treasuryShareOf` and `SHOP_SHARE_BEFORE` moved from `shop.ts` to `economy.ts`, so `storeys.ts` can split a storey's price like a shop purchase without importing the shop, which would make an import cycle once `blockNeeds` reads `STOREYS.stairsWood`.
- A build plan refuses stairs whole (`invalid_plan`) until plans take storeys (PR 4), since `place` makes the stairs' checks and a plan doesn't yet. Plans don't yet skip a removal that would leave a floor upstairs unheld either; that is PR 4's `holds_up` skip, and no storey can be added through the API before then.
- Stairs need open air right above them: a block or floor there refuses them with `tile_occupied`, which the RFC asks for without naming a code.
- Gathering, fishing, and knocking on a door from upstairs reuse `ground_floor_only` ("Go down to the ground floor to fish.") rather than a new code.
- A resident who left upstairs comes back there while their floor is still there, and at their hearth when it isn't, instead of always landing on the ground floor.
- The storeys fixture gets its coins from a `test_grant`, since Dee has saved 111, not 200.

## Consequences

- A storey is a week and a half of saving for a regular, and a planked loft is a long goal on top of it. Raising `max` later needs a price for storey 2, by a new run and a decision.
- `price` may change before PR 6 opens storeys, since no live log holds an `add_storey`. Once one does, it changes only behind a logged switch, like `lower_holiday_prices`.
- Rerun `node scripts/economy-sim.ts` (and `--no-storeys` to compare) before changing a number in `STOREYS`; `--set storeys.price=150` tries one without editing it.
