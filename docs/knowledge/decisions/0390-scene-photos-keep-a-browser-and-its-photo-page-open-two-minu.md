---
title: Scene photos keep a browser and its photo page open two minutes after each photo
date: 2026-10-29
status: accepted
tags: [scene-photos, browser-run, performance, cost]
---

# Scene photos keep a browser and its photo page open two minutes after each photo

## Context

A scene photo ([RFC 0049](../../rfcs/0049-scene-photos.md)) took 15 to 22 seconds on Browser Run. Timing each step of the photo page locally in Chromium with software WebGL showed where it goes: loading the page and the world is under 0.1 s, and compiling the scene's 24 drawing programs is about 3 s, because a headless browser has no GPU and compiles them in software. Browser Run runs a fresh browser for every photo, so every photo paid for that on slower machines. Drawing the frame itself is a few hundred milliseconds once the programs exist.

Drawing without a browser was ruled out: three.js 0.186 draws only through WebGL2, a Worker has none, and a software renderer of our own would be a second copy of the 3D look to keep in step with the client's.

## Decision

A browser stays open two minutes after its photo (`SCENE_PHOTO_LIMITS.warmMs`), and so does its photo page, which takes the next ticket in place with `photoNext(ticket)` and keeps its 3D stage, so its drawing programs stay compiled. Ryan chose two minutes over keeping one browser open all the time (about $64 a month) on 2026-10-29.

- Browser Run closes the browser itself once it has sat idle `keep_alive` milliseconds, so nothing has to remember to close it.
- The World object remembers up to two open browsers (`WarmBrowsers` in `packages/server/src/warm-browsers.ts`, as many as take photos at once) and offers one only while it's 15 s clear of its idle limit. Each is used by one photo at a time.
- The cards Worker (`packages/cards/cloudflare/scene.ts`) reconnects to it, finds its photo page, and asks it for the next photo, giving it `warmTryMs` (10 s). When the browser is gone, too slow, or its page says no, a new browser is opened. When the page itself says it couldn't draw, no new browser is tried, since it would fail the same way. A browser whose photo failed is closed, so a broken one is never asked again.
- A photo page says no to `photoNext` once it's `pageLifeMs` (10 minutes) old, so a deploy reaches it, and a page whose GPU context was lost fails its photo rather than store a blank one.
- The Node renderer keeps its photo pages the same way, so `pnpm dev:test` and the e2e suite run the same page code.
- A photo's stage is still: it never draws on its own, and the page draws the one frame it needs.

## Consequences

- Locally, the first photo through the route takes about 6 s with a fresh browser and the next ones 0.4 to 1.1 s. On Browser Run a reconnect to an open browser and a new screenshot took 1.7 to 1.9 s from a laptop. The live numbers are to be read from Sentry's `photo.scene` spans once photos are taken.
- The first photo after a quiet spell is as slow as before.
- Browser time grows by up to two minutes per photo that comes alone: at the cap of 100 a day, all alone, about $9.50 a month past the included hours. Photos that come in bursts share their minutes.
- The photo page is now long lived, so anything it keeps between photos (the 3D world, its stage) has to come out of each photo the same as from a fresh page. The QA was five photos in a row of different subjects and framings, each drawn as a fresh page draws it.
