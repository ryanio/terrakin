---
title: Walls between tiles are keyed by a tile's north and west lines, walked by stepFrom, and a home's walls are slimmed by a server plan
date: 2026-10-30
status: accepted
tags: [sim, protocol, server, client, design, replay]
---

# Walls between tiles are keyed by a tile's north and west lines, walked by stepFrom, and a home's walls are slimmed by a server plan

## Context

Slice 2 of [RFC 0050](../../rfcs/0050-roomier-homes.md) puts walls, windows, hedges and doors on the lines between tiles, so a room keeps the floor its walls took. Building it settled five things the draft left open.

## Decision

1. Every line has one key: the tile it belongs to and `n` or `w` (`edgeKey`, `packages/sim/src/edges.ts`). An action may name any side; `s` and `e` become the neighbour's `n` and `w` before anything is checked, and events carry only that form. Edges live in `state.edges` and a floor's `edges`, absent until the first.
2. Walking stays one rule. `Ground` gains an optional `edge`, which `stepFrom` reads only when present: a straight step can't cross a line, and a diagonal needs both straight two-step routes clear, the same rule as a block's corner. A world with no edges builds no `edge`, so every logged walk replays the same.
3. A line counts as a wall at both of its tiles for what holds flooring up, for a roof (corner coordinates, `spanBoxes`, used only when a plot has edges), and for a hung thing. Taking one down gives back its cost and what hung on either face.
4. `build`'s lists are `edges` and `removeEdges`, not the draft's `walls`, because the API's `build` already has `walls` for a design's material. A border line, one across a way, or a door upstairs refuses the whole plan; a line with nothing under it is skipped.
5. `slim_walls` is planned by the server (`packages/server/src/slim-plan.ts`) and logged with its lists, checked as the resident's own build. The inside is what a walk from the plot's edge can't reach past walls; the walls touching it come up and each line between the room and the outside gets the kind that stood there. The first slim on a plot, ever, has the town pay for any made material its lines need past the blocks of that kind it gave back, at most a quarter of them (`state.slimmed`, kept on the world so releasing and settling again never earns it twice), which can never yield a material the home wasn't made of. A home with an upstairs is refused for now, since its walls may hold the floor above. `starter_edges` builds new huts from lines; no adapter logs it yet.

## Consequences

- Things hung on a wall block that a slim takes up go back to whoever hung them; the resident hangs them again on the new lines.
- Changing a line needs both its tiles on plots you build on, taking one down too, so a neighbour can't take down a border line after a plot changes hands. A plan reads its own lines when it checks what holds flooring up, lifting flooring under an upstairs line is refused, and a way never opens across a line.
- Exits (`openings.ts`) and the town's way planner read walls between tiles, and no way crosses one.
- The plot map's grid for lines, design notes that read lines, and the designs' roomy versions are [decision 0401](0401-a-plot-map-draws-walls-between-tiles-in-a-per-floor-edges-gr.md).
