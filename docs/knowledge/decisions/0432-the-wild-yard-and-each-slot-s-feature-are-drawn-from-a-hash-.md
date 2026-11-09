---
title: The wild yard and each slot's feature are drawn from a hash, on the map and in 3D
date: 2026-11-09
status: accepted
tags: [client, rendering, 3d, rfc-0052]
---

# The wild yard and each slot's feature are drawn from a hash, on the map and in 3D

## Context

[RFC 0052](../../rfcs/0052-plots-that-grow.md) doubles every plot slot to 16 tiles and lets owners build only on the lot in its middle, 8 tiles a side to start. The ring past the lot is the wild yard. Ryan wants a first plot to feel roomy but never empty: a cottage in a meadow, not an 8 by 8 square in 256 bare tiles. Unclaimed slots draw the same meadow, so the town reads green everywhere. Each slot also gets one feature (an old tree, a boulder, a flowering bank, an old stone wall, or none), drawing only for now.

None of it is state. The server never stores a tree, and nothing about it changes a walk, a gather, or a build. So it has to look the same on every screen without being sent.

## Decision

The client draws the yard and the features from pure functions of position, in `packages/client/src/wild-yard.ts`:

- `yardGrowth(x, y, biome, season, wild)` hashes the tile (salted, so it never lines up with the palette's own tufts) into grass, a flower clump, a bush, a small tree, or nothing, at rates per biome: a meadow ring of 192 tiles gets a handful of trees, some bushes, a dozen or more flower clumps, and stays mostly open grass. A forest grows thicker, sand grows no trees or flowers, winter puts no flower out, and a street's verge grows no trees. A canopy stays inside its own tile.
- `plotFeature(px, py, slot, ring)` hashes the slot into one of the four kinds or none (two slots in ten), on a side of the slot and always in the ring, never in the middle 8 by 8 where homes built before the regrid stand. `featureOn` draws a feature whole or not at all: a way carried across the yard, a bridge, or a lot grown over any of its tiles leaves it out.
- `onRoad` makes a street slot a 4-tile road down its middle, running toward each street or square beside it, with wild verge either side. The Commons and each land's square keep their plaza.

`Mirror.wildAt` says which tiles are wild: past the lot (the sim's `inLot`), not a square, the sea, a bridge, or anything paved, and only once the world has regridded. The map paints the yard in `render/yard.ts`, batched into a few paths a frame, and leaves it out of the zoomed-out picture. The 3D world adds bushes, trees, and stones to each slot's chunk as three instanced draws (`yardScenery`), and the plot view draws its own slot's yard the same way (`yardIn`). Colors live once in `YARD_LOOK`, worn by the season.

A photo's tags look past the yard's trees (`seeThrough` on its meshes): someone standing among them is still the one a tag names.

## Consequences

- Nothing is sent or stored, every client draws the same meadow, and a world before its regrid draws exactly as it did.
- The 3D world stays inside [decision 0060](0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md)'s budget: a slot's chunk is four times the tiles, but fewer chunks fall in the 12-tile view radius, and on a phone at 390 by 844 a frame measured 57 draw calls and about 55,000 triangles at a home with neighbors, against 300 and 150,000. The view radius did not change.
- When the brook and the well arrive, they are water and so state: they belong in the sim (the RFC's `plotFeature` and `wildAt` exports), and this module should then read the sim's feature rather than its own hash. The four drawing-only kinds can move there at the same time without changing a slot's look, as long as the hash moves with them.
- Changing the hash or the rates changes every slot's look at once. That is allowed (nothing depends on it) but should be a choice, since residents will know their old tree.
