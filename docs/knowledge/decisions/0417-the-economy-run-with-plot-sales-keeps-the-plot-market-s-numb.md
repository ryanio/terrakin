---
title: The economy run with plot sales keeps the plot market's numbers and finds flipping pays only while free downtown land lasts
date: 2026-10-31
status: accepted
tags: [economy, plots, sim, numbers]
---

# The economy run with plot sales keeps the plot market's numbers and finds flipping pays only while free downtown land lasts

## Context

The switch-on checklist in [the plot market plan](../../plans/plot-market-web.md) asks for `scripts/economy-sim.ts` to be rerun with plot sales and RFC 0039's flip test (claim a free plot, wait 14 days, sell it) before the market opens, with the median purse and the treasury reported. The sim had no plot sales, so `--plots` adds them: the world opens the item market, its first island (the server's own `planLand`) and the plot market with a cap of 3, and residents drawn from their own stream trade. A fifth of residents are sellers, who list a plot they may sell on 3% of their days at home for 150 to 600 coins. 3% are flippers, who list each plot the day they may at the going rate (the median sale so far, 300 before any) and claim a free plot again once it sells. A tenth are collectors, who buy the cheapest listing they can pay for and still keep 50 coins. Those shares and prices are guesses, since nobody has traded a plot yet.

## Decision

Keep the numbers Ryan kept on 2026-10-31: a 25-coin listing fee, the 5% fee, no price floor, and 14 days before a plot can be sold.

`node scripts/economy-sim.ts --days 60 --plots` against the same 60 days without `--plots` (seed 1, 300 residents):

| | Without plots | With plots |
|---|---|---|
| Supply at the end | 95,593 | 94,749 |
| Treasury at the end | 15,324 | 15,483 |
| Median purse, every settled resident | 125 | 127 |
| Median purse, arrived in the first week | 309 | 247 |
| Median purse, first-week regulars | 1,208 | 1,133 |

18 listings, 12 sales, the first on day 21. They sold at a median of 304 coins (p10 171, p90 377) and moved 3,607 coins between residents. 177 coins went to the treasury in fees and 450 were burned in listing fees. Nothing was minted, and no welcome gift waited. The first-week medians fall because collectors, who arrive early and save, spend on plots; the coins go to sellers, not out of the economy.

The flip test: 4 of 8 flippers sold at least once. Flipping brought a flipper a median of 264 coins net of listing fees (most 528), and flippers ended with a median purse of 441 against 127 for every settled resident. So flipping pays in this run. But the sim's world never runs out of free land, and every plot in it can be listed. On terrakin.org the market opens only after the first island has opened, which happens when 9 free downtown plots are left (`LANDS.openAt`), and listing is downtown only. A flipper there competes with every newcomer for those few plots and waits 14 days a round, so flipping stops when downtown fills, which this run never reaches. The large-sale watch ([decision 0416](0416-a-large-plot-sale-with-a-young-resident-in-it-gets-a-line-in.md)) shows staff any young account that does it at scale.

## Consequences

- If flipping shows up on terrakin.org before downtown fills, the lever is the 14 days, or listing only after a plot has been held longer.
- `--plots` is opt-in and draws from its own stream, so every other run plays as before. A 60-day run takes about 10 minutes.

Code: `tradePlots` and `plotLines` in `scripts/economy-sim.ts`.
