---
title: Paths and floors are a second layer that never blocks, and furniture is held decor that always does
date: 2026-10-06
status: accepted
tags: [sim, protocol, client, economy, numbers, design]
---

# Paths and floors are a second layer that never blocks, and furniture is held decor that always does

## Context

[RFC 0016](../../rfcs/0016-build-with-what-you-gather.md) adds paths and floors (ground) and furniture made from gathered wood and stone. Every block blocks walking today, and walking (`move`, `putter`, the putter planner, landing tiles, the client's taps) all read one rule, `isSolid`: a tile with a block. Old logs must replay to the same hash, and the town's buy rotation, the shop's catalog, and the inventory cap all iterate kind lists. The numbers had to be set before anyone could build with them: the world drops about 125 branches and 69 stones a day across 72 by 72 tiles, up to about 5 a day on one plot.

## Decision

- Ground is its own state, `state.ground` (tile key to kind), absent until the first `lay`. It never changes walking: `isSolid` still reads blocks only. It goes under blocks, hearths, and residents, so a hut gets a floor without losing its walls, and a lantern stands on a path.
- Furniture is a block kind and a stack kind at once, placed and taken up exactly like the shop's decor (`isHeldBlock`), and every piece blocks walking. A walkable piece would make `isSolid` depend on the kind, which every walk reads; what you walk on is ground.
- Furniture joins `BLOCK_KINDS` and `STACK_KINDS` at their ends and `FURNITURE_BLOCKS` beside `DECOR_BLOCKS`, never `GOOD_KINDS` (whose length sets `townBuys`) or `DECOR_BLOCKS` (whose kinds are the shop's catalog). Its recipes are their own table (`FURNITURE_RECIPES` in `sim/src/furniture.ts`), so a new piece (the season's jack-o'-lantern) is one entry. `craft` makes it at a workbench, counts it toward `craftPerDay`, and refuses a label, since stacked things carry none.
- Lifting gives back exactly what laying took, to whoever lifts, like decor. `release` refuses while a plot has ground, as it does while it has blocks.
- The numbers. Ground per tile: `dirt`, `sand`, `moss`, `leaves` free; `cobble` and `stepping_stones` 1 stone; `brick` 2 stone; `planks` 1 wood; `flower_bed` 1 flower; `rug` 1 herb and 1 flower. Furniture: `table` 3 wood, `chair` 2, `bookshelf` 4, `barrel` 3, `signpost` 2, `lamp_post` 1 wood and 2 stone, `well` 2 wood and 6 stone, `stone_wall` 1 stone, `campfire` 2 wood and 3 stone, `flower_box` 1 wood and 3 flowers.

## Why these numbers

- Four free kinds let anyone, and any agent on its first visit, make a plot look designed today. Fallen leaves are free because an autumn season comes next.
- A cobble path of eight tiles is a few days of gathering on a stone plot; a well is about a week. Stone is the scarcer drop, so stone things cost a little more of it and give the market something to trade.
- A low stone wall costs 1 stone because a wall is many tiles, as fence posts are cheap at the shop for the same reason.
- Flowers and herbs feed the flower bed, the rug, and the flower box, so a garden feeds building.

## Consequences

- No coins move: the shop doesn't sell furniture and the town doesn't buy it. Furniture is a sink for wood, stone, and produce; ground holds its materials only while it's laid.
- Old logs replay unchanged: every new command was refused before, and new state is absent until used. `sim/src/fixtures/build-log.ts` pins a log that gathers, makes, places, lays, lifts, and builds.
- Changing a recipe or a ground cost once it's live changes how logged inputs replay, and needs an RFC, like any recipe. `protocol.test.ts` keeps SKILL.md's two tables equal to the sim's.
- Code: `sim/src/ground.ts`, `sim/src/furniture.ts`, `isHeldBlock` and the held-block helpers in `sim/src/items.ts`, the `place`/`remove`/`lay`/`lift` case and `release` in `sim/src/apply.ts`.
