---
title: Building reaches the whole plot and walls go only on lines, from two logged switches
date: 2026-11-09
status: accepted
tags: [sim, protocol, building, rfc-0050, switches]
---

# Building reaches the whole plot and walls go only on lines, from two logged switches

## Context

Ryan built on his phone and found it frustrating. Reach was 3 tiles from where you stand, so an 8 by 8 plot needed walking about while building, and a tap out of reach was refused. Walls came in two shapes: a block filling a tile, and a wall on the line between two tiles (RFC 0050). The build bar defaulted to blocks, so a tap meant to take down a wall on a line put a wall block on that tile instead. He asked for reach that doesn't need standing close and for wall blocks to go away entirely.

Both are rule changes in a live world, so each needs a logged switch: refusals logged before it must replay as refusals, and wall blocks placed before it must replay as placed.

## Decision

1. `plot_reach` (state `plotReach`, event `plot_reach_set`, `plotReach` on `GET /v1/world`): a building action on a tile reaches it when you stand on the plot that tile is on, or within `config.reach` tiles of that plot's nearest tile (`plotReachOk` in `packages/sim/src/plot-building.ts`). It covers what `outOfBuildReach` covers: `place`, `remove`, `lay`, `lift`, `turn`, `set_hearth`, `put_on`, `take_off`, `hang`, `unhang`. Who may build there, the floor rule, and every other check are unchanged. Growing, making, gathering, displays and teaching keep reach from the tile.
2. `walls_on_lines` (state `wallsOnLines`, event `walls_on_lines_set`, `wallsOnLines` on `GET /v1/world`): a wall, window, hedge or door (`isEdgeKind`) sent to `place` without a `side`, in a plan's `blocks`, or in a Town Hall build is refused with the new `needs_side`. A wall block from before can still come down. A Town Hall build puts up no walls after it, since it has no list of lines.
3. Both are on in every world (`WORLD_SWITCHES`). The server logs `walls_on_lines` only after the town has turned the wall blocks standing into lines.

## Consequences

- One rule for a plot: standing at your hearth you reach every corner, and the web can frame the plot while you build instead of following your figure.
- The plot rectangle is the plot slot the tile is on. Two touching plots of one household are two plots: standing on one reaches the other only within `config.reach` of it.
- `reach.test.ts` still sends each command from behind the starter hut without the switch; `plot-building.test.ts` and `src/fixtures/plot-building-log.ts` pin both switches.
- Old logs keep their wall blocks, so the sim and the renderers keep reading and drawing them. Removing that code would need every live wall block gone and a `REPLAY_VERSION` bump with an RFC.
