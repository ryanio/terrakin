---
title: The town turns every wall block into lines, then logs walls_on_lines, and slim_walls leaves the API
date: 2026-11-09
status: accepted
tags: [server, protocol, building, rfc-0050, switches]
---

# The town turns every wall block into lines, then logs walls_on_lines, and slim_walls leaves the API

## Context

Ryan decided wall blocks go away entirely (decision 0428). The town's one slim (decision 0404) had turned only rooms fully walled in by blocks, so on 2026-11-08 terrakin.org still had wall blocks on 23 plots, 8 of them townsfolk homes. Most were huts with an open doorway the slim couldn't read: a hedge across the way in made the doorway look like a room one tile wide, a two-tile doorway or a passage between inner posts let a walk from the plot's edge in, and a lantern walled in beside a hut passed for a room of its own. The rest stood on their own: hedges and wood round homes already on lines, corner posts, lone door blocks.

## Decision

1. The server's planner (`slimPlan` in `packages/server/src/slim-plan.ts`) turns every wall block on a plot into lines. Rooms are read as before, with doorways read as chains of gaps across a wall: the gap beside a room is a doorway, and so is the next one out while the wall goes on past both its ends (a wall two thick), which a hedge in front of a door doesn't. A gap of two tiles counts, a nook with something on every tile is no room, a gap or a wall block across a line from a room is no part of it, and a door block comes up with a room only where it stands in a run of wall. Every block left is a loose wall: a run along a row takes the north lines of its tiles (south on the plot's top row), a run down a column the west lines (east on the west column), corners pick the sides that meet, a run that is only another's thickness gives way, a wall two thick puts one line down its middle, and a run whose line already stands on half its tiles or more, or a block with a wall touching it, puts up nothing. A lone door comes up.
2. Lines past what the blocks and the first slim's gift pay for, in every made material and grade, go up in the home's other walls or in wood (glass for a window), so the town never spends an owner's things.
3. The server's `wallsOnLines` option (in `WORLD_SWITCHES`) logs each plot's plan as `town_slim` (`townLines`), unlike decision 0404's sweep taking what it can even where something is skipped, a thing hung on an old wall goes back, or a note is new. Owners who aren't townsfolk get `home_slimmed`. In the same tick, after every plot, it logs `walls_on_lines`. On each later world day it tries again any plot still holding a wall block, such as one whose owner's things were too full to take back a made material.
4. `slim_walls` leaves the action schema and SKILL.md (decision 0146). The sim keeps the command so logs replay. The staff route `POST /v1/admin/slim-home` runs `townLines` for one plot.
5. `rebuild_home` takes an optional `edges`, and the way planner rebuilds a home a way cut through with lines between the home and the way, where the way's tile is the owner's; a line on the plot's border is left for staff. A rebuild logged before has no `edges` and replays as it did. The townsfolk seed's signature walls go on lines too.

## Consequences

- No sim rule changed: the planner is the server's and its output is logged, and an absent `edges` builds what it always did. `REPLAY_VERSION` stays.
- Run against the 2026-11-08 snapshot, every one of the 23 plots converts with nothing skipped and nothing taken; `slim-plan.test.ts` pins eleven of them before and after.
- Stubs remain where a run ends on the plot's border or where corners disagree, and a hedge hugging a wall disappears into it. Both are judgement calls in `looseFloor`, safe to change since nothing replays them.
- Code: [packages/server/src/slim-plan.ts](../../../packages/server/src/slim-plan.ts), `wallsToLines` in [packages/server/src/world-service.ts](../../../packages/server/src/world-service.ts), [packages/server/src/way-plan.ts](../../../packages/server/src/way-plan.ts), [packages/sim/src/rebuild-home.ts](../../../packages/sim/src/rebuild-home.ts).
