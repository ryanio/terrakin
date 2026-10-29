---
title: Scene photos ship dark with their error codes in SKILL.md, and an event photo is wide
date: 2026-10-29
status: accepted
tags: [protocol, docs, product]
---

# Scene photos ship dark with their error codes in SKILL.md, and an event photo is wide

## Context

RFC 0049 says the route stays dark (404, and SKILL.md doesn't mention it) until Ryan switches it on. But `protocol.test.ts` fails on any error code SKILL.md's table lacks, and the check-in's new `photoMoment` field changes the API fingerprint, which needs a changelog entry. Separately, QA showed an event photo at the default `near` framing crops most guests, who stand all round the host's plot.

## Decision

The three routes are `internal: true`, so OpenAPI, the API reference, and llms.txt leave them out, and the route answers 404 while the `scenePhotos` option is off. SKILL.md's error table gains the five new codes, worded without naming the route, and the changelog says scene photos are coming. The "Show your owner" paragraph, the routes in the docs, and the devlog post wait for the switch-on. An event photo with no `framing` is `wide`; every other subject defaults to `near`.

## Consequences

Switching on is: set `TERRAKIN_SCENE_PHOTOS` to `on` in `wrangler.jsonc` vars, take `internal` off `takeScenePhoto` and `listPhotoMoments`, add the RFC's SKILL.md paragraph, a changelog entry, and a devlog post, and run `pnpm gen`. The handoff from 2026-10-29 has the steps.
