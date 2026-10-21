---
title: "New lands are armed at terrakin.org: the Worker watches the count"
date: 2026-10-20
status: accepted
tags: [server, deploy, lands, world]
---

# New lands are armed at terrakin.org: the Worker watches the count

## Context

[RFC 0038](../../rfcs/0038-new-lands.md) is built: the sim, the API and the web all carry islands,
the water and the bridge, and every island brings a shop counter and a Town Hall door of its own
([decision 0332](0332-every-island-gets-a-counter-and-a-hall-door-of-its-own-on-a-.md)). The last
slice was a `lands` option on `WorldService` that no adapter set, held back on two prerequisites
that are now done: the town centre is pinned to downtown whatever the world grows to, and an
island resident can shop and file without crossing the water.

Downtown is 9 by 9, 80 claimable. On 2026-10-20 there were 48 claimed and 32 free, filling around
mid-November at about 1.5 claims a day. A full grid means a newcomer with nowhere to settle, which
the RFC calls the one thing Terrakin must never do to someone who wants in.

## Decision

The Worker sets `lands: true`. The Node server does not, so self-hosting, `pnpm dev` and the e2e
servers stay one grid.

**Setting it opens nothing.** It arms the watcher: `tick()` reads the claimable plots left and the
town opens its first island only when they fall to `LANDS.openAt`, which is 9. That was about 23
claims out when this was armed, so there are roughly two weeks of warning in the plot count before
anything happens.

The land it will open is `LAND_PLAN`'s, the RFC's own recommendation: five plots square, one
plot-width of water east of downtown's edge, bridged at the Commons' latitude, with the middle slot
as its square. Every number is in the logged input, so replay never plans anything and a better
planner later can't change how this one replays.

## Consequences

It will fire with nobody watching. That is the cost of arming it, and it is the right side of the
trade: a newcomer turned away is worse than an island that opens unobserved. Three things make it
safe to leave alone.

`planLand` walks the whole island before it will open it. Not the bridge's two ends, which was the
old check and misses a plot joined to its island only at a corner, where no step crosses and
whoever settles it is stranded. It walks from the first standable tile of the Commons to every slot
the land brings and the square, and refuses the plan whole if any is unreachable.

A refused plan says so. An undefined command is dropped by `switchOn` exactly as "not due yet" is,
so without a line a town that had stopped opening land would look like a town that didn't need to.

The first island is `LANDS_TO_OPEN[0]`, fixed words in the code, so a land's name is never a
resident's text.

Two of the RFC's open questions are answered by this rather than by reading: whether 25 plots is
right, and whether the plot picker should send newcomers downtown or across. Both were recommended
in the RFC and both are what the code does. The honest answer to each still comes from watching the
first week after it opens, and that week now starts on its own.
