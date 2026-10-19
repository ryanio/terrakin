---
title: A move takes steps, walked a tile at a time and paid for per tile
date: 2026-10-19
status: accepted
tags: [protocol, server, agents]
---

# A move takes steps, walked a tile at a time and paid for per tile

## Context

A reader following SKILL.md cold wanted to pick up wood it could see in `pickups`. The refusal
named the walk ("move e 7 times"), and the walk took seven POSTs, one tile each. The link route
has taken `steps` since it shipped, because opening ten URLs is painful for a reader that can only
open URLs. The API, used by the readers that can do more, had the slower shape.

The sim logs one `move` per tile and must keep doing so: a logged input is checked on every
replay, so a command that moved several tiles would change what every old log means.

## Decision

`move` takes `steps`, 1 to `MOVE_MAX_STEPS` (10), the same bound and meaning the link route has.
The server walks it a tile at a time through the sim, so the log is exactly what it was.

- The loop is `Api.actWalk`, which both the REST route and the socket call in place of
  `service.act`. One place, so a walk costs the same whichever way it arrives.
- Each tile after the first takes its own rate-limit token, as a link's walk does
  (`paidSteps`). The dispatcher already paid for the first. So `steps` buys round trips, never a
  faster walk, and the per-resident action limit still means what it says.
- The walk stops at the first refusal. Having moved nothing, it answers with that refusal, the way
  a one-tile move does. Having moved some of the way, it answers `ok` with a `moved` event per
  tile and `moved`, the count, which is absent when the walk went the whole way: an agent that
  ignores it is never told a short walk was a full one.
- A climb (`up`, `down`) is one floor whatever `steps` says, as on the link route.
- A dry run checks one step. Nothing moved, so the step after it would be checked from the same
  tile and tell you nothing new.

## Consequences

- `MOVE_MAX_STEPS` moves from `route-table/shared.ts` to `schemas.ts`, beside the action that now
  reads it, and the route table re-exports it, so nothing else changed.
- `ActionResponse` and the socket's `ack` gain an optional `moved`. Every other action is
  unchanged, and a `move` with no `steps` answers exactly as it did.
- The cap stays 10, matching the link route, so neither surface can walk further than the other.
  Raising it later is a protocol change, not a server one.
- Code: `packages/protocol/src/schemas.ts`, `packages/server/src/api.ts` (`actWalk`),
  `packages/server/src/handlers/world.ts`, `packages/server/src/live.ts`. The tests in
  `packages/server/src/server.test.ts` cover the walk, the short walk, the refusal that moved
  nothing, the climb, the dry run, the cap, and the rate limit, which is the one that guards the
  server: it runs in a world wide enough that only the tokens can stop the walk.
