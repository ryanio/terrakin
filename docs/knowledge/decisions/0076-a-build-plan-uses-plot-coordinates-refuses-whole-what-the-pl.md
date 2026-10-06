---
title: A build plan uses plot coordinates, refuses whole what the plan gets wrong, and skips what moves
date: 2026-10-06
status: accepted
tags: [sim, protocol, server, agents, security]
---

# A build plan uses plot coordinates, refuses whole what the plan gets wrong, and skips what moves

## Context

[RFC 0016](../../rfcs/0016-build-with-what-you-gather.md) adds `build`: blocks and ground placed (and taken away) on one plot in one input, from anywhere, so an agent can build a design in one call. A plan of up to a whole plot is checked against a world that keeps moving: people walk onto tiles, a co-owner builds, a crop grows in a planter the plan wanted gone. Every other action uses world tile coordinates. One build can change 256 tiles and broadcast an event for each.

## Decision

- Plans name a plot (`px`, `py`) and count tiles from its north-west corner (0 to `plotSize - 1`). A plan written for one plot builds the same thing on any other, so SKILL.md's example plans work as written for every agent, and `GET /v1/plots/{px}/{py}/plan` (`plotPlan`) reads any plot back as a plan to copy.
- What depends on the plan itself refuses the whole plan and builds nothing: a plot outside the world or not yours (`not_your_plot`, naming the plots you can build on), its shape (`invalid_plan`: empty, a list longer than a plot, a tile off the plot or twice in one list), a kind that doesn't exist, not enough materials for all of it (`not_enough_items`), or ending past the inventory cap.
- What depends on things that move is skipped and reported: a tile that's already exactly that (`same`), a different block or ground the plan didn't take away (`occupied`), anyone standing there or anyone's hearth (blocks only), nothing to take away (`empty`), a planter with a crop or a stand with a display in `remove`. A plan that would change nothing is refused (`already_set` when all of it is `same`, else `tile_occupied`), since a no-op still costs a log line.
- Order is fixed: removals, lifts, blocks, ground, each as sent. What removals and lifts give back pays for what the plan places, so a plan can move a table it doesn't hold.
- The events are the single actions' own (`block_removed`, `ground_lifted`, `block_placed`, `ground_laid`), then one `inventory` event with reason `built` and the net change. Old clients draw a build with what they already know.
- The sim's `planBuild` is the whole rule. `checkBuild` hands back the plan with the change that makes it, and `prepare` passes it on as `plan`, worked out with the actor as the commit finds them (back online, when acting brings them back). The server answers with that plan's summary (also on a dry run, which is how an agent prices a plan, and on the socket's `ack`), so the answer is the plan the sim commits, not a second pass over the world.
- The server allows one real build per resident every `BUILD_LIMITS.secondsBetween` (5) seconds, in memory, on top of the action rate limit. Dry runs don't count.

## Consequences

- Agents get one call per design, a price before they spend, and a list of what didn't happen instead of a refusal for each moved tile. Replacing what's there takes saying so (`remove` or `lift` on the tile), so a careless plan can't tear down a co-owner's work.
- A plan's coordinates differ from every other action's. The protocol caps them at 0 to 7 and the sim names the corner in its refusal, so a world-coordinate mistake fails loudly unless the plot is (0, 0).
- The spacing bounds a resident's broadcast to about 50 events a second, against thousands with the action rate limit alone. It resets on a restart, which only shortens one wait.
- Code: `packages/sim/src/build.ts` (`planBuild`, `checkBuild`, `commitBuild`, `buildSummary`, `plotPlan`), `Prepared.plan` in `packages/sim/src/apply.ts`, `WorldService.build` and `run` in `packages/server/src/world-service.ts`, `BuildAction` and `BuildPlanSummary` in `packages/protocol/src/schemas.ts`, `BUILD_LIMITS` in `packages/protocol/src/routes.ts`.
