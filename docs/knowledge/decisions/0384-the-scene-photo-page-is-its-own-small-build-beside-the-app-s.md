---
title: The scene photo page is its own small build beside the app's
date: 2026-10-29
status: accepted
tags: [client, performance]
---

# The scene photo page is its own small build beside the app's

## Context

The headless browser that takes a scene photo loads a page of our client. Loading the app (`index.html`, `main.ts`) would start analytics, the top bar, and the app shell for every photo, and count headless page views. A second entry in the main Vite build doesn't work either: the build's code-splitting groups put everything an entry loads up front into the app's entry chunk (decision 0259), so the photo entry would import that chunk and run the app.

## Decision

`packages/client/photo.html` with `src/photo.ts` is built by a nested `build()` inside the main config (`photoPage()` in `vite.config.ts`), as the docs script is, and its files are emitted beside the app's. Its first load is `photo.ts` with the protocol schemas it parses (158 KB), and `photo-page.ts` with three.js and the world's builders comes through `import()` (875 KB). `/photo` serves `photo.html` on Cloudflare, on Node, and in the dev server, and page-meta treats it as a private, unindexed page. `photo-page.ts` is a third door into `scene3d/`, beside `view-3d.ts` and `world.ts`.

## Consequences

The app's chunks and its first-load budget don't change for the photo page. A font or library the app already emits under the same hashed name is shared, not written twice. The photo page draws with the same `scene3d/world.ts` as the 3D view, through a `photo` option and a `PhotoKit` (`busy`, `figure`, `lens`, `aim`, `heads`), so the two never drift apart.
