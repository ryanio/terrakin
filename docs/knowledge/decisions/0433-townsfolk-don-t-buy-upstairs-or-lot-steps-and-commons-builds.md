---
title: Townsfolk don't buy upstairs or lot steps and Commons builds keep blocks out of the wild yard, behind close_rule_gaps
date: 2026-11-10
status: accepted
tags: [sim, economy, town-hall, townsfolk, rfc-0053]
---

# Townsfolk don't buy upstairs or lot steps and Commons builds keep blocks out of the wild yard, behind close_rule_gaps

## Context

[RFC 0053](../../rfcs/0053-two-rule-gaps-behind-one-switch.md) found two rules that let through what the rest of the sim keeps out. `add_floor` and `grow_lot` never asked whether the actor was townsfolk, so coins given to a townsfolk could be burned on an upstairs instead of going back to the treasury at `new_day`. And `checkPlan` never asked `inLot`, so after the regrid a passed `commons_build` could put blocks anywhere in the 192 tiles of the Commons' wild yard. Ryan answered the RFC's questions: blocks are refused in the yard and paths allowed, one switch covers both, what townsfolk already built stays, and staff adding an upstairs to a townsfolk home is out of scope.

## Decision

One logged switch, `close_rule_gaps` from `TOWN_ACTOR` through `oneTimeSwitch`, sets `state.ruleGapsClosed` and emits `rule_gaps_closed`. After it, `townCoinsProblem` in `packages/sim/src/economy.ts` refuses a townsfolk's `add_floor` and `grow_lot` with `not_eligible`, before anything about the plot, as the shop refuses them before anything about the sku. `checkPlan` in `packages/sim/src/town.ts` refuses a block outside the Commons' lot with `invalid_proposal`, and `closeBuild` skips one, so a build filed before the switch and passed after it lists the tile in `skipped`. Paths, removals and lifts in the yard are untouched. The server logs the switch once coins are open (`ruleGaps` in `WORLD_SWITCHES`), right after `plot_reach`. The check-in stops suggesting an upstairs to townsfolk, which needs no switch.

The own-key fixes the fuzz found (`set_townsfolk`, the owner-pair commands, and `join` with an id every object inherits, such as `__proto__` or `hasOwnProperty`) are not behind the switch. The server only ever sends minted ids (`r_` and hex) or configured townsfolk ids there, so no logged input can hold such an id, and refusing one changes no real log.

## Consequences

- Inputs before the switch replay as they were made; `REPLAY_VERSION` stays 2 and every existing fixture keeps its hash. `packages/sim/src/fixtures/rule-gaps-log.ts` pins both sides, and `packages/sim/src/rule-gaps.test.ts` the refusals.
- The fuzz's `KNOWN_FAILURES` is empty, and its hostile actors now include ids every object inherits.
- A townsfolk home's size and height change only through a staff decision of its own from now on. Opening the yard to blocks later, for a drawn square, takes a new switch.
