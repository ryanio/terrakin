---
title: A plot photo shows a sliver of the plots next door
date: 2026-10-16
status: accepted
tags: [cards, design]
---

# A plot photo shows a sliver of the plots next door

## Context

Issue #80 asked for composition: a plot photo framed the plot and nothing else, so a home read as a
floating square of tiles rather than somewhere in a town. Decision 0300 gave the photo its moment
and decision 0305 lit its hearth, but the frame still stopped dead at the property line, even for a
plot with neighbors on three sides.

The pull is in two directions. The issue also asked for a tighter crop with less dead margin, so
whatever the photo shows past the plot has to be small, and it must not take the eye off the home
the photo is of.

## Decision

A photo draws the plot with one tile of the world on each side, kept inside the world's edges
(`SURROUND` in `packages/server/src/plot-photo.ts`), and washes everything outside the plot back
with paper (`surroundWash` in `packages/cards/src/plot.ts`, over what stands in the area and under
the sky, so the night and the weather fall on the whole picture evenly). The plot still fills four
fifths of each side.

The slivers carry what the world has there: ground, paths, ponds, blocks, crops, each plot's own
theme tint, and the neighbors' hearths, so their homes show. They do not carry people. Whoever is
standing on the plot is still drawn (decision 0300), and nobody else: a neighbor in their own
garden is not the subject, and a photo is stored and posted, which would make a passer-by part of
somebody else's upload for good.

The spot the plot sits in the box is `surround`, and the plot stays the subject of everything the
photo says in words and of everything counted: only its own tiles name its ground, only its own
blocks are counted, and only its own floors are drawn and counted, so a neighbor's loft lays no
shadow over the plot's edge and never reads as a floor the owner added.

## Consequences

A picture of a plot by link (decision 0160) gets the same frame, since both read through
`plotSpecOf`. Nothing new is exposed by it: the map around someone already draws whole
neighborhoods, and no neighbor's uploaded art is ever drawn, only the owner's own.

The wash is a band in tile units, while everything standing in a picture is drawn taller than its
own tile. So a hearth on the plot's own north row has its smoke washed back with the band above it,
and a neighbor's roof in the south sliver tops the band and reaches the plot's last row at full
strength. Both read as depth rather than as a mistake, and the alternative (fading each thing
outside the plot on its own, rather than one band over the lot) costs more than it buys here. A
change to how tall things are drawn should look at this again.

A tile of the world around the plot means 100 tiles drawn instead of 64, which is the cost. Blocks
and crops in a sliver belong to a neighbor, so every tally filters by the plot's rect; a count that
forgets to would quietly credit the neighbor's work to the owner, and the photo's block count and
its story line are both tested for it. `CARDS_VERSION` went to 10, so cards drawn before this draw
again.
