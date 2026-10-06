---
title: Gather with no tile picks up everything within reach, north to south, as far as there is room
date: 2026-10-06
status: accepted
tags: [sim, protocol, server, client, agents, replay]
---

# Gather with no tile picks up everything within reach, north to south, as far as there is room

## Context

Each `gather` named one tile ([decision 0063](0063-simple-gathering-is-in-phase-1-wood-and-stone-picku.md)), so the wood for a reading nook took about 25 calls: an AI playtest found it the least fun part of building, and on a phone it was a tap per branch. Ryan asked for gathering everything within reach in one call. The live log holds single-tile gathers that must replay as they were made, with `REPLAY_VERSION` still 1 ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)).

## Decision

- `gather` with neither `x` nor `y` picks up every pickup within `config.reach` that the gatherer may take (`mayGatherOn`, so a claimed plot's pickups stay its owners' once `own_plot_pickups` is logged), finds included. A tile with only one of the two is refused, by the protocol's schema and again by the sim.
- The order is fixed: north to south, then west to east, over the square within reach (`pickupsInReach` in `packages/sim/src/gather.ts`). When the gatherer's things can't hold them all, it takes as many as fit in that order and leaves the rest lying where they are. With no room at all, it's `inventory_full`.
- Its events are one `gathered` for each tile, in that order, then one private `inventory` (reason `gather`) with one change per kind, the kinds in the order they first came up. A single-tile gather's events are unchanged.
- With nothing within reach the gatherer may take, it's `nothing_to_gather`, saying whether what lies there is on someone else's plot, and naming the nearest pickup they may take (`nearestOpenPickup`) with the walk there (decision 0044).
- The same rule, by the sim's own `pickupsInReach`, decides when the map shows a Gather all button, and the link `/v1/act/<key>/gather` sends it for link-only residents, answering a refusal with `move` links to the nearest pickup.

## Why

- Making `x` and `y` optional on the action agents already know is one line in SKILL.md and adds nothing to the protocol to learn. A new action type would mean two ways to say "pick up".
- A fixed reading order is the simplest rule to state and to check, and it only matters when things are nearly full. Nearest first or rarest first would read better in that one case and are harder to explain.
- One `inventory` event with a total per kind is what a client draws and what the collection book reads; one change per tile would repeat the same kind with counts climbing by one.
- The walk to the nearest pickup turns a refusal into the next call, as every other gather refusal does.

## Consequences

- Old logs replay unchanged. The API always required both coordinates, so every logged gather names a tile, and the single-tile path checks and commits exactly as before. `packages/sim/src/fixtures/gather-all-log.ts` pins a log with gathers of everything within reach on both sides of `own_plot_pickups`, and every older fixture keeps its hash.
- Gathering is cheaper in calls, not in walking: a resident still has to stand near what they pick up, one pickup per tile a day, and the action rate limit counts the call once. Nothing here moves coins.
- An agent that races for rare finds gains nothing from it it couldn't do before with one call per tile.
- Code: `pickupsInReach`, `nearestOpenPickup`, and `checkGatherAll` in `packages/sim/src/gather.ts`; `GatherAction` in `packages/protocol/src/schemas.ts`; `linkGather` in `packages/server/src/links.ts`; the Gather all button (`#world-gather`) in `packages/client/src/world.ts`.
