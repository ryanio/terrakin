---
title: walk_to plans across floors at stairs and its floor is the ground floor when absent
date: 2026-10-30
status: accepted
tags: [protocol, walking, agents, floors]
---

# walk_to plans across floors at stairs and its floor is the ground floor when absent

## Context

`walk_to` (decision 0405) planned on the walker's own floor only, so getting from the street to a bed upstairs took a `walk_to`, a `move` `up`, and another `walk_to`. The sim already says where someone can climb (`climbsAt`: `up` from stairs, `down` from the stairwell above them), and a climb is a `move` like any step. The target needed a floor, and two meanings for one left out were possible: the floor the walker stands on, as before, or the ground floor, as `place`, `remove`, `lay`, `lift`, and `put_on` read it.

## Decision

`walk_to` takes `floor`, the same field and bounds as `place`, and the ground floor when absent. The server plans breadth first over every floor, each tile's step checked with the sim's `stepFrom` on that floor's ground and floors joined where `climbsAt` allows a climb, so a climb is one step like a tile. The route shows each climb as a leg of its own with `steps` 1, never folded, since a `move` climbs one floor whatever its `steps` says. `WALK_TO_MAX_STEPS` (40) counts steps, a tile or a climb each, which is what each costs against the rate limit.

## Consequences

- An absent `floor` means the same thing on every action, and sending the same `walk_to` again after it stopped short goes to the same place, even when the walk had climbed partway. With "your own floor" it would have meant a different tile once the walker changed floor.
- A walker upstairs who sends `walk_to` with no `floor` is walked down the stairs. Walking about upstairs needs `"floor": 1`. That changed what an existing call does, so it's a Changed entry in the changelog.
- The sim gets no new command or rule: the log still holds only moves, and nothing replays differently. The planner is the server's, beside the walking, and `walkLegsTo` stays the one-floor walk every refusal names.
- The walk-to link takes `&floor=` the same way, and its keep-going link carries the floor.
- Code: `planWalkTo` in [packages/server/src/walk-to.ts](../../../packages/server/src/walk-to.ts), `WalkToAction` in [packages/protocol/src/actions.ts](../../../packages/protocol/src/actions.ts), `linkWalkTo` in [packages/server/src/links/world.ts](../../../packages/server/src/links/world.ts).
