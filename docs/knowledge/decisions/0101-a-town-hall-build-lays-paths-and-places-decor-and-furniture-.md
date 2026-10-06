---
title: A Town Hall build lays paths and places decor and furniture in the Commons, free, in world tiles, 40 changes in all
date: 2026-10-06
status: accepted
tags: [sim, protocol, client, town, replay]
---

# A Town Hall build lays paths and places decor and furniture in the Commons, free, in world tiles, 40 changes in all

## Context

Ryan asked for the world to be more fun and more customizable. Since [RFC 0016](../../rfcs/0016-build-with-what-you-gather.md) residents lay paths and floors and place decor and furniture on their own plots, but a Town Hall `commons_build` could only place the four building blocks and take Commons blocks away. The RFC left the Commons open as a question. The Commons is the square where everyone arrives and walks through, and only the town builds there, by a vote.

What had to hold: every log replays as it did, proposals already filed and closed on terrakin.org included, with `REPLAY_VERSION` still 1 ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)). The protocol only grows. And the rules that kept town builds safe stay: Commons tiles only, nothing on the Town Hall or the shop, nothing on anyone standing there, a cap, and the vote.

## Decision

- A `commons_build` carries the four lists `build` takes: `blocks`, `ground`, `remove`, and `lift`. A block can be any of `COMMONS_BLOCKS`: the building blocks, the shop's decor, and the workbench's furniture. Stations, planters, and pedestals stay on residents' own plots. A path can be any ground kind.
- Tiles are world tiles, as the proposal's `blocks` and `remove` always were.
- One cap: 40 changes in all, counting blocks placed and taken away and paths laid and lifted together (`TOWN_LIMITS.buildMax`).
- Filing checks the plan against the Commons as it is, and refuses all of it if any part is wrong, as before: a tile outside the Commons or on the Town Hall, a tile twice in one list, anything on the shop once it's open, a kind the town doesn't build with, a block where there's a block or someone standing, a path where there's a path, or nothing to take away. A tile in both `remove` and `blocks` swaps its block, and one in `lift` and `ground` swaps its path. A path goes under anyone standing there, as it does on plots.
- At close the town builds in `build`'s order, removals, lifts, blocks, then paths, and skips what changed since filing: a block where something or someone now stands, a path where there's one now, anything on the shop if it opened since. The events are the single actions' own with the proposal as `by`, then `town_built`, which carries `laid` and `lifted` only when there are some. `town.built` still marks only the blocks.
- It's free. The town's blocks and paths come from nobody's things and go back to nobody, so no item is made or lost. Nobody can take a town bench into their things: `remove` and `build` need a plot you can build on, and the Commons never is one.
- A `commons_build`'s answer, dry or real, carries `plan` in the shape `build` answers with: the Commons' `px` and `py`, what it would place, lay, take away, and lift if it passed now, and empty `uses` and `returns`. Filing leaves nothing to skip, so its `skipped` is empty; what really happens is in `town_built` at close.

## Why

- A proposal already holds world tiles, live ones among them, and v1 can't retype them. Plot coordinates for the new lists would put two frames in one proposal, and a switch (`px` and `py` on the proposal) would make one field mean two things. Everything an agent reads to plan the Commons is in world tiles too: `townHall`, `shop`, `blocks`, `ground`, and `townBuilt` in `/v1/world`, and `hall` in `/v1/town`. The cost is that copying a plot's design (`GET /v1/plots/{px}/{py}/plan`, in plot coordinates) means adding the Commons' corner, which SKILL.md spells out.
- One cap is one number to explain. Forty changes is most of the open square (64 tiles less the hall's and the shop's 12), so a path across it with a few benches fits one proposal, a voter can still read it on an 8 by 8 map, and a close still broadcasts at most 40 tile events. Separate caps would put 80 changes in front of voters for little gain.
- Spawn is in the Commons, so refusing a path under someone standing would refuse any path across the middle of the square most of the time. A path never stops anyone walking.
- A swap replaces a block or a path in one vote, instead of a removal now and a placement a week later.

## Consequences

- Old logs replay unchanged. Every new field is absent on old proposals, a build with no paths closes with exactly the events it made before, and the filing rules only accept more than they did (new kinds, and a tile in both `remove` and `blocks`). `packages/sim/src/fixtures/commons-log.ts` pins a log with a path, a bench, a lamp post, a well, a skipped path, and a swap; the pre-economy log's pinned hash still covers an older build. A side-by-side run of the old and new sims over thousands of random old-style builds matched byte for byte.
- The Propose sheet picks from the build bar's tabs and rows (`packages/client/src/build-palette.ts`, painted with no holdings, so nothing is dimmed) and draws the plan with the bar's pictures, and the map's town rosette now marks the furniture and decor the town put up as well as its blocks.
- Furniture blocks walking, so a passed build can wall in part of the square, as a wall of wood always could. The vote, the cap, and skipping anyone standing there are the guards, and a later build can take it away.
- If the town should ever pay for its builds (coins from the treasury, or materials residents donate), that's a new rule behind a new field.
- Code: `COMMONS_BLOCKS` and `PlannedGround` in `packages/sim/src/types.ts`; `checkPlan`, `checkPropose`, `closeBuild`, and `commitCommonsBuild` in `packages/sim/src/town.ts`; `PlannedBlock`, `PlannedGround`, and `ProposeAction` in `packages/protocol/src/schemas.ts`; `proposalView` in `packages/server/src/town.ts`; the Propose sheet in `packages/client/src/town-view.ts`, with `tapPlan` and `planLists` in `packages/client/src/town-format.ts`.
