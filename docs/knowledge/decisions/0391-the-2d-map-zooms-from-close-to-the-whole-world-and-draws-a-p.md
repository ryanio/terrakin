---
title: The 2D map zooms from close to the whole world, and draws a picture of the ground when zoomed out
date: 2026-10-30
status: accepted
tags: [client, map, performance]
---

# The 2D map zooms from close to the whole world, and draws a picture of the ground when zoomed out

## Context

The map showed about 13 tiles across and nothing else. Downtown is 72 tiles square and grows wider as lands open (RFC 0038), so on a phone nobody could see the town, find an island, or find their way home except by walking. A zoom needs gestures that don't fight the tap that walks you, a camera that knows when to follow you, and a way to stay smooth on a phone when thousands of tiles are on screen at once.

## Decision

The map zooms with a pinch, a wheel or trackpad, and round + and - buttons, from 1.6 times the usual view out to the whole world on the screen (`zoomBounds` in `packages/client/src/map-zoom.ts`). The usual view stays the default and is never remembered.

- A tap on the map acts when the finger or button lifts, not when it goes down, so the first finger of a pinch or a drag never walks you.
- At the usual view or closer the camera follows you as before. Zoomed out by a gesture, or dragged, it roams, held over the world by `keepInWorld`, and your next step brings it back.
- Under 14 pixels a tile the map draws the ground and the ground floor's blocks as one picture, a pixel a tile (`render/ground-picture.ts`), stretched in one draw, and figures as dots. The picture is drawn again only when `Mirror.groundRev` moves, which every event but walking, coming and going, and naming bumps.
- Under 20 pixels a tile each town square shows its land's name with marks for its hall and shop, and your home a pin (`render/marks.ts`).
- Places lists Home, the Town Hall, the shop, the Green, and each land's square, and walks you there with `walkFar`.

On a 390x844 phone with the CPU slowed 4x in headless Chromium, the overview of a world with one island (120 by 72 tiles) took 85 ms a frame drawn tile by tile, 55 ms with the small things left out, and 36 ms with the ground as a picture, against 33 ms at the usual view.

## Consequences

- Taps on the map land a moment later, as the finger lifts. A drag at the usual view still taps where it went down.
- `groundRev` counts by leaving out events, so a new event that changes the ground needs nothing; a new frequent event that never does belongs in `GROUND_STILL` in `packages/client/src/mirror.ts`.
- The overview's ground is a pixel a tile, so its paths and blocks read as colors, not shapes.
