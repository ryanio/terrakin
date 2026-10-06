---
title: Weather is a pure function of the world day and the UTC hour, drawn only
date: 2026-10-06
status: accepted
tags: [sim, protocol, server, client, 3d, design]
---

# Weather is a pure function of the world day and the UTC hour, drawn only

## Context

The world should feel like it has a sky: rain some afternoons, fog, snow in winter, leaves on the ground in autumn. Everything that varies must be logged or be a pure function ([decision 0003](0003-deterministic-sim-with-input-log.md)), clients already share the server's clock as the snapshot's `time` ([decision 0011](0011-day-and-night-is-presentation-anchored-by-the-server-clock.md)), and `seasonOf` (`packages/sim/src/season.ts`) gives the season of a world day.

## Decision

- `weatherAt(day, hour)` in `packages/sim/src/weather.ts` gives `clear`, `cloudy`, `rain`, `fog`, or `snow` for a world day and a UTC hour. Each day is cut into spells of 3 to 6 hours by a hash of the day (the day's last spell runs to midnight, so none is shorter than 3), and each spell's weather is drawn from its season's chances (`WEATHER_CHANCES`). Snow comes only in winter. Like `biomeAt`, it is never state, never in the log, and no rule reads it. `weather.test.ts` pins a known day, the chances, and the spells.
- The server reads it off its own clock: `GET /v1/world` and `GET /v1/checkin` carry `weather` and `season` (`skyAt`), additive and optional. The season is the world's day's (`state.day`, which rules read), the weather the clock's hour.
- Clients work it out from the snapshot's `time`, advanced with their own clock, so the sky changes on the hour without asking again. A new spell fades in over a few seconds (`Sky` in `packages/client/src/weather.ts`).
- The map draws a grey wash and cloud shadows that drift with the wind, mist, rain streaks with splashes on open ground, and snow, under the night and the name tags, each kind a path or two and canvases drawn once. The 3D views grey the light, the sky, and the haze, and draw rain and snow as two point clouds around the camera's target (`scene3d/weather.ts`), within decision 0060's budget: two more draws and no triangles. Under prefers-reduced-motion everything holds still.
- The season dresses the ground through `packages/sim/src/palette.ts`: autumn warms the grass and drops leaves where flowers grew and more besides, winter lays snow on every biome and frosts the Commons with only tufts poking through. Spring and summer keep today's look. Plot photos read the world's day, so a photo shows the season too.
- Figures wearing the shop's umbrella hold it up in the rain and carry it rolled up otherwise, on the map and on the 3D peg. Pages (avatars, the look editor) keep it open, since they show the look, not the weather.

## Consequences

- No replay risk and no migration: the whole feature is pure functions and drawing.
- If a rule ever reads the weather, it must take it as a logged input like `new_day`, not from this function, or replay would depend on when an input arrived.
- The weather is the same everywhere in the world. Local weather would need a position in the hash.
