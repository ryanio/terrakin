---
title: A plot photo lifts the roof off the home it is a picture of
date: 2026-10-20
status: accepted
tags: [cards, world, client]
---

# A plot photo lifts the roof off the home it is a picture of

## Context

Roofs shipped on 2026-10-20 ([RFC 0041](../../rfcs/0041-materials-and-roofs.md),
[decision 0324](0324-a-roof-is-a-look-on-the-plot-over-the-box-around-each-group-.md)). Hours later
Felipe, a resident nobody prompted, put a leaf gable on their home and posted the plot photo. It was
a featureless dark slab: no hearth, no walls, no planters, no doorway.

Ryan asked why the picture looked bad. The weather was the obvious suspect, since the stamp read
dusk and cloudy, but an unroofed plot photographed at the same moment reads fine, with the hearth
glowing and the flowers showing. So it was the roof.

The cause was an inversion nobody would have caught without a real roofed home. The map draws
"every home's roof but the one you stand on, which lifts away" (`render.ts`). A plot photo did the
exact opposite: `roofsIn` was called with `(px, py) => px === plot.px && py === plot.py`, so it drew
the subject plot's roof and skipped every neighbour's. A photo has no "you" to lift anything, and a
roof from above is opaque, so the one home the picture is about was the one home covered up.

The reasoning behind that filter was sound on its own terms: "a neighbor's roof in a sliver is not
the subject." It just never asked what the subject's own roof does to the subject.

## Decision

A plot photo from above draws every roof in its box except the plot it is a picture of. One line:
the filter is `(px, py) => px !== plot.px || py !== plot.py`.

That is the map's rule, not a new one, which is why this is a fix rather than a choice. It also
keeps the promise RFC 0041 made in its own devlog: "nothing can hide under it."

Neighbours' roofs stay on. Their hearths and blocks are already drawn in that sliver
([decision 0306](0306-a-plot-photo-shows-a-sliver-of-the-plots-next-door.md)), so leaving their
roofs off would be the odd thing, and a roofed home next door reads as a home rather than a hole.

A floor plan (`floor` on the route) still asks for no roofs at all, which was already right: the
point of a floor plan is seeing in.

## Consequences

Someone who buys a roof sees no change in their plot photo from above, which is the real cost of
this. The roof shows in the 3D view, which is where a roof reads as a roof; from directly above
even a well drawn gable is a quadrilateral. If that trade turns out wrong, the alternative is to
draw the subject's roof as an outline or a ridge line, so the shape shows without hiding the home.
That is a bigger change and a real design question, and nothing here forecloses it.

The lesson worth keeping is about where this was found. Every test passed, the feature was
reviewed, and a devlog went out with 3D screenshots that looked good. It took a resident putting a
roof on their own home and a person looking at the result. A picture that something else renders,
in a mode no test looks at, is where this class of bug lives.
