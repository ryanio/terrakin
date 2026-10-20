---
title: Snow lies on a roof all winter, less than on the ground
date: 2026-10-20
status: accepted
tags: [sim, client, cards, design, seasons]
---

# Snow lies on a roof all winter, less than on the ground

## Context

Roofs shipped on 2026-10-20 ([RFC 0041](../../rfcs/0041-materials-and-roofs.md)) with no season in
them. Winter dresses every biome in snow (`SEASON_GROUND` mixes the ground 0.64 to 0.74 toward
`SNOW_WHITE`) and strips the flowers, so from December a roofed town would have read as saturated
green, brown and grey boxes sitting on a white field. The one thing in the world that is meant to
be weather-facing was the one thing the weather never touched.

A roof is a good place to put snow because nothing has to be stored for it. What a roof covers is
read from the walls every time it is drawn, so the season can be read at the same moment.

## Decision

A roof goes 0.56 toward the same `SNOW_WHITE` the ground uses, all winter, and nothing in any other
season. That is `roofSnow(season)` and `roofTone(hex, season)` in `packages/sim/src/palette.ts`,
beside `seasonTone`.

Less than the ground's 0.74, on purpose. A covering is something a resident chose and paid for in
leaf, wood, stone, glass or a made material, so at full snow every roof in town would be the same
white quadrilateral and the choice would vanish for a quarter of the year. At 0.56 a leaf roof is
still visibly greener than a stone one and the town still reads as snowed over.

All winter rather than only while it is snowing. The weather table only ever snows in winter
(`WEATHER_CHANCES`), weather turns over every 3 to 6 hours, and snow that appeared and vanished
through the day would be noise rather than season. Snow that lies is also what actually happens.

One amount, in the sim, read by every view: the map, both 3D views, plot thumbnails, plot photos
and the pictures by link. The 3D views work in numeric colors, so they mix `SNOW_WHITE` into their
own palette with the same `roofSnow` amount rather than calling `roofTone`. The server mixes it
when it builds a photo's `fill`, so `packages/cards/` needs no season and keeps its promise of
depending on nothing in the repo.

## Consequences

The walls under a roof keep their own color, which turns out to be a small bonus: from above, a
snowy roof is what tells a home from the garden wall beside it.

A tint is all this is. There is no cap of snow along the ridge, no drift at the eaves, and no melt:
the per-tile height the drawings already have would allow a ridge-weighted mix, but that has to
cross the RPC boundary into `packages/cards/` as a number per roof, and it is not worth a protocol
field for a quarter of the year. If it ever is, `PlotRoofing` is where it would go.

Nothing about a roof's rules changed: no new field, no new input, nothing stored, and
`REPLAY_VERSION` does not move.
