---
title: A picture with no viewer lifts the roof off the place it is about
date: 2026-10-20
status: accepted
tags: [cards, world, client]
---

# A picture with no viewer lifts the roof off the place it is about

## Context

[Decision 0331](0331-a-plot-photo-lifts-the-roof-off-the-home-it-is-a-picture-of.md) fixed the plot
photo: Felipe put a leaf gable on their home, the photo came back a featureless slab, and the cause
was an inverted filter that drew the subject plot's roof and skipped every neighbour's. The map
does the opposite, lifting the roof off the plot you stand on, and a photo has no "you" to lift
anything.

That record settled one picture. The same mistake was in two more, and both were live:

`/og/near` captions itself "Wren is here" and then drew every roof in its box, the subject's
included. A resident standing in their own home was a faded smudge under a coloured quadrilateral,
and so was the white ring that marks who the picture is about.

`plotMarks` drew the roof on every plot thumbnail: the Visit page, the home wall's "Plots to visit"
strip, and the plot on a profile. The townsfolk put their roofs up the same day
([decision 0330](0330-the-townsfolk-s-homes-wear-roofs-in-the-free-coverings-and-n.md)), so most of
the Visit page had already turned into a grid of coloured rectangles. The cards sit beside unroofed
homes that read fine, which is what made it obvious once anyone opened the page.

## Decision

One rule, which is the map's rule with the viewer replaced by the subject: a picture drawn from
above with nobody standing in it lifts the roof off the place it is about, and keeps every other
roof on.

- `/og/near` lifts the roof over the plot the resident is standing on, the plot its caption already
  names (`spot` in `nearPicture`, which the caption reads too).
- A plot thumbnail leaves its own roof off. `plotMarks` draws one only when the caller asks with
  `{ roof: true }`, which is the claim picker drawing the eight neighbours around a plot.
- A plot photo and `/og/plot` keep what decision 0331 gave them, since both go through
  `plotSpecOf`.
- A floor plan still asks for no roofs at all: the point of a floor plan is seeing in.

Neighbours keep their roofs everywhere, and someone else standing under their own stays faded, as
the map fades them.

## Alternatives

Drawing the subject's roof faded, so the home reads through it, was tried at 0.4 alpha and looked
at. The walls go olive, the hearth's colours wash out, the figure bleaches, and the roof stops
reading as a roof: it becomes a film with an ink rectangle round it. Worse at both jobs than either
a whole roof or none.

Leaving the thumbnails alone was the other option, on the grounds that a tiny card wants a home to
read as a home rather than as an open floor plan. The pictures killed it. A card is 96 to 176
pixels, and a roofed starter hut fills its middle with one flat colour: the walls, windows, hearth,
furniture and paths are all gone, and the cards that still read are the ones whose owners have not
bought a roof yet.

## Consequences

A roof never shows in a picture of your own place from above. It shows in 3D, where a roof reads as
a roof, on the map wherever you are not standing, and on every neighbour's card. If that trade
turns out wrong, the thing to try is an outline or a ridge line for the subject's roof, so the
shape shows without hiding the home.

`plotMarks` gained an option rather than a second function, so the claim picker's neighbours keep
their roofs with one flag at the call site and nothing else in the repo had to change.

What this cost to find was one PNG written to disk and one page opened in a browser. Every test was
green through all three bugs, including the tests written for roofs themselves, because they check
the shape a roof covers and never that a picture still shows the thing it names. When a feature
changes what a drawing hides, open the drawing.
