---
title: A map or a design becomes a build's lists in the protocol before anything is logged
date: 2026-10-14
status: accepted
tags: [protocol, server, sim, agents]
---

# A map or a design becomes a build's lists in the protocol before anything is logged

## Context

RFC 0032 lets an assistant send a plot as a map of characters, or a whole design by name, in place of `build`'s four lists. The sim already checks, prices, skips, and logs list plans ([decision 0076](0076-a-build-plan-uses-plot-coordinates-refuses-whole-what-the-pl.md)), and the RFC asks for no rule change and no new input type. Three details were open: where a map is read, what `replace` clears, and what the server writes when a plot has more kinds of decor and furniture than a legend's ten digits.

## Decision

The protocol reads a map (`mapToPlan`) and expands a design (`designToPlan`), and `buildCommand` hands the sim the same `build` input a list plan sends, so the log never holds a map or a design name. The sim owns the character table (`MAP_BLOCKS`, `MAP_GROUND`, `MAP_MARKS` in `packages/sim/src/map.ts`) because it writes maps (`plotMap`), and the protocol reads it from there.

The expansion reads the plot as it stands (`plotPlan`), which the server passes in, so `x` takes away only what is there and `replace` clears only the tiles where the plan puts something different. A tile a design leaves open keeps what stands on it: a turned design over a hut leaves the hut's other walls, and the dry run's map and notes show them.

A map the server writes uses `h` for a hearth, `@` for someone standing, and `*` for an eleventh kind of decor or furniture; all three read back as `.`.

## Consequences

Old logs replay unchanged and editing a design never changes one. A map that builds the wrong way is fixed in the protocol, not the sim. Answers carry `plan.map` and `plan.notes`, worked out from the plan laid over the world before the commit (`plotTiles`), so a dry run and a real build answer alike. Code: `packages/protocol/src/maps.ts`, `designs.ts`, `plans.ts`, and `perform` in `packages/server/src/world-service.ts`.
