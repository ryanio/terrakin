---
title: The way planner takes down a wall on a line between two way tiles, priced as a wall block
date: 2026-10-30
status: accepted
tags: [server, ways, rfc-0050]
---

# The way planner takes down a wall on a line between two way tiles, priced as a wall block

## Context

Homes are built from walls on the lines between tiles now (RFC 0050, [decision 0402](0402-starter-homes-are-built-from-walls-between-tiles-in-every-wo.md)). The way planner (`planWays` in `packages/server/src/way-plan.ts`) treated such a line as something no step could cross, so a plot reached only through a garden fence on a line stayed unjoined, though the same fence as blocks would have been cleared. It also read lines through the walking ground, which lets a walker through a door, while the sim's `open_way` refuses a way with any line between two of its tiles, a door included. A plan through a door on a line could never be laid.

## Decision

A step across a line is a price, as a block on a tile is: `WAY_COST.line`, 13, what a wall block elsewhere on a plot costs on top of its tile (`block` plus a quarter of `wall`). The planner reads every ground-floor line (`WayFacts.lines`, doors too), and its plan lists in `lines` each one standing between two tiles of the way where at least one is new, crossed by the search or not. `wayInputs` takes each down with `clear_block` and its side, after the blocks and before `open_way`, so it goes back to the plot's owner as the owner's own `remove` would give it. A wall on a line that may hold up an upstairs (a holding kind on a plot with a floor above) is never crossed, matching the rule for blocks. The owner's `way_laid` notice lists a line among `blocks` with its `side`.

## Consequences

- A plot only beyond a fence or a wall on a line can be joined, and no plan runs into `open_way`'s refusal of a door on a line.
- A line the search did not cross but that ends up between two way tiles is taken down too. The search doesn't price it, so a plan may take down a little more than the cheapest one would; the dry run lists every line.
- Homes the way cuts through are still rebuilt with blocks one tile in, and a line taken down counts toward the rebuild's material.
- `scripts/ways.ts` reads the snapshot's `edges` itself, since the sim's `openingFactsFrom` leaves lines out. `scripts/landlocked.ts` reads that function too, so it still walks past lines.
