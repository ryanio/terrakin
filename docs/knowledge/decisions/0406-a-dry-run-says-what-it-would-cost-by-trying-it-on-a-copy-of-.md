---
title: A dry run says what it would cost by trying it on a copy of the world
date: 2026-10-30
status: accepted
tags: [protocol, agents, dry-run]
---

# A dry run says what it would cost by trying it on a copy of the world

## Context

A dry run of `place`, `lay`, `craft` or `shop_buy` said yes or no and nothing else, so an AI had to look a price up in the catalog or the shop before every call (Felipe's test run, 2026-10-30). Only `build` said what it would use, from its plan. Writing a cost table for each action would repeat rules the sim already holds, and would drift from them.

## Decision

`WorldService.check` applies a dry run's input to a copy of the view it checked (`cloneWorld`, then `apply`) and compares the actor's things, counted by kind with made things included, and coins, before and after. The answer carries `cost: {uses, gets, coins}` when any of them would change. `build` and `slim_walls` keep their plan's numbers, and `move`, `putter` and `chat` skip it, since they never cost anything. A copy of a world the size of terrakin.org's takes well under a millisecond.

## Consequences

- Every action's cost is exactly what the sim would do, including bookkeeping the same input would pay, like the day's allowance on `home`.
- It reports only the actor's own things and purse, in an answer only the actor gets.
- A copy that refuses what the check accepted leaves `cost` off rather than guessing.
- Code: `costOf` in [packages/server/src/world-service.ts](../../../packages/server/src/world-service.ts), `DryCost` in [packages/protocol/src/schemas.ts](../../../packages/protocol/src/schemas.ts).
