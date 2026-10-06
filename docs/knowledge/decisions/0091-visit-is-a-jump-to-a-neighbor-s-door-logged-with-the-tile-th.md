---
title: Visit is a jump to a neighbor's door, logged with the tile the server picked
date: 2026-10-06
status: accepted
tags: [sim, protocol, server, agents, replay]
---

# Visit is a jump to a neighbor's door, logged with the tile the server picked

## Context

[RFC 0020](../../rfcs/0020-plots-worth-visiting.md) makes visiting a neighbor's plot one call. Walking there is a rate-limited request per tile, the cost decision 0009 removed for going home and decision 0016 for settling. A visitor should arrive where a guest would: at the edge of the plot, in front of its door, never on a hearth or in the middle of someone's home. Residents build any shape they like, so the door has to be found from the blocks, and the way it's found will change (RFC 0016 adds paths). A rule the sim runs on replay is frozen once a logged input depends on it.

## Decision

- `visit {px, py}` is a sim command. Where a resident stands is world state that rules read (reach, who stands where, landing tiles), so a jump is an input the sim checks and the log keeps.
- The landing tile is `visitTile` in `sim/src/visit.ts`. Of the plot's free tiles (no block, nobody's hearth, no other online resident), the outermost ring first; then a tile on a path (RFC 0016's dirt, cobblestones, stepping stones, brick, or planks, not flower beds, rugs, or leaves), so a path laid to the door is the way in; then the shortest walk, as `move` walks and staying on the plot, to the plot's heart (its owner's hearth there, else the first co-owner's, else its center); then the nearest to the heart in a straight line; then north to south, west to east. For a starter hut that is the edge tile in front of its doorway.
- The server calls `visitTile` on `asJoined` (the world with the visitor back, as putter plans) and logs `{"type": "visit", "px", "py", "x", "y"}`. The sim checks the logged tile against the world (on the plot, walkable, nobody's hearth, nobody standing there) and never runs the planner. The action schema has no `x` or `y`, so a resident can't pick one.
- Refusals: `out_of_bounds`; `plot_is_commons`; `plot_unclaimed` (new), naming the nearest plot someone lives on and, for a resident with no plot, `settle`; `own_plot` (new) for a plot you own or share, naming `home`; `already_there` (new); and `nowhere_to_go` when no tile is free, which is also what a logged visit without a tile gets. Before the sim, the server refuses `forbidden` when the visitor and the plot's owner or any co-owner blocked each other, either way, and while the owner is suspended (the plot is closed for now, like their stall). For `plot_unclaimed` the server rewrites the hint with the sim's `unclaimedMessage`, leaving out plots it would refuse, so the hint names a plot the visitor can visit.
- No rate limit beyond the action limit, like `home`. A visit never lands on a hearth, so it never collects the allowance or the pantry.

## Why

- Logging the outcome follows putter ([decision 0049](0049-putter-is-a-planned-short-walk-logged-as-its-steps-with-a-on.md)): a better planner changes where later visits land and never how a logged one replays. Running the rule in the sim, as `settle` does for its landing tile, would need a logged switch for every improvement.
- The ring, then the walk, finds the way in for any building without a notion of a door.
- Blocking someone never closes the map to them, but it should stop a one-call jump to their doorstep, so a visit checks for a block with every resident of the plot.

## Consequences

- Old logs replay unchanged: every older sim refused `visit`, and refused inputs aren't logged. `REPLAY_VERSION` stays 1. `sim/src/fixtures/visit-log.ts` pins a log of visits by residents the visit itself brought back online.
- `visitTile` may change freely; its tests (`sim/src/visit.test.ts`) say what it does now. `checkVisit` is the replay contract.
- Clients already treat `moved` as a possible jump (decision 0009). A visit is one `moved` event.
- Code: `sim/src/visit.ts`, the `visit` case in `sim/src/apply.ts`, and `WorldService.visit` in `server/src/world-service.ts`.
