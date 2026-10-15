---
title: Design notes read the ground floor from the plot's edge and call a plot crowded past half
date: 2026-10-14
status: accepted
tags: [sim, agents]
---

# Design notes read the ground floor from the plot's edge and call a plot crowded past half

## Context

RFC 0032 names six notes and leaves their exact rules, and the `crowded` line, to a measurement of the live world. On terrakin.org at `seq` 17058 there were 27 built plots that aren't the townsfolk's: 8 had blocks on more than half their tiles, 4 on more than 60%, and 9 on more than 40%. A first version of `no_path` fired on homes that had laid exactly the path SKILL.md suggests, which starts one tile past the hut's doorway.

## Decision

`designNotes` reads the ground floor. A tile can be walked to when the sim's own step rule (`stepFrom` over `groundOf`) reaches it from an open tile on the plot's edge, keeping to the plot. A station counts as reachable when a walkable tile on the plot is within `config.reach` of it, and a pond when one is beside it, as fishing needs. A tile on a neighbor's plot or the Commons doesn't count, though someone could stand there: a home's own plot should reach what's on it. A `hearth_walled_in` note names a wall (wood, stone, leaf, or glass) whose removal opens the way, one with a path beside it first. `no_path` fires when a built plot has no path or flooring at all, or when no walk over path and flooring leads from a hearth to the edge, with the tiles beside the hearth and any doorway (an open tile between two walls) needing none. `crowded` fires above half the plot (`DESIGN.crowded`), and `many_materials` at three of wood, stone, and leaf.

## Consequences

On that read of the live world: 21 plots get `no_path` (most have no path at all), 8 `crowded`, 2 `hearth_walled_in`, and 1 each `walled_in`, `out_of_reach`, and `many_materials`. SKILL.md's guide says to leave half the plot open, matching the note. Upstairs gets no notes yet; a loft nobody can reach is a later note. Code: `packages/sim/src/design.ts`.
