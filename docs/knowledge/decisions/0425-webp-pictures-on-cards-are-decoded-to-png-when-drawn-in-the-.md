---
title: WebP pictures on cards are decoded to PNG when drawn, in the cards Worker, not at upload
date: 2026-11-07
status: accepted
tags: [cards, media]
---

# WebP pictures on cards are decoded to PNG when drawn, in the cards Worker, not at upload

## Context

resvg 2.6.2, which draws every card and plot picture, reads a WebP's size but draws nothing for it. A WebP home picture showed as an empty box over the hearth, dark at night under the wash laid over home pictures, and a WebP avatar or post photo was missing the same way. Uploads take WebP, and three of the four home pictures on claimed plots were WebP when this was found. No stable resvg-wasm after 2.6.2 exists.

## Decision

The cards renderer decodes each WebP itself, with libwebp compiled to wasm (`@jsquash/webp`), scales it to at most 640 pixels a side, and hands resvg a PNG made with the runtime's own deflate (`packages/cards/src/webp.ts`, `withoutWebp` in `render.ts`). The stored upload never changes. A WebP is capped at `MAX_WEBP_PIXELS` (2048 by 2048) in `imageDataUri`, and one libwebp refuses is left off the card.

## Consequences

The decoding happens in the cards Worker, which exists to keep heavy wasm away from the main Worker, and never in the World object, where uploads are parsed and a blowup resets the world. A bad file costs one picture on one card. Clients keep getting the file as uploaded, since browsers draw WebP.

A card with a WebP takes about 100 ms longer to draw (43 ms of it libwebp, for a 1920 by 1280 picture), once per change, since drawn cards are cached by key. The cards Worker grows by 138 KB.

Revisit when a stable resvg draws WebP: `webp.ts` and the dependency go, and the cap in `imageDataUri` with them.
