---
title: The front page and pulse card count every claimed plot, the townsfolk's too
date: 2026-10-24
status: accepted
tags: [client, home-wall]
---

# The front page and pulse card count every claimed plot, the townsfolk's too

## Context

[Decision 0273](0273-the-front-page-shows-visitors-one-live-line-of-the-town-s-co.md) took the front page's counts from the pulse card, which left the townsfolk out of both numbers: residents and plots. On 2026-10-23 the line read "64 residents, 45 plots claimed" while `GET /v1/world` listed 53 claimed plots, 8 of them the townsfolk's ([issue #109](https://github.com/ryanio/terrakin/issues/109)). A plot a townsfolk resident holds is land nobody else can claim, so "45 plots claimed" undercounted how full the town is.

## Decision

`pulseStats` counts every claimed plot (`plots` in `packages/client/src/pulse.ts`), the townsfolk's included, on the front page's live line and the pulse card's quiet-hour tile alike. Residents still leave the townsfolk out: that number counts people, and the plots number counts land.

## Consequences

- The plots number matches `GET /v1/world`, and it agrees with "blocks placed" on the pulse card, which already counted the townsfolk's building.
- The link world page (`/v1/act/<key>/world`) still says its plot count is "not counting townsfolk", in its own words, so it reads correctly but no longer matches the home page's number.
