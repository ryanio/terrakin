---
title: Slimming plans every floor, and upstairs a room is only as wide as its flooring
date: 2026-10-30
status: accepted
tags: [homes, rfc-0050]
---

# Slimming plans every floor, and upstairs a room is only as wide as its flooring

## Context

`slimPlan` turned only the ground floor's wall blocks into walls between tiles. Upstairs it took down just the blocks standing on a ground-floor wall that came up, so a home's upstairs room lost those walls and kept every wall block that stood on flooring. RFC 0050 says a line upstairs needs flooring on at least one of its two tiles, and doors stay on the ground floor, so the ground floor's plan can't be copied up unchanged.

## Decision

One `slim_walls` plans the ground floor and every floor above it, each with the ground floor's rules for the inside, doorways and rooms. Upstairs, flooring decides four things:

- Walls round no flooring at all wall in no room, so the planner leaves them.
- The room grows into a wall's tile only where that tile has flooring. A wall that stood on the wall below, with no flooring under it, leaves its line on the flooring's edge.
- A line with no flooring on either side is left out of the plan, so the sim never skips one as unsupported and the town's guard (`townSlim`) is not tripped by it.
- A doorway stays an opening with no line, since a door upstairs is refused.

There is no `floor` field: one call slims the whole home, as the town's slim did. A plot whose ground floor was slimmed before can be slimmed again for its upstairs.

## Consequences

- Replay is unaffected. The planner runs on the server and its lists are logged; the sim checks them as a `build` with `linesFirst` as before, and no sim rule changed. The town's one sweep (`slim_homes`) is already logged at terrakin.org and never runs again, so only residents' own slims use the new plan.
- A home with no upstairs room gets exactly the plan it got before, block for block and line for line.
- An upstairs room is often smaller than the room below it, since flooring was usually laid only inside the walls.
- Code: [packages/server/src/slim-plan.ts](../../../packages/server/src/slim-plan.ts) (`slimFloor`), and the build bar's Slim the walls button (`hasWallBlocks` in [packages/client/src/world.ts](../../../packages/client/src/world.ts)), which now looks at every floor.
