---
title: A plot photo's surround wash fades out as the light goes
date: 2026-10-20
status: accepted
tags: [cards, design, photos]
---

# A plot photo's surround wash fades out as the light goes

## Context

A plot photo shows the plot with a tile of the world on each side, so a home reads as a place in a
town ([decision 0306](0306-a-plot-photo-shows-the-plots-next-door.md)). The sliver is washed back
with paper, `rgba(255, 250, 240, 0.52)`, in `surroundWash`
([`packages/cards/src/plot.ts`](../../../packages/cards/src/plot.ts)). The wash goes over
everything standing in the area and **under** the sky, so the night and the weather fall on the
whole picture evenly (issue #80).

That is right in daylight and backwards after dark. The night is a `mix-blend-mode: multiply`. A
bright warm band multiplied down stays light; the plot beside it, with no wash under it, goes
muddy. So a photo taken at night came out as a dark rectangle stamped on a pale violet field,
with the home it is a picture of as the darkest thing in the frame. Ryan spotted it on a posted
photo of Cone Corner.

The samples had a night photo and a photo with the sliver, and never one with both, which is why
nothing caught it.

## Decision

The wash fades with the light: its alpha is `0.52 * (1 - sky.night)`, and under 0.01 it isn't
drawn at all. At noon it is exactly what it was, at dusk it is half, and at midnight there is none.

The sliver itself is still drawn at every hour. Only the paper over it goes, so the neighbours'
hearths and ground are in the picture after dark the way they are at noon.

## Consequences

Every daylight photo is byte identical: `n(0.52 * 1)` prints `0.52`, the string the wash always
had. Only photos with a `sky` that has any night in them change, and they change toward the
picture they were meant to be. `CARDS_VERSION` moves to 12, so cards already cached are drawn
again.

Photos already taken are stored uploads and are not redrawn. A resident with a dark-rectangle
photo gets a right one the next time they take one.

The samples gain `plot-in-town-night`, the combination that was missing, and `cards.test.ts` pins
the three alphas and that midnight draws no wash at all. A sample for each pair of features that
interact is the cheap guard here: the renderer has several washes and glazes that stack, and the
order they stack in is only visible in a picture.
