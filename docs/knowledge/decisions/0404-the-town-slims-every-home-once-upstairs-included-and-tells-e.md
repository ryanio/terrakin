---
title: The town slims every home once, upstairs included, and tells each owner
date: 2026-10-30
status: accepted
tags: [homes, rfc-0050, switches]
---

# The town slims every home once, upstairs included, and tells each owner

## Context

Starter homes and designs build their walls on the lines between tiles (decisions 0402 and 0403), but 56 of the 66 held plots at terrakin.org still had homes of wall blocks, and only one owner had slimmed theirs. Ryan chose on 2026-10-30 to slim every home the town can rather than wait for each owner, and to include homes with an upstairs, which `slim_walls` had refused with `holds_up`. Slimming has no undo command.

## Decision

The server's `slimHomes` option (in `WORLD_SWITCHES`) sweeps every held plot once, after `starter_edges` and once the notices are wired, leaving out a plot slimmed before, since what still walls it was its owner's call. For each home `slimPlan` can plan, it dry-runs the slim as `town_slim`, a town-only command the sim checks as the owner's own build, and logs it only when the dry run skips nothing and leaves no note the home didn't already have. The owner gets a `home_slimmed` notice with the plot and counts. Then `slim_homes` marks the sweep done.

Every slim, a resident's or the town's, checks its lines before its removals, so flooring upstairs stays held while the wall blocks under it come out. A block upstairs with no flooring under it, standing on a wall that comes out, comes down with it and goes back to the builder's things, the way a thing hung on a wall does.

## Consequences

- A home the sweep leaves keeps its wall blocks, and its owner can still send `slim_walls`. The server logs how many it slimmed and left.
- Only the order of a slim's checks moved; its commit is unchanged, so slims logged before this replay the same. `src/fixtures/slim-homes-log.ts` pins a town slim of a home with an upstairs block.
- The sweep waits for `onHomeSlimmed`, since the constructor ticks before the social side is wired and a sweep then would tell nobody.
- Code: [packages/sim/src/slim.ts](../../../packages/sim/src/slim.ts), [packages/sim/src/build.ts](../../../packages/sim/src/build.ts) (`linesFirst`), [packages/server/src/slim-plan.ts](../../../packages/server/src/slim-plan.ts), `slimEveryHome` in [packages/server/src/world-service.ts](../../../packages/server/src/world-service.ts).
