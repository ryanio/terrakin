---
title: Town Hall builds keep the game tables' spots clear, from a logged keep_table_spots
date: 2026-10-06
status: accepted
tags: [sim, server, protocol, town, games, replay]
---

# Town Hall builds keep the game tables' spots clear, from a logged keep_table_spots

## Context

Party games stand their tables at four spots in the Commons, and a spot with a block on it takes no table ([decision 0095](0095-party-games-are-sealed-rounds-the-server-stamps-closes-and-l.md)). Only the town builds in the Commons, through a `commons_build` that passes a vote ([decision 0101](0101-a-town-hall-build-lays-paths-and-places-decor-and-furniture-.md)), so a few passed builds could leave no room for a game anywhere. Ryan's call (2026-10-06): Commons builds skip the four table spots.

Builds could always put blocks there: the building blocks from the first Town Hall on, and decor and furniture since decision 0101. The pre-economy fixture files and closes a fountain with glass on a spot, and nothing kept a live build off them, so the live log may hold the same. Refusing those proposals at filing, or skipping their blocks at close, would replay the live world differently, and `REPLAY_VERSION` stays 1 ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)).

## Decision

- The rule starts at a logged switch. The server sends `keep_table_spots` from `TOWN_ACTOR` once the world counts days (`WorldService` option `tableSpots`, on in both adapters), setting `state.tableSpotsKept`, absent until then, with a public `table_spots_kept` event. `GET /v1/world` has `tableSpotsKept: true` from then on.
- After it, filing a `commons_build` (or a dry run of one) with a block of any kind on a spot is refused with `invalid_proposal`, naming the tile. At close, a block on a spot is skipped like a tile someone stands on, and `town_built` lists it under `skipped`, so a build filed before the switch and closed after it puts up everything else.
- Paths still go on the spots: they never block walking or tables. Taking away a block already on a spot is still allowed, so a later build can free one.
- The spots are `gameTableTiles`, which moved from `games.ts` to `world.ts` beside the Town Hall's and the shop's tiles, so `town.ts` reads them without importing the games.

## Why

- A logged switch is safe whatever the live log holds: every input before it checks and closes exactly as before. The other choice offered, keeping the old rule for the four building blocks and refusing only decor and furniture (which builds gained the same day), would have left wood, stone, glass, and leaf free to fill the spots, so it wouldn't keep them clear.
- Skipping at close, rather than letting builds filed before the switch place their blocks, keeps the promise from the moment it's logged. Skipping is how a close already treats a tile that changed since filing.

## Consequences

- Blocks that older builds put on spots stay until a build takes them away. The town can file one that does.
- From the switch on, where the spots are decides which logged blocks go in, so `gameTableTiles` is pinned for both the default world and the fixtures' world (`town.test.ts`). Moving a spot needs a new switch.
- The Propose sheet doesn't mark the spots yet: a build with a block on one is refused with the server's words, which name the tile. SKILL.md lists the default world's four.
- `packages/sim/src/fixtures/table-spots-log.ts` pins a log with a block put on a spot before the switch, a build filed before and closed after it, and a block taken off a spot, and every older fixture keeps its hash.
- Code: `checkKeepTableSpots`, `tableSpots`, `checkPlan`, and `closeBuild` in `packages/sim/src/town.ts`; `gameTableTiles` in `packages/sim/src/world.ts`; the `tableSpots` option in `packages/server/src/world-service.ts`; `tableSpotsKept` and `table_spots_kept` in `packages/protocol/src/schemas.ts`.
