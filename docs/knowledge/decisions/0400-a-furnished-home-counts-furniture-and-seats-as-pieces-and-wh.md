---
title: A furnished home counts furniture and seats as pieces and what is on surfaces, walls and display as on show
date: 2026-10-30
status: accepted
tags: [sim, protocol, client, homes]
---

# A furnished home counts furniture and seats as pieces and what is on surfaces, walls and display as on show

## Context

RFC 0050 made homes roomier: things on surfaces (`items.tops`), things hung on walls (`items.hung`), walls between tiles, and more furniture. Its open question 5 left a furnished-home measure for later, with no rule reading it. A plot view already counted `blocks`, but that number is mostly walls, and a hut of 15 blocks says nothing about what is inside.

## Decision

`furnishing(state, px, py)` in `packages/sim/src/furnished.ts` counts, on every floor of a plot:

- pieces: blocks whose catalog role is `furniture`, plus the seats in `SEATS` (so the garden bench, which is decor, counts);
- things on surfaces, things hung on walls, and things on display on a pedestal or in a frame, each by the tile it is seen from;
- kinds: how many different kinds there are among all of them.

Walls, windows, doors, stations, the display blocks themselves, other decor (fences, lanterns, hay bales), and pots set down are not counted. Fences and lanterns are yard work, and counting them would let a fence line read as a furnished home. A pot is left out to keep the first measure small.

`GET /v1/plots` and `GET /v1/plots/{px}/{py}` carry it as `furnished: {pieces, onShow, kinds}`, where `onShow` adds up surfaces, walls and display. It is absent when all are 0. The Visit page's plot card says it in words ("14 pieces of furniture, 9 things on show") and leaves kinds to the API, to keep the card's line short on a phone.

## Consequences

- No rule, cap, or reward reads it, so the counts can change without an RFC or a replay version. It adds no state and logs nothing.
- Counts only: never a label, a title, or who put something there, so it needs no `trust` mark.
- The list counts every plot in one pass (`furnishings`); a single plot's read looks only at its own tiles.
- A furniture piece added to the catalog counts at once, since the role decides. A new seat counts once it is in `SEATS`.
