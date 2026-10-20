---
title: A roof can wear a vane, a flag or a nest on its ridge
date: 2026-10-20
status: accepted
tags: [sim, protocol, client, cards, design]
---

# A roof can wear a vane, a flag or a nest on its ridge

## Context

Every picture in Terrakin but the 3D views looks straight down, and from there a roof is one
quadrilateral in one of six coverings. A street of homes built from the same designs, roofed in the
same free blocks, reads as a row of identical boxes, and that got worse the day the townsfolk all
roofed at once ([decision 0330](0330-the-townsfolk-s-homes-wear-roofs-in-the-free-coverings-and-n.md)).
An upstairs and a roof are the two things a resident buys for their home to be looked at, and from
above neither says whose home it is.

## Decision

A roof can carry one thing on its ridge: `vane` (a weather vane), `flag`, or `nest` (a bird's
nest). It is a field on the plot's roof (`PlotRoof.top`), set by `set_roof`'s optional `top`, and
it costs nothing, whatever the covering costs.

Free, because the scarcity it answers is sameness, not spending. A roof already takes 8 blocks of
its covering; charging again for the one mark that tells two leaf gables apart would leave most
homes unmarked, which is the problem.

Part of the roof you set, not a command of its own. `set_roof` without `top` leaves the ridge bare,
so every logged input from before this replays exactly as it did, and `style: "flat"` takes the
mark down with the roof. The cost is that a client changing only the covering has to send the
ridge again to keep it; the roof sheet does, and SKILL.md says so.

Where it stands is the sim's (`roofShape`'s `top`): the first of the roof's highest tiles, which is
the north-west end of a gable's ridge. The middle was tried first and put the mark over the hearth,
where the figure of whoever is home stands, so a vane looked like something the resident was
holding.

Three choices, not thirty. Each has to read at 19 pixels a tile on a Visit card and as geometry in
3D, and each is drawn five times over (the map, the thumbnails, the cards' SVG, and two 3D views
share one mesh). A fourth can go on the end of `ROOF_TOPS` whenever one earns its place.

## Consequences

A plot photo of your own home never shows your own mark, because a picture lifts the roof off the
place it is about ([decision 0333](0333-a-picture-with-no-viewer-lifts-the-roof-off-the-place-it-is-.md)).
The mark is for the street: neighbours see it on the map, in the world in 3D, in their own photos'
slivers and in the pictures by link, and the owner sees it in the 3D home view with the roof on, or
by stepping off their own plot. That is the same trade decision 0333 made and is worth saying out
loud, since someone will set a vane and then take a photo.

A change to the ridge alone emits `roof_top_set` rather than `roof_set`. Keeping one event looked
fine until the Visit cards' news read it ([decision 0336](0336-a-plot-card-says-what-is-new-on-it-from-a-day-s-counts-in-a-.md)):
`roof_set` carries the whole new roof and nothing about what changed, so putting a vane on a roof
that went up weeks ago said "a roof went up today". Anything that counts a deed from an event
needs the event to say which deed it was.

In 3D the mark is extra triangles in the roof's own merged mesh, shaded dark, so it adds no draw
call, no material and no light, and decision 0030's budget is untouched.

`packages/cards/` draws it from `PlotRoofing.top` with the kind names written out, since that
package depends on nothing in the repo. An unknown kind draws nothing rather than throwing.

`REPLAY_VERSION` does not move: the field is absent until an input sets it, like the roof itself.
