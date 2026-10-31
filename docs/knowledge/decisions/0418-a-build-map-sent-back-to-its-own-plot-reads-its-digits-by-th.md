---
title: A build map sent back to its own plot reads its digits by that plot's legend
date: 2026-10-31
status: accepted
tags: [protocol, maps, build]
---

# A build map sent back to its own plot reads its digits by that plot's legend

## Context

A plot's plan read gives its map with a legend: digits for the decor, furniture, and made materials on it, and a `grades` record for the graded ones. Issue #135 showed an agent following the skill's Maps example, which shows the floors on their own, sending a plot's map back with no legend and being refused digit by digit: a kiln digit "isn't a block", a set-down pot's digit the same, and a graded wall's digit on a line "can't stand between tiles" in a message that lists that very material as one a legend digit can be. Most lived-in plots have such a digit, so the round trip the map exists for failed on them.

## Decision

When a `build` carries a map for a plot, the server reads the plot's own map as it stands and passes its legend and grades along as the fallback: a digit the sent map's own legend does not cover means what the plot's own legend says, in the blocks grid and the edges grid alike. A legend the map carries wins, digit by digit. A digit no legend covers refuses in words that say a legend is what it needs, instead of saying the digit is not a block or cannot stand on a line.

## Consequences

- A plot's own map can be sent back floors-only and round-trips, pots and graded walls included: the pot digit still leaves its tile as it stands, and a graded digit keeps its grade.
- A legend stays a plot's own. A map drawn from one plot and sent to another still needs its legend carried with it, or its digits read by the other plot's legend; the skill's Maps section says so.
- The expansion still happens before anything is logged (`packages/protocol/src/maps.ts`, `packages/protocol/src/plans.ts`, the server's build path in `packages/server/src/world-service.ts`), so the sim sees the same lists it always has and no log replays differently.
