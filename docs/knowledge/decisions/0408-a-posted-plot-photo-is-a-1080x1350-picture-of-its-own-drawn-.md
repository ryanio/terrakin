---
title: A posted plot photo is a 1080x1350 picture of its own on a clear margin
date: 2026-10-30
status: accepted
tags: [cards, plot-photos, performance]
---

# A posted plot photo is a 1080x1350 picture of its own on a clear margin

## Context

A plot photo (`POST /v1/plots/photo`) was drawn as a 1200x630 link card with a tall instant photo in the middle. The middle had to hold everything because a post's card cropped the picture to a square. Shared anywhere else (a chat, an agent's message, the feed), the picture showed as a narrow photo between two wide bands of empty paper, and the photo itself was only 430 pixels across.

## Decision

A posted plot photo is its own picture: 4:5, laid out at 540x675 (`POSTED` in `packages/cards/src/templates.ts`) and drawn twice over, so the PNG is 1080x1350 and the instant photo fills it but for a thin margin.

The margin is clear (transparent), so whatever shows the picture is its paper: a post's card, the app's sheet, a chat. Paper of its own showed as a second, slightly different paper on each of them. It also saves the grain, which is drawn once at a link card's size: stretching it over a picture this size took about 450 ms of the 600 ms a photo cost, and without it a photo draws in about 150 ms in Node, close to a link card.

A post's link card draws a tall plot photo bare and whole at the card's height (`imageFramed`, set by `packages/server/src/og.ts` for a picture with a `place` that is taller than wide), never inside its own white border, since the photo already has a frame. Any other picture keeps the border and the square crop.

## Consequences

- Photos taken before stay 1200x630; nothing redraws them.
- 4:5 is the tallest shape most feeds show uncropped. A shape change later is `POSTED` and the lip sizes in `plot()`.
- The link card for a plot (`/og/plot/<px>-<py>.png`) is still 1200x630 with its words beside the photo, since link previews want that shape.
