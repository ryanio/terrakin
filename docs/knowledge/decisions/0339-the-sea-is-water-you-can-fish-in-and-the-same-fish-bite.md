---
title: The sea is water you can fish in, and the same fish bite
date: 2026-10-20
status: accepted
tags: [sim, fishing, lands]
---

# The sea is water you can fish in, and the same fish bite

## Context

[RFC 0038](../../rfcs/0038-new-lands.md) put water in the world: a tile in bounds that belongs to
no land and isn't a bridge is sea. Walking knows about it, `settle` refuses it, and nothing lies on
it to gather. Fishing didn't. `isWater` in [`packages/sim/src/fishing.ts`](../../../packages/sim/src/fishing.ts)
read one thing, a `pond` block, so a resident standing on a bridge with sea on both sides was
refused `no_water` and told to dig a pond out of their own stone. The RFC's own "Found while
building" section named it and left it, because nothing was urgent while no land is open.

It stops being not urgent the first day one opens. An island resident lives surrounded by water
they can't cast into, and the refusal tells them to build their own.

The open part was never whether the sea is water. It was whether the sea holds its own fish, and
that is a bigger question: `CATCHES` is keyed by season, time of day, and weather, never by where
the water is, and a new table is a new logged switch.

## Decision

The sea is water. `isWater` answers yes for a pond block or a sea tile, so a cast from a shore or a
bridge goes in, and `nearestWater` sends an inland angler to the shore rather than telling them to
dig. The refusal names what it found, a pond or open water, and keeps the walk that reaches it.

The same fish bite. No new table, no switch, no sea-only kinds. The catch tables stay keyed by
season, time and weather.

Nothing about the economy moves with it. A pond costs `POND.stone` (2), gathered free, so it was
never the gate on fishing; `FISHING.castsPerDay` is, and that is per resident, not per pond.

## Consequences

Replay is untouched. In a world that never logged an `open_land` there is no sea, so `isWater`
answers exactly as it always did and every logged cast replays as it was made. `REPLAY_VERSION`
doesn't move, for the same reason `pickupOn` leaving sea tiles bare didn't move it: no log holds an
`open_land`. All 53 sim suites, fixture hashes included, pass unchanged.

`isWater` now reads the lands as well as the blocks, so it takes
`Pick<WorldState, "blocks" | "config" | "lands">` (`WaterFacts`) rather than the blocks alone, and
`isSea` takes the two facts it reads rather than the whole world. The web asks the same question
through the mirror's own `isSea`, so the Fish button shows on a shore.

Still open, and deliberately not decided here: whether the sea gets fish of its own. Saltwater
kinds, a different table by distance from land, or a catch that only bites off a bridge are all
possible later, each behind a logged switch and a table of its own. This decision only stops the
world telling an islander to dig a pond in the ocean.
