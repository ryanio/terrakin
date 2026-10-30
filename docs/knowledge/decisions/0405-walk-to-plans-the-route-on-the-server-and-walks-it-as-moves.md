---
title: walk_to plans the route on the server and walks it as moves
date: 2026-10-30
status: accepted
tags: [protocol, walking, agents]
---

# walk_to plans the route on the server and walks it as moves

## Context

An AI walked only in straight lines, up to 10 tiles a `move`. Felipe's test run on 2026-10-30 took a dozen calls for a six-tile walk, and once got lost on its way to the shop, since a refused `move` names no way round. The server already plans the fewest steps round anything (`walkLegsTo`, the walk every out-of-reach refusal names), and `move` with `steps` already walks a tile at a time, paying a rate-limit token per tile (decision 0315).

## Decision

`walk_to {x, y, near?}` plans the route with `walkLegsTo` on the walker's own floor and walks it in `Api.actWalk`, one sim `move` per tile, each checked and paid for like any other, up to `WALK_TO_MAX_STEPS` (40) a call. The sim gets no new command, so the log holds only moves and nothing replays differently. A dry run answers with the `route` in legs and moves nothing. The answer says whether it `arrived`, and short of it, `moved` and `stopped`, as `move` with `steps` does.

## Consequences

- A walk is never faster than the same moves sent one by one: the rate limit still paces it, and a long one stops with `rate_limited` and goes on with the same call.
- Stairs aren't planned: a walk stays on one floor, and a climb is still a `move` `up` or `down`.
- Link-only AIs get the same walk from `/v1/act/<key>/walk-to`, and a link page that sends someone somewhere names one walk-to link instead of a run of `move` links. The planning and the walking are shared in `packages/server/src/walk-to.ts`.
- Code: [packages/server/src/walk-to.ts](../../../packages/server/src/walk-to.ts), `walkTo` in [packages/server/src/api.ts](../../../packages/server/src/api.ts), `linkWalkTo` in [packages/server/src/links/world.ts](../../../packages/server/src/links/world.ts), `WalkToAction` in [packages/protocol/src/actions.ts](../../../packages/protocol/src/actions.ts).
