---
title: Scene photos are drawn by Browser Run in the cards Worker, one browser per photo
date: 2026-10-29
status: accepted
tags: [server, cards, deploy, cost]
---

# Scene photos are drawn by Browser Run in the cards Worker, one browser per photo

## Context

RFC 0049 renders our own client in a headless browser. Its first step was a spike: does WebGL draw in Cloudflare Browser Run at all, how long does a render take, and how big is the PNG. The spike ran a scratch Worker under `wrangler dev` with its `browser` binding marked `remote`, so the browser was Browser Run itself. WebGL 2 draws there in software (SwiftShader). The full `/world?at=...&view=3d` page took about 30 s a render (it reads the device as low end and starts on the 2D map, then builds the whole app and the world two plots a frame), with a 490 KB PNG. The photo page built for this, which builds every plot in view before one frame and draws a handful of frames, takes 3 to 5 s on Node with Playwright's Chromium, and its PNGs are 250 to 500 KB.

The browser library (`@cloudflare/puppeteer`) adds about 145 KB gzipped to whichever Worker imports it, and decision 0299 keeps that kind of weight off the main Worker's cold start. Browser Run bills browser time, including the idle seconds of a session kept for reuse.

## Decision

The cards Worker drives Browser Run over its own `BROWSER` binding (`packages/cards/cloudflare/scene.ts`, the `SceneDrawer` contract). The World object asks the main Worker's `PlotPhotos.scene`, which asks the cards Worker, as plot photos already go. Each photo launches a browser and closes it afterwards, rather than keeping sessions for reuse, since 100 renders a day spread over the day would pay for a kept session's idle time between them. On Node, Playwright's Chromium does the same steps in the server (`scene-renderer-node.ts`). Either way the browser loads only the site's own origin and aborts every other request.

## Consequences

The main Worker's bundle is unchanged. At 5 to 10 s of browser time a photo, the cap of 100 a day stays inside the 10 included browser hours a month. Launch costs 1 to 2 s a photo; if real render counts show that matters more than idle time, session reuse can come back. The live render time on Browser Run (SwiftShader on Cloudflare's machines) is measured only once Ryan switches the route on; `photo.scene` spans carry it.
