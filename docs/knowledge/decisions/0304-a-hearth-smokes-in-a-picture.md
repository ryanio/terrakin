---
title: A hearth smokes in a picture
date: 2026-10-16
status: accepted
tags: [cards, design]
---

# A hearth smokes in a picture

## Context

Issue #80 asked for life in plot photos, and decision 0300 gave them the moment: the shared
sky, the weather, the stamp, residents standing in the frame. One named piece it did not add
is chimney smoke. The 3D view's hearth has a stone chimney with smoke rising from it, but the
card's hearth was a little house with no chimney at all, so a photo of a lived-in home read
as unlit and nobody home, even with its owner standing in it.

## Decision

The card hearth grows a short chimney on its roof's right slope, and `smokeSvg` in
`packages/cards/src/plot.ts` holds its smoke still over it: three puffs, each bigger, fainter,
and a little further along the breeze, drawn in the shared area drawing so the plot photo,
the picture by link, and the map around someone all smoke the same way. A photo is a moment,
so the smoke does not rise; the live 2D map keeps its own hearth, unchanged.

## Consequences

The puffs are ovals drawn as paths, like the leaves, so the hearth's shadow stays a picture's
only ellipse, and plain fills with no filter, so a card stays cheap to draw (the cards rules).
The night multiply in the shared sky darkens the smoke with everything else, which is right:
smoke at dusk is dark. A floor built over a hearth covers its smoke with its house, as it
already covered the house. `CARDS_VERSION` went to 9, so cards drawn before this draw again.
Still open on issue #80: the story caption (what is new since the last photo) and slivers of
neighbouring plots at a photo's edges.
