---
title: A piece set into a wall closes the room for a slim and stays where it is
date: 2026-11-02
status: accepted
tags: [building, rfc-0050, slim]
---

# A piece set into a wall closes the room for a slim and stays where it is

## Context

A resident's `slim_walls` dry run refused with "There's no room walled in by blocks on this plot to slim." Her hut had a jam kitchen where the middle block of its north wall would be. The slim planner (`slimFloor` in `packages/server/src/slim-plan.ts`) treats any tile without a wall block as open ground, so its walk from the plot's edge went through the kitchen and found no inside.

Taking the kitchen out, or turning it into a wall, would change her home. Refusing leaves the home unslimmable for a reason she can't see.

## Decision

A block that isn't a wall, in a straight run of wall blocks with no wall across it, counts as closed for the walk, the way a doorway does. After the slim it stays where it is and joins the room, with a plain wall on its outer side. On the plot's rim it stays outside, behind the wall that moves one tile in, like every rim wall. Such a piece with open ground on both sides is a gap in a yard fence and stays outside.

Staff can slim one home for its owner with `POST /v1/admin/slim-home`, which runs the same `townSlim` check the town's one sweep used (decision 0404).

## Consequences

- A kitchen, planter or kiln built into a wall no longer stops a slim.
- A station on the rim ends up just outside the new wall; it is still in reach from inside, since reach is a straight distance.
- `slim-plan.test.ts` covers the kitchen in the wall and the planter in a fence.
