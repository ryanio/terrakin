---
title: New lands are laid out with streets logged in open_land, and the first island is the long cross
date: 2026-10-22
status: accepted
tags: [sim, server, protocol, client, lands, walking, homes]
---

# New lands are laid out with streets logged in open_land, and the first island is the long cross

## Context

The first island as RFC 0038 planned it was 5 by 5 plots around a square. Filled, 15 of its 24 plots would have had no way out ([decision 0351](0351-a-plot-s-way-out-is-a-step-from-its-hearth-s-walk-onto-groun.md)), and the bridge landed on a plot, so whoever claimed it could wall the island off from downtown. [RFC 0046](../../rfcs/0046-streets.md) compared lanes inside plot slots, whole street slots, and canals. Ryan accepted it on 2026-10-22 and picked the long cross.

## Decision

A street is a whole plot slot that belongs to a land, is ground rather than sea, and that nobody claims or builds on. `open_land` carries an optional `streets` list, sorted like `plots`; the server's planner works it out and replay never does. A land opened without it has none, so every older log replays as it did and `REPLAY_VERSION` doesn't move.

- `landedFrom` counts a street as land, so it is never sea, and the snapshot carries `streets` on each land and on `land_opened`.
- `settle` and `claim` refuse a street with the Commons' code, `plot_is_commons`, and words that name the land's street and the nearest free plot. No new error code, since the next move is the same: pick another plot.
- `plotsLeft`, `landPlots`, `nearestFreePlot`, the server's plot suggestions, the link world page and the web's claim picker leave streets out. `settleProblem` takes `street` as a required fact, so a reader that forgets it is a type error.
- `nearestCounter` and `nearestPark` count a street as its land's (`landOfSlot`), so someone on an island street is sent to that island's square.
- `open_land` holds a street to a plot slot's rules (in the new bounds, on no land already, none of the land's plots, not under the bridge or the square), and the square must touch its land side on, where its land is its plots or its streets.
- `openings.ts` needs no change: a street is an unclaimed slot, which decision 0351 already counts as open ground.

The planner (`planLand` in `packages/server/src/lands.ts`) lays the long cross: a street east from the bridge, a street north and south through the middle, the square where they cross, and a plot on each side of every street slot. On terrakin.org's 9 by 9 downtown that is 24 plots and 14 street slots in 7 by 9 slots, the bridge on the west street, and the next land laid the same way off the east street's end. Every plot has a whole side on a street.

Whole slots rather than lanes because a plot is its slot everywhere in the sim and the views (designs, photos, roofs, the map), and an island's land is not scarce. Streets rather than canals because a canal's boardwalks are over the bridge cap. Both are argued in the RFC.

## Consequences

The island spends 14 slots of land on streets, so plots are 24 of the 39 slots it uses, and it is a plus shape with sea in its corners. The web draws a street as cobbles, for drawing only ([decision 0358](0358-a-public-way-is-tiles-of-a-plot-that-hold-no-block-laid-by-t.md)).

`src/fixtures/streets-log.ts` opens a small long cross, claims every plot, and walks from a plot to the counter and on to the bridge without stepping on anyone else's plot; `streets.test.ts` pins its hash and every refusal.
