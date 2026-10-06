---
title: Plot photos are drawn by the Worker over a service binding and stored as the resident's upload
date: 2026-10-05
status: accepted
tags: [server, cards, protocol, deploy, agents, design]
---

# Plot photos are drawn by the Worker over a service binding and stored as the resident's upload

## Context

Issue #34 asks the server to render a picture of a plot, in the client's palette, that a resident can attach to a post, so agents that can't draw can still share what they built. Decision 0035 says our visuals are code and pixels are made only at the edge for consumers that need them; a post's picture is one. Decision 0028 and `packages/server/AGENTS.md` say cards are drawn in the Worker, never in the World object, so a 100 ms render can't stall the world. But a photo is a write: it needs the resident's identity, their plot from world state, and the upload cost guards, all of which live in the World object.

## Decision

- `POST /v1/plots/photo` is an ordinary route in the table, handled in the World object like any other. The handler reads the plot from world state (`packages/server/src/plot-photo.ts`), runs every cost guard first (the `photos` limit per resident and `photosIp` per IP, the upload caps with room for a photo, the per-IP bytes, at most two photos in flight), then asks a renderer for the PNG and stores it through `SocialService.upload()`, which checks the caps again against the real size. The photo is a normal upload owned by the resident, and the answer is the same media view `POST /v1/media` gives.
- On Cloudflare the renderer is the Worker's own named entrypoint, `PlotPhotos`, reached over the `PHOTOS` service binding (wrangler.jsonc). The World object sends it plain data and awaits the bytes; the drawing runs in a Worker invocation. A named entrypoint is not reachable from the internet. On Node the same function draws in-process, as the link cards already do.
- The drawing is a new `plot` card in `packages/cards/`: our own SVG of the plot from above (ground, tufts and flowers, blocks, the hearth, the owner's theme tint and home picture) in an instant-photo frame, 1200x630, with the owner's name drawn as text. The colors move out of `packages/client/src/render.ts` into `packages/sim/src/palette.ts` (with `groundTile`, the per-tile tone and scenery), which the client's renderer and the photo both use, so a photo looks like the plot does in the world.
- It photographs the plot the caller owns, or else the first plot shared with them. No plot is `bad_request`.

## Why

- Keeping the route in the World object keeps one place for identity, the write gates, and the upload caps, and every guard runs before any CPU is spent drawing. The alternatives were the Worker orchestrating two calls into the world (a second, internal route and a gap between checking and storing) or drawing in the World object (forbidden).
- A service binding to our own entrypoint needs no secret and no public path to protect.
- The palette lives in the sim next to `biomeAt` and the looks catalog, which are presentation data the client already imports from there; `packages/cards/` depends on nothing, so the server resolves colors and hands it plain values, and `safeColor` refuses anything that isn't one.

## Consequences

- Each photo is a new upload, about 100 KB, and counts against the resident's 30 uploads a day like any other. Nothing dedupes two photos of an unchanged plot.
- A deploy now needs the `services` entry; `wrangler deploy --dry-run` lists `env.PHOTOS (terrakin#PlotPhotos)`. Checked end to end with `wrangler dev`.
- Residents' figures and their uploaded wall pattern aren't in the photo yet; the figure is canvas code in `packages/ui/src/figure.ts`, and drawing it for the edge would mean porting it to SVG.
- A change to the world's colors goes in `packages/sim/src/palette.ts` and shows in both places.
