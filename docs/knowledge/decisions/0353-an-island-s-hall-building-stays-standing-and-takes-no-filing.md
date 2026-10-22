---
title: An island's hall building stays standing and takes no filings
date: 2026-10-22
status: accepted
tags: [world, lands, town-hall, sim, replay]
---

# An island's hall building stays standing and takes no filings

## Context

[Decision 0352](0352-an-island-s-presence-is-its-shop-counter-town-hall-filing-stays.md) took the hall half out of [decision 0332](0332-every-island-gets-a-counter-and-a-hall-door-of-its-own-on-a-.md): an island's presence is its shop counter, and Town Hall filing stays downtown. The code still sent a resident on an island to that island's own hall door (`nearestHall` in `packages/sim/src/doors.ts`), and every island square still lays out a hall building beside its counter. Issue #98 asked what that building becomes, with the logged `open_land` input and every fixture replaying as they do.

Three answers were open:

1. Keep the building as it stands, and have it serve no filing.
2. A counter-only square: the square keeps its counter and loses the hall's tiles.
3. A square laid out some other way without a hall.

No island has opened on the live log yet. Fixture logs do open one (`src/fixtures/lands-log.ts`, `src/fixtures/plot-market-log.ts`).

## Decision

The building stays, and takes no filings. Every resident files at downtown's hall on the Commons (`townHallTile` in `packages/sim/src/world.ts`), wherever they stand: on an island, on a bridge, or downtown. `nearestHall` is gone; `notAtTheHall` in `packages/sim/src/town.ts` and `you.hall` in `GET /v1/town` (`packages/server/src/town.ts`) both read the downtown door. Once a land is open, the refusal says "the Town Hall downtown" and names the walk over the bridge. Buying, selling and taking a pet out still go to the square of the land you stand on (`nearestCounter`, `nearestPark`).

Options 2 and 3 change no logged shape either, since the square in `open_land` still places the counter. They do change what the sim works out from it. Once `solid_buildings` is logged, the hall's tiles are solid, so they shape every walk across an island square, what `openings.ts` counts as a plot's way out, and what the client mirrors from `land_opened`. Taking them away is a geometry change across the sim, the server and both of the client's views. Keeping them changes nothing but where a proposal is filed. That is the narrowest change that does what 0352 asks, and every fixture hash stays the same.

## Consequences

`REPLAY_VERSION` does not move ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)). The only rule that changed is which door `propose` measures to, and no log holds a proposal filed on an island: no fixture logs `propose_in_person` with a land open, and the live world has opened no land.

The island's hall is a building you walk around and nothing more. `townHallTiles` and `hall` in `GET /v1/town` still list it, so the map draws it, and tapping it opens the Town Hall page, where `you.away` names the walk downtown. If that reads as a broken promise once islands have residents, the drawing is the client's to change, without touching a rule.

A per-island hall that files can come back, as 0352 allows, once an island has residents and a gathering need behind it. It would be one rule, behind a logged switch so proposals filed before it replay as they were made, and the building is already where it would need to be.
