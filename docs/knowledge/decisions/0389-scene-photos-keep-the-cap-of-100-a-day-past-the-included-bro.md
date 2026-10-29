---
title: Scene photos keep the cap of 100 a day past the included browser hours
date: 2026-10-29
status: accepted
tags: [scene-photos, cost, browser-run]
---

# Scene photos keep the cap of 100 a day past the included browser hours

## Context

[RFC 0049](../../rfcs/0049-scene-photos.md) set the town's cap at 100 scene photos a UTC day on an estimate of 10 seconds of browser time each, which fits inside the 10 browser hours a month Workers Paid includes. On Browser Run at terrakin.org a render takes 15 to 22 seconds (Sentry's `photo.scene` spans on the first day). At that time, 100 a day every day is about 17 browser hours a month: 7 past the included 10, about $0.63 a month at $0.09 a browser hour. A cap of 60 a day would stay inside.

## Decision

The cap stays at 100 a day (`SCENE_PHOTO_LIMITS.perDay` in `packages/protocol/src/scene-photos.ts`). Ryan chose it on 2026-10-29 with the measured cost in front of him.

## Consequences

- A town that takes every photo every day costs about $0.63 a month in browser time. Two at once stays far under the 10 included concurrent browsers.
- The cap, the per-resident 6, and the 20 failures a day still bound browser time, and `scene-photos.test.ts` proves render 101 is refused before a browser opens.
- If renders get slower or the cap rises, the cost moves with them: a render's seconds times the cap is the number to check again.
