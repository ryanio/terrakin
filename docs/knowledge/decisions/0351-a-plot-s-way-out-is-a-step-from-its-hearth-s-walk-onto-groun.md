---
title: A plot's way out is a step from its hearth's walk onto ground nobody has claimed, checked nightly and noted on builds, never refused
date: 2026-10-22
status: accepted
tags: [sim, building, walking, homes, ci]
---

# A plot's way out is a step from its hearth's walk onto ground nobody has claimed, checked nightly and noted on builds, never refused

## Context

The town has no streets. Plots are claimed side by side, so a plot whose neighbours are all claimed reaches the Commons only by walking across someone else's yard, and that neighbour can close the way at any time with a wall on their own land. Plot (6, 3) on terrakin.org is like this. We wanted "every claimed plot has an opening" to be a property we check, with no roads, no moved blocks and no refused builds.

Two definitions were on the table. One said an opening is a pair of adjacent walkable tiles, `a` on the plot's edge and `b` just outside it, anyone's. The other said the step out lands on a tile on no claimed plot. Under the first, every plot with a walkable neighbouring yard is open, so (6, 3) would pass, which is exactly the case the check exists to catch.

## Decision

A claimed plot has an **opening** when a walk on its own tiles, from a hearth on it (every open tile when it has none), reaches a tile on its edge from which one step lands on open ground: a tile nobody has claimed (the Commons, a town square, a free slot, a bridge) with nothing on it that stops a walker. The walk and the step are the sim's own `stepFrom`, so eight ways and never diagonally past a corner ([decision 0072](0072-walking-is-eight-ways-around-solid-buildings-paced-by-your-f.md)). Doors are open (`blocksWalkers`, [decision 0349](0349-a-door-is-a-free-ground-floor-block-walked-through-like-an-o.md)), and a lock, if one comes, never counts against an opening. The sea is an obstacle, so a world with a land open ([RFC 0038](../../rfcs/0038-new-lands.md)) needs nothing more: water is no way out, a bridge and a square are.

We picked the stricter definition because it is the only one that flags (6, 3). It has a consequence for the note about neighbours: a step out of a plot never lands on another claimed plot, so a build on one plot can take a neighbour's last opening only at a shared corner, where the neighbour's diagonal step onto open ground passes the corner tile of the plot being built. That is rare by construction, and it is real: building a wall along the edge of one plot can close the corner the plot beside it used.

It is `packages/sim/src/openings.ts`, read-only like the design notes: `openingsOf` and `landlockedFrom` work from `OpeningFacts` (the walking ground and which slots are claimed), so the server and a script holding only the world snapshot ask the same question. Three things read it:

1. A build's notes (`designNotes` with a plan, in `packages/sim/src/design.ts`): `no_opening` when the plan takes the plot's own last opening, and `seals_neighbor` for each plot around it whose last opening it takes. Only what the plan changes is said, so a plot already landlocked hears nothing about it on every build. A real build's notes read the world after the commit, where there is no before to compare, so these two come on the dry run, which is where a builder decides.
2. A design's or the starter hut's door (`doorFacing`, with the note written in `packages/server/src/door-notes.ts`): `door_no_edge` when the tile straight out from the door, past the plot's edge, is not open ground and some turn of the design would make it so, naming that `turn` (the starter hut is the hut design at turn 0, so its answer says to rebuild it as that design with the turn and `replace`). Nothing is said when no turn helps.
3. A nightly job (`scripts/landlocked.ts`, the `landlocked` job in `.github/workflows/nightly.yml`) reads the public `GET /v1/world`, which carries every fact the walk needs, so no new route and no staff key. It keeps one open issue labelled `landlocked-plots` listing each landlocked plot by coordinates and owner id, rewritten each night and closed by the first night with none. Each plot is `surrounded` (every tile around it is someone's plot, water, or the world's edge, so nothing its owner builds helps) or `walled` (open ground touches it, but its own blocks, or a neighbour's block or the water at a corner, keep every walk off it).

## Consequences

No rule reads any of it, so it changes no replay and `REPLAY_VERSION` stays where it is ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)). Nothing is refused and no block moves.

The first run against terrakin.org on 2026-10-22 found 18 of 51 claimed plots landlocked: 14 surrounded, (6, 3) among them, and 4 walled. Plot (5, 3), which looks open on the plot grid because it touches the Commons at its south-west corner, is walled: its own leaf and planter blocks cut that corner off from its hearth, and the stone at (40, 32) on (5, 4) stops the diagonal step past it.

The surrounded plots can only be fixed by something this decision rules out: a street, a neighbour giving up a strip, or a plot moving. That is a product question for later, and the issue is how we keep count. Claiming a plot can also close a neighbour's last opening onto a free slot; `settle` and `claim` say nothing about it yet.
