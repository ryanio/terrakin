---
title: A piece of furniture's turn lives in the world, drawing only, absent for south
date: 2026-11-07
status: accepted
tags: [sim, protocol, client, design]
---

# A piece of furniture's turn lives in the world, drawing only, absent for south

## Context

Every piece of furniture faced south, so a sofa could never face a fireplace across a room and a bed always had its head to the north. Residents asked to turn pieces in their homes. A turn changes nothing a rule reads, which is the case [decision 0067](0067-facing-and-motion-are-drawing-only-kept-out-of-the-sim-and-the-l.md) keeps out of the sim for a resident's facing. But a resident's facing is a moment, and a room's layout is something its owner made: it has to survive a restart, show the same to every visitor, and go into a plot's history like the piece itself.

## Decision

- A turn is a property of a placed piece, never a kind: `turns` on the ground floor and each floor (`WorldState.turns`, `FloorLayer.turns`), keyed by `tileKey`, 90, 180 or 270 degrees clockwise from facing south, as a design turns. Facing south is never stored, so a world with no turned pieces hashes as before and no old log replays differently.
- `place` takes an optional `turn`, and a new `turn` command turns a piece within reach, with `place`'s where-rules. Only furniture turns, and not the low stone wall, which joins its neighbors (`isTurnable` in `packages/sim/src/turns.ts`). Whatever puts a block down or takes one up writes its key in the same commit (`setTurn`), as grades do.
- No rule reads a turn: walking, resting, surfaces, costs and counts read the kind. 3D draws the turn and seats a resting figure facing out of it; the map can only mirror a front or side-on picture, so it mirrors a piece facing west and draws the rest as they were.
- The build bar shows a facing picker after a picked piece that turns. A new piece goes down facing the picked way, and a tap on a piece of the picked kind facing another way turns it rather than taking it up.

## Consequences

- No switch: a new command and a field absent until used change nothing an old log did. `src/fixtures/turns-log.ts` pins a log that turns, places turned, turns back and takes up.
- A plot's plan (`GET /v1/plots/{px}/{py}/plan`) and `build` don't carry turns yet, so a copied room comes out facing south.
- The plot photo and link cards draw from above and ignore turns.
