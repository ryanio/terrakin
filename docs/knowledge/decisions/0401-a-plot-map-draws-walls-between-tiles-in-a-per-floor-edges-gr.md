---
title: A plot map draws walls between tiles in a per-floor edges grid, and each design's roomy version is built with roomy: true
date: 2026-10-30
status: accepted
tags: [protocol, sim, server, design]
---

# A plot map draws walls between tiles in a per-floor edges grid, and each design's roomy version is built with roomy: true

## Context

[Decision 0396](0396-walls-between-tiles-are-keyed-by-a-tile-s-north-and-west-lin.md) left three parts of [RFC 0050](../../rfcs/0050-roomier-homes.md) for later: the plot map's grid for lines, design notes that read lines, and the nine designs' edge versions. The RFC named the build field `edgesMap` beside `map`, and said the designs' edge versions are "offered once `starter_edges` is on". Building them settled where the grid goes, what a line character means on the way in, and how an agent asks for the roomy version.

## Decision

1. The grid is `edges` on each floor of a map, beside `blocks` and `ground`, not a separate `edgesMap` field. A map read from a plot goes back into `build` unchanged, and the top-level `edges` list keeps its name. It is written only on a floor with a wall on one of the plot's lines (the borders included), so a plot without lines reads exactly as it did.
2. On the way in, a line reads like a tile in the blocks grid: a letter or a legend digit puts a wall there, `D` a door, `x` takes the wall down, and a space or `.` leaves the line as it is. `replace` takes down a different wall first. Corners and tile positions are never read. A line on the plot's south or east border becomes an `s` or `e` line of the last row or column. `GET /v1/plots/{px}/{py}/plan` adds the same lines as an `edges` list, present only when the plot has some.
3. Design notes walk with the lines, through the same `stepFrom`. A plot-edge tile is a way in only when a side facing off the plot has no wall, `hearth_walled_in` can name a line to swap for a door, and `many_materials` counts walls on lines. The web's build bar reads the mirror's lines for the same notes.
4. A design's roomy version is derived from its map (`roomyGrids` in `packages/protocol/src/designs.ts`), not drawn by hand: the walls come off their tiles and stand on the lines round the box they formed, each line taking the kind of the wall tile it runs along. A side on the plot's border moves one tile in. The hut's roomy version is the starter hut of lines.
5. The roomy version is opt-in: `GET /v1/designs` adds `roomy` to each design only once the world has logged `starter_edges`, and `build` builds it with `"roomy": true`, refused (`invalid_plan`) before then. `design` alone still builds the wall-block version everywhere, so the web's design picker and every existing caller build what they did. This is the simpler of the two readings of "offered": swapping what `design` builds would have needed the picker to draw lines first.

## Consequences

- A world without `starter_edges` lists designs byte for byte as before (`build.test.ts` and `maps.test.ts` pin it). terrakin.org doesn't log the switch, so nothing there changes until it does.
- `maps.test.ts` builds every design's roomy version in every material and turn with nothing skipped and no notes, so a new design must have a roomy version that builds whole too.
- The web's design picker still offers only the wall-block versions. Offering the roomy ones there needs the thumbnail to draw lines.
