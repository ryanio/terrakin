---
title: Downtown ways are laid by town rule across residents and townsfolk land, and the town clears and rebuilds what they cross
date: 2026-10-22
status: accepted
tags: [server, admin, walking, homes, townsfolk]
---

# Downtown ways are laid by town rule across residents and townsfolk land, and the town clears and rebuilds what they cross

## Context

[RFC 0046](../../rfcs/0046-streets.md) recommended laying ways first on the townsfolk's land and then on residents' plots only with each owner's yes, paid from the treasury. Ryan decided otherwise on 2026-10-22 (calls 3 to 5): the town lays the whole network by rule, across residents' and townsfolk land alike; it fixes up what the ways cross, paying in work rather than coins; and every owner whose plot changes hears what changed and why.

## Decision

The plan is `planWays` in `packages/server/src/way-plan.ts`, a pure function of the world's facts. From the ground joined to the Commons it finds the cheapest target not yet joined, a claimed plot or the bridge landing on downtown's east edge, lays that path as ways, and repeats. Every step is side on, so no block at a corner can ever close a way, and a plot is joined when a tile its hearth's walk reaches has a side on the network. The weights (`WAY_COST`) put townsfolk edges first, residents' edges next, a plot's middle and a home far behind, and a hearth, a planter with a crop, a block under a display, and a wall under an upstairs never. It lays ways across the free slots the network crosses too (Ryan's answer, 2026-10-22), so a later claim can't cut it; `layFree: false` leaves them as open ground, as the RFC measured. It never crosses stairs, a tile under an upstairs, or a plot for sale either.

The fix-up uses existing machinery. Each block on a way tile comes off with `clear_block` ([decision 0343](0343-staff-can-clear-a-block-off-a-plot-to-open-a-way-out-of-a-home.md)), which gives it back to the plot's owner as their own `remove` would. A home is the box two tiles around its hearth, and the whole room when it is closed with its doors shut; a way that crosses one gets it rebuilt by the server-only `rebuild_home`, a `build` as the plot's owner, which puts the home's own kind of free wall on each tile beside the way on the hearth's side of it and a door in the middle one, so it closes again with a door that opens from the hearth onto the way. Homes are read against every way, laid before or new, so a home already rebuilt is closed and nothing is done to it twice.

The staff route `POST /v1/admin/ways` (maintainers only) plans and runs every input on a copy of the world, listing every conflict: each input the sim refuses (an owner with no room for what comes back is `inventory_full`, listed by owner, so staff see them all at once), any plot the plan would leave with no way out that had one, and any hearth that would stop walking to the Commons. With `dry`, or any conflict, it stops there. Otherwise it lays the inputs in order, then sends each owner whose plot changed a `way_laid` notice from Terrakin (the plot, how many tiles, the blocks given back, whether the home was rebuilt) and writes an `open_way` row to the moderation log with the reason. If a save fails partway, the error names the input it stopped at, owners hear about what did change, and running it again plans only what is left. `scripts/ways.ts` prints the same plan from the public `GET /v1/world`, with the plots with no way out and the hearths that walk to the Commons, before and after.

## Consequences

Against the live world on 2026-10-22 the plan is 380 tiles: 126 on 21 residents' plots (at most 15 from one), 61 on 6 townsfolk plots and 193 on free slots, 4 blocks given back, 1 home given a door, 27 owners told. The plots with no way out go from 18 to 0, and the hearths that walk to the Commons from 47 to 48. The tiles on claimed plots (187) are more than the RFC's 147, because every step is side on.

A free slot the network crosses carries its way to whoever claims it next.

Nothing pays a resident for a way on their plot. The town's payment is the fix-up.
