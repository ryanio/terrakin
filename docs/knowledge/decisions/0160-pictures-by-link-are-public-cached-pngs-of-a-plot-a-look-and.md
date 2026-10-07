---
title: Pictures by link are public cached PNGs of a plot, a look, and the map around someone, drawn in the Worker from data the world builds
date: 2026-10-07
status: accepted
tags: [server, cards, ui, agents, security, deploy, design]
---

# Pictures by link are public cached PNGs of a plot, a look, and the map around someone, drawn in the Worker from data the world builds

## Context

Many people play Terrakin through their AI's chat. The only picture an agent could show was a plot photo from `POST /v1/plots/photo`, which is stored as an upload, counts against 30 a day, and is meant for posts ([decision 0048](0048-plot-photos-are-drawn-by-the-worker-over-a-service-binding-a.md)). Most chat apps show an image URL inline, so a few public PNG URLs make the world visible in chat at no cost to the resident. Link preview cards already draw at the edge from data and cache by a hash of what they show ([decision 0028](0028-link-preview-cards-and-page-meta-at-the-edge.md)), and our visuals are code, rasterized only for consumers that need pixels ([decision 0035](0035-draw-with-code-first-and-rasterize-only-at-the-edge.md)).

Two things were missing. Figures were canvas code in `packages/ui/src/figure.ts` with no way to draw them at the edge, and a public route that draws costs Worker CPU on every miss.

## Decision

- **Three routes beside the cards, in `og.ts`'s routing**: `/og/plot/<px>-<py>.png` (a plot as it looks now, with whoever stands on it), `/og/look/<residentId>.png` (a resident in their look, with their pet), and `/og/near/<residentId>.png` (a 24 by 10 tile crop of the map around where they are, with their online neighbors, the map's light, and the weather). Public, no auth, 1200x630 PNG cards in the same frame as the others. An unknown plot or resident gets the static `/og.png` like any card.
- **The world builds data, the Worker draws.** The World object answers an RPC, `picture(route)`, with plain data from world state (`pictureSpec` in `packages/server/src/pictures.ts`), reusing the plot photo's builders (`plotSpecOf`, `areaOf` in `plot-photo.ts`). The Worker's fetch handler turns that into a card (`materializePicture`: figures recorded, the home picture loaded) and draws it with `packages/cards/`. Node does both in one process.
- **Figures are the map's own figure, recorded.** `@terrakin/ui/figure-svg` runs `drawFigure` into `SvgPen`, a stand-in canvas that keeps each fill, stroke, clip, and pattern tile as SVG path data. `packages/cards/src/drawing.ts` checks every part (path data of commands and numbers, palette colors, its own clip and tile indices) before it becomes markup, the way pets' shapes are checked. The import's types point at `figure-drawing.ts`, which names no DOM types, so the server typechecks on Node and Workers. This adds `server -> ui` for that one module.
- **Cached twice, keyed by what it shows.** A PNG is cached under a hash of its data and `CARDS_VERSION`, so it's drawn once per change. A short pointer per path (`at/og/<kind>/<id>.png`) says which hash the path shows: two minutes for `near`, one minute for `plot` and `look`. Inside it the world isn't asked at all. Responses carry the cards' headers: an ETag, `nosniff`, and `Cache-Control` of `max-age=120` for `near`, 300 for `plot` and `look`, and a year for `?v=<etag>`. `near`'s light is rounded to twentieths so it doesn't change every second.
- **Guards.** 60 picture requests per IP (or IPv6 /64) a minute, refused before the world is asked. A draw also needs the IP's card render allowance (12 a minute, shared with the cards) and the server's: 60 draws a minute. All three are `windowLimiter` counters per isolate on Cloudflare and per process on Node. Over any of them the answer is the static card with `no-store`, never a broken image.
- **No uploaded art but a home picture, and never a hidden one.** A look never carries `patternMedia` (a garment styled `own` wears the outfit's pattern), and the map around someone draws no home pictures. A plot's home picture shows only while its owner isn't suspended and staff never removed their pictures (`SafetyService.picturesRemoved`, read from `moderation_log`). Piece pictures and partner pictures are never drawn. Names are drawn as text by the templates.
- **The map's light moves to the sim.** `nightAmount` lives in `packages/sim/src/time-of-day.ts` beside `dayPhase`, and the client imports both from there.

## Consequences

- No wrangler change: the Cache API, the World binding, and RPC are already there. The Worker bundle grows by the figure code.
- A draw costs about 120 to 170 ms of CPU in Node, a little more than a card. The map around someone with 16 figures is the most; `MAX_FIGURES` caps it.
- The limits are per isolate, so they slow one client or a burst, not a determined spread across isolates. The pointer and the PNG cache do most of the work.
- Removing someone's pictures hides their home picture from pictures by link for good, even one set later. Lifting that is a later choice.
- The map draws away residents asleep at their hearths ([decision 0086](0086-residents-who-are-away-sleep-at-their-hearths-drawn-but-neve.md)); pictures show only residents online now. The Town Hall and the shop aren't drawn in the Commons yet.
- Code: `packages/server/src/pictures.ts`, the picture half of `packages/server/src/og.ts`, `picture` on the World object and the deps in `packages/server/cloudflare/worker.ts` and `src/app.ts`, `packages/ui/src/figure-svg.ts` and `figure-drawing.ts`, `packages/cards/src/drawing.ts` and `pictures.ts`, `areaParts` in `packages/cards/src/plot.ts`, tests in `packages/server/src/pictures.test.ts` and `packages/cards/src/cards.test.ts`.
