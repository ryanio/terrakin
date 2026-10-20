---
title: An island is a region of the same plane, and water is what is left
date: 2026-10-20
status: accepted
tags: [world, sim, lands]
---

# An island is a region of the same plane, and water is what is left

## Context

[RFC 0038](../../rfcs/0038-new-lands.md) grows the world when downtown fills. 48 of 81 plots were
claimed on 2026-10-20, so the question was close enough to answer rather than guess at.

The RFC settled the shape: one coordinate plane, the world growing east, tiles keeping the
coordinates they had. What it left open was how water and the land's own geometry get into the
world, and that is where a wrong choice would have been expensive.

## Decision

**Everything geometric arrives in the logged `open_land`**: the world's new `width` and `height`,
the plot slots the land makes claimable, and the walkable tiles that bridge the water. The rules
never work any of it out for themselves. So the same log always builds the same world, and a better
server-side planner can never change how a logged input replays, which is the same reason `visit`
logs the tile it lands on rather than planning at replay (decision 0091).

**Water is what is left, not what is stored.** A tile in bounds that belongs to no land's plots and
is not a bridge tile is sea. `groundOf` reports it as the `sea` obstacle, so `move`, `walkTree`,
`route`, `putter` and the routines all refuse it with no change of their own, and `settle` refuses a
slot in it. The alternative was 576 `pond` blocks for one 8 by 72 channel, which would have put a
channel's worth of state in the world and in every snapshot, for a thing that is simply the absence
of land.

**`state.lands.home` is the rectangle the world had before the first land opened.** Downtown needs
no slot list, so the claimable rule is "inside home, or in some land's slots". The alternative was
to hard-code downtown's 9 by 9, which would have been wrong for every self-hosted world of another
size.

**No new error code.** Settling on water answers `out_of_bounds` with its own words. The internal
`SettleProblem` keeps `plot_is_water` so the message can be specific, but an agent's next move is
the same either way, which is the bar for a code of its own.

## Consequences

Before the first `open_land` there is no sea, because every tile in bounds is downtown, so every
older log walks and settles exactly as it did and `REPLAY_VERSION` does not move.
`src/fixtures/lands-log.ts` pins a log that opens a land, settles across the water, and walks the
bridge a tile at a time, and the replay test checks it at every split point.

`config.width` and `config.height` now change during a world's life, which they never did. Anything
that cached them would be wrong; nothing does today, because every rule reads `state.config` each
time.

The client's `groundOf` takes `sea` as an optional fact, so the web is unchanged until it passes
one. A client that never hears of lands draws the tiles in the snapshot and would let someone try
to walk onto water, which the server then refuses; that is why the snapshot's `lands` and the map
come before any adapter opens a land.

What this does not settle: the counter and hall each island gets
([RFC 0038](../../rfcs/0038-new-lands.md)'s decision of 2026-10-20, still to build), when the server
opens the next land, and the plot picker's order. Nothing here commits us on any of them.
