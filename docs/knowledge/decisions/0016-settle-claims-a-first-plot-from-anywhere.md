---
title: Settle claims a first plot from anywhere
date: 2026-10-04
status: accepted
tags: [sim, design, agents]
---

# Settle claims a first plot from anywhere

## Context

A test run of the First visit found three costs that had nothing to do with play. Walking from the Commons to a plot is one rate-limited request per tile. The starter hut, built by hand with a reach of 3, takes 15 `place` calls plus a hearth and some walking. And two partners who want to live next to each other, or in one home, had no way to do it short of one of them owning everything.

Terrakin is meant to work as a daily space for a couple and their assistants, who check in once a day and should spend that time on the parts that are fun.

## Decision

Three new actions, all additive to protocol v1:

- `settle {px, py}` claims an unclaimed, non-Commons plot from anywhere and lands you on its center tile (or the nearest free tile) in one step. It works only for your first plot. Later plots still need walking and `claim`.
- `build_starter_home {walls?, windows?}` builds the SKILL.md starter hut on your plot server-side, with no reach check. It only touches tiles on that plot, and skips any tile with a block, a hearth, or an online resident on it, so it never displaces anyone. If the builder stands where a wall goes, it moves them onto the hearth tile first.
- `share_plot {with}` and `unshare_plot {with}` let a plot's owner add or remove up to 3 co-owners. Co-owners build, set a hearth, and run `build_starter_home` there as if they owned it. It doesn't count toward their plot limit, and they can't share it onward. Taking a share back also clears the co-owner's hearth on that plot.

## Why

- Same reasoning as [decision 0009](0009-home-is-an-instant-jump-to-your-hearth.md): nothing in Phase 1 depends on distance or effort being costly, and agents and phone players pay real requests and taps for every step.
- `settle` is limited to the first plot so it can't be used to grab land across the map faster than anyone could walk to it.
- `build_starter_home` builds exactly the recipe the docs already teach, so there is no new shape to balance, and the manual recipe stays a valid alternative.

## Consequences

- A plot only carries `coOwners` once it has been shared, and loses the field when the last share is taken back. Worlds that never share hash exactly as before, so `/v1/health` stays stable across the deploy and old logs replay byte for byte.
- `place` now refuses any resident's hearth, not only your own. Before sharing existed only the owner's hearth could be on a plot, so old logs replay the same.
- A plot can now hold several hearths. Clients that drew one hearth per plot need to draw one per resident (the web client already does).
- If a later phase makes land scarce, revisit `settle` with an RFC (for example, only next to an existing plot).
