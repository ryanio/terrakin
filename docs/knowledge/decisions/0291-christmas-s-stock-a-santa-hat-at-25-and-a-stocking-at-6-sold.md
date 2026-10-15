---
title: "Christmas's stock: a Santa hat at 25 and a stocking at 6, sold only while Midwinter runs"
date: 2026-10-15
status: accepted
tags: [sim, economy, numbers, holidays, client]
---

# Christmas's stock: a Santa hat at 25 and a stocking at 6, sold only while Midwinter runs

## Context

[RFC 0034](../../rfcs/0034-winter-holidays.md) puts Christmas inside Midwinter: no new holiday id, with the shop naming Christmas on December 24 and 25. Its stock is a Santa hat and a stocking, and it proposed 50 coins for the hat. Halloween's costumes were halved after launch so newcomers could afford one in their first week ([decision 0210](0210-halloween-s-costumes-and-decor-cost-half-from-a-logged-lower.md)), and they now cost 20 to 35; the small holiday decor of Thanksgiving and Hanukkah costs 6. This is the first piece of RFC 0034's slice 4 (issue #70); wrapped presents and New Year's are still to build.

## Decision

- The Santa hat (`santa_hat`) is shop wear in the hat slot at 25 coins, in the range of Halloween's costumes, sold only while Midwinter runs (December 21 to 31) as `MIDWINTER_WEAR`, and yours for good once bought, to wear any day.
- The stocking (`stocking`) is decor at 6 coins, like the dreidel and the leaf garland, sold only while Midwinter runs.
- Both are drawn everywhere the other holidays' things are: on the figure and in pictures, on the map, in both 3D views, and in plot photos. The look editor offers the hat the way it offers a costume: while you own it, wear it, or can buy it today.
- No new rule and no check-in suggestion of their own. Christmas's copy naming (the shelf reading "For Christmas" on December 24 and 25) waits for the presents piece, which owns those days.

An economy run of December 4 to January 2 (`node scripts/economy-sim.ts --start 2026-12-04`): 111 residents kept Midwinter and all 111 bought a costume and a piece of decor, newcomers who arrived from a week before it included (58 of 58). Holiday stock took 3,774 coins in the month, 3,663 of them burned. Supply never fell.

## Consequences

- Midwinter's shelf now holds three things (candy canes, the stocking, the hat), and the shop's refusal outside it names the days for each, as it does for the other holidays.
- Changing a price once the stock has been bought in a live world needs a logged switch, as decision 0210's did, so these numbers are the ones to get right before December 21.
- Code: `MIDWINTER_WEAR` and the hat in `packages/sim/src/looks.ts`, the catalog's `stocking`, `HOLIDAY_STOCK.midwinter` and `WEAR_PRICES` in `packages/sim/src/shop.ts`, `CHRISTMAS_HEX` in `packages/ui/src/looks.ts`, and the drawings in `packages/ui/src/figure.ts`, `packages/ui/src/item-art.ts`, `packages/client/src/render/decor-christmas.ts`, `packages/client/src/scene3d/`, and `packages/cards/src/plot.ts`.
