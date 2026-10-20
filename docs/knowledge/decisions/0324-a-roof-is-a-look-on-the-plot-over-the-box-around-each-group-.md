---
title: A roof is a look on the plot, over the box around each group of walls
date: 2026-10-20
status: accepted
tags: [sim, protocol, client, design]
---

# A roof is a look on the plot, over the box around each group of walls

## Context

An upstairs costs 200 coins, about nine days of saving, and could not be seen. Homes had no roofs
at all, so from above you looked straight into every room of every home, and a resident who paid
for the most expensive thing in the game had a plot that read from the street exactly like the
bungalow next door. [RFC 0028](../../rfcs/0028-homes-with-storeys.md) parked the fix in its own
Alternatives: "a roof can be a later look on the top storey, and the cutaway works without it."

[RFC 0041](../../rfcs/0041-materials-and-roofs.md) picked it up and settled the shape: one field,
not twenty-five placed blocks. Building it forced four choices the RFC left open or left to the
reader.

## Decision

**A field on the plot, drawn from the walls, never stored.** `plot.roof` is a style and a covering,
and that is all the world keeps. What a roof covers is worked out when it is drawn
(`roofShape` in `packages/sim/src/roofs.ts`), so taking a wall down never has to be checked against
a roof, a plan can rebuild a home under one, and there is nothing to migrate when the drawing
changes. The alternative, storing the covered tiles, would have made every `place` and `remove` on
the plot a roof update and given `release` another thing to refuse.

**The footprint is the box around each group of touching walls, at least 3 tiles across each way.**
Three readings were tried. A flood fill from outside is defeated by a doorway: the starter hut's
one-tile door lets the fill into the interior, so the hut encloses nothing. A ray test (a wall
north, south, east and west) is defeated by the same door for the whole column it stands in. Both
also break on `hill_house`, whose design has a two-tile doorway. The box around a wall group gets
every one of the nine designs and the starter hut exactly right, has no opinion about doorways, and
roofs two separate sheds as two roofs. What it gets wrong is an L-shaped home, whose roof reaches
over the notch, and a decorative wall stuck to a house, which stretches the roof to reach it. Both
are visible at a glance and come off with one tap, which is the trade a look can make and a build
cannot.

**The roof sits on the highest floor the walls reach, not on the floor the plot paid for.** Reading
`plot.floors` would have meant that adding an upstairs and building nothing up there took the roof
away, or refused one, which punishes the purchase the roof exists to celebrate. Walling the loft in
lifts the roof to it.

**Anyone with walls may roof, with or without an upstairs** (RFC 0041's open question 3). Saying no
would have made the roof the reward for 200 coins. It was rejected because the thing a roof fixes
is true of every home, not of two-floor homes: without one, every house on the grid is an open
floor plan. Gating it would leave the town roofless and put a dead upsell button on nearly every
plot. What the 200 coins buys is height, and a roof is what makes height read as a home rather than
as a stack of rooms. A roof costs its covering either way, and a brickwork roof over two floors is
a different thing from a leaf one over a hut.

## Consequences

Cheap, and reversible: `ROOFS.blocks` is 8 of the covering whatever the home's size, taken when the
roof goes up and given back when it changes, so trying a style costs nothing in a free block and a
made material costs what it took to make. A leaf roof is thatch and a glass one is a conservatory,
which fell out of using `blockNeeds` rather than inventing roof materials.

It draws by the rule RFC 0028 already shipped, so there is nothing new to learn and nothing can
hide: the plot you stand on has its roof lifted away, and the 3D home view's floor picker gains a
chip for the home with its roof on. Six surfaces read the one sim function
(`packages/client/src/render/roofs.ts`, `packages/client/src/scene3d/roofs.ts`,
`packages/client/src/plot-thumb.ts`, `packages/server/src/plot-photo.ts`,
`packages/server/src/pictures.ts`, `packages/cards/src/plot.ts`), so they cannot disagree about what
a home's roof covers.

`REPLAY_VERSION` stays where it is: `set_roof` is a new command and `plot.roof` is absent until an
input sets it, so every older log replays to its pinned hash (`src/fixtures/roof-log.ts` pins one
with roofs in it).

What to revisit: the box's two failure modes, if residents start building L-shaped homes or hanging
walls off them, and whether `FLOORS.max` should rise now that the top floor has something to say.
