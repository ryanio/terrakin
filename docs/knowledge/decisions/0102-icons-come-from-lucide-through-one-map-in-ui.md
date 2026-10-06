---
title: Icons come from Lucide through one map in ui
date: 2026-10-06
status: accepted
tags: [client, ui, design]
---

# Icons come from Lucide through one map in ui

## Context

The site's icons were drawn by hand: about forty path lists in `packages/ui/src/dom.ts`, and another thirty or so pasted straight into `packages/client/index.html`, some of them copies of the ones in `dom.ts`. Each new icon meant drawing one, and the copies could drift. The owner prefers Lucide for the site's icons.

## Decision

Every UI icon is a Lucide glyph, picked in one map: `packages/ui/src/icons.ts` (`lucide`, pinned). Code keeps naming icons by what they mean here (`feed`, `town`, `kitchen`), and the map says which glyph draws each. `icon(name)` in `dom.ts` builds the element from it at run time. `index.html` writes `<svg class="icon" data-icon="name" aria-hidden="true"></svg>`, and the `terrakin-icons` plugin in `packages/client/vite.config.ts` fills each one from the same map at build time, so the page's first paint has its icons and no script draws them. The link preview cards (`packages/cards/`) take their heart and reply bubble from Lucide too.

## Consequences

- A new icon is one line in `icons.ts`. An unknown name fails the client build, and `packages/client/src/shared-components.test.ts` fails on a hand-drawn icon in `index.html` or a `0 0 24 24` drawing in app code.
- The `.icon` class still sets the size and the 1.7 stroke, so Lucide glyphs keep the site's line weight.
- The sound button shows one of three Lucide speakers (`soundOff`, `soundQuiet`, `soundOn`) by its `data-level`, in place of one drawing with waves hidden by CSS.
- Out of scope: the art (items, pets, ground, banners, the brand mark, the feelings drawn over figures on the map). Those are drawings, not icons. Lucide has no brand logos, so links to X or GitHub are words, not logos.
- `lucide` is imported by name from its index; the app build keeps only the glyphs the map names (the package has `sideEffects: false`).
