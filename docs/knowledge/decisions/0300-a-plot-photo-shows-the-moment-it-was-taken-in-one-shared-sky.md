---
title: A plot photo shows the moment it was taken, in one shared sky
date: 2026-10-16
status: accepted
tags: [cards, design, server, client]
---

# A plot photo shows the moment it was taken, in one shared sky

## Context

A plot photo is the main thing a resident shares about their home, so it is what most people meet
Terrakin through. The photo it drew was a flat grid of tiles on a small square in the middle of a
wide card: no light, no weather, nobody in it, a caption of the plot's number, and every unripe
crop the same green sprout. Issue #80 called it a spreadsheet of tiles rather than a picture of a
place.

The map already had all of it. `nearSvg` drew the weather and the map's light over a picture by
link, and the picture of a plot by link already stood its residents on it. Only the photo went
without, and the weather and light code sat inside the picture file where the photo could not
reach it.

The one thing we would not do is change the projection. An angled or isometric render was the
first idea in the issue, but a photo's worth is that it looks like the plot does on the map, and
the map is top down. A photo drawn from another angle would be a second art direction to keep in
step with the first.

## Decision

The sky is one piece of code (`packages/cards/src/sky.ts`) that every picture drawn from above
shares: a plot photo, a plot by link, and the map around someone. `PlotArea` and `PlotCard` carry a
`Sky` (how dark it is, and the weather), and `areaParts` draws it last.

The light is the map's own, down to the multiply. The map darkens the night by multiplying, which
keeps every hue, and the card did it by painting a flat violet over the top, which greyed
everything. resvg honours `mix-blend-mode: multiply` in the CSS form, so the card multiplies too.
The one thing a card draws over the plot rather than in it is the owner's own picture of their
home, and that takes the same night as a flat wash (`nightWash`), so it never stays bright in a
dusk photo.

`plotSpecOf` fills the sky from the server's clock, stands whoever is on the plot in the picture,
and writes a stamp in our own words: the world day, the season, the time of day when it isn't plain
daylight, and the weather.

The card is a postcard. A photo taken to post stays a tall instant photo in the middle, because a
post's card crops it to a square from the middle, but it is bigger and its caption carries the
stamp. The card for a link puts the photo on one side and its words on the other, which fills a
1200 by 630 card instead of leaving two bands of empty paper.

A crop sets its fruit at `FRUIT_SET` (0.45) rather than at ready, swelling from a green bud to the
crop's own color, in the photo and on the map alike.

## Consequences

A photo now changes through the day, so two photos of the same plot differ. That is the point, and
it is also why a plot's picture by link redraws more often: its night is rounded to a twentieth, as
`near`'s already was, so it changes about twenty times a day rather than only when the plot does.
The draw caps in `packages/server/src/og.ts` are what hold that down.

Half the photos anyone takes will be dusk or night, because the map's day turns every 3.5 hours.
A night photo is darker than a noon one and reads as evening, with the hearths lit. If that turns
out to disappoint people sharing a home they just built, the lever is the night a photo draws, not
the light itself: cap it in `plotSpecOf` and leave the map alone.

The crop numbers live in two files, `packages/cards/src/plot.ts` and
`packages/client/src/render/blocks.ts`, as the rest of the crop drawing already did. They have to
move together.

Two card layouts now live in `plot()` in `packages/cards/src/templates.ts`, one for a posted photo
and one for a link. `CARDS_VERSION` went to 8, so cards drawn before this are drawn again.
