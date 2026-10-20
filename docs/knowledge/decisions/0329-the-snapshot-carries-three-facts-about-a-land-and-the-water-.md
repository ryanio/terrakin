---
title: The snapshot carries three facts about a land and the water is what is left
date: 2026-10-20
status: accepted
tags: [protocol, client, server, lands]
---

# The snapshot carries three facts about a land and the water is what is left

## Context

[RFC 0038](../../rfcs/0038-new-lands.md)'s first slice put new lands in the sim and left them dark
([decision 0326](0326-an-island-is-a-region-of-the-same-plane-and-water-is-what-is.md)): the rules
knew about an island, the water and the bridge, and nothing on the wire did. A client could not
know an island existed, and would let someone try to walk onto water and be refused by the server.
This is the API and the web, rollout steps 2 and 3.

The questions it forced: what shape the snapshot carries, whether the picker sends a newcomer
downtown or across the water while both have room, and who plans an island's geometry.

## Decision

**The snapshot carries three facts, not a map.** `lands` is `home`, the rectangle downtown is, and
for each open land its `name`, its claimable plot `plots`, and the `bridge` tiles that cross to it.
Water is derived from those: in bounds, outside `home`, on no land's plots, not a bridge. One
function answers it for the rules and for the web, the sim's `seaFrom`, built from the facts rather
than from state. The alternative was to send the water as tiles, which for one 8 by 72 channel is
576 of them in every snapshot, growing with every land, for a thing that is the absence of land.
A client that ignores `lands` draws what it always drew.

**Coordinates are named as the rest of the snapshot names them**: `px`/`py` for plot slots, `x`/`y`
for tiles. The sim keeps `[x, y]` pairs, so `toWire` reshapes `land_opened` on its way out. One
shape for the same facts on the wire is worth a map in one function.

**Nothing lies on the water.** `pickupOn` takes the sea as a fact, so no branch, stone or find is
on it to gather and no client draws one floating there. This changes no logged replay: every sea
tile is ground an `open_land` brought in, since a tile in bounds before one opened is downtown.

**The plot picker fills downtown first**, which answers the RFC's open question 2. Island plots are
offered, last, named by their land ("On Willowmere, across the bridge"), so the center fills and
the island opens with a reason. The water between is never offered, because the picker asks the
sim's own `settleProblem` with `onLand` rather than deciding for itself.

**The server plans a land and the town names it.** `planLand` works out the geometry when the
claimable plots left fall to `LANDS.openAt` (9, a count, never a date), and every number of it goes
in the logged `open_land`, so replay never plans anything and tuning the plan cannot change how a
logged land replays. The names are a fixed table in server config beside the sim's `JOB_GIVERS`, so
a land's name is never a resident's words. It is the one switch in the server's day table that can
come due more than once, each time the count falls again.

## Consequences

Every world reads exactly as it did, because `lands` is absent until a land opens and no adapter
sets the `lands` option: terrakin.org, self-hosting, `pnpm dev` and the e2e servers all stay one
grid. So there is no end-to-end journey to add yet, and the water is proven where it is decided: a
sim test for the rule, a server test for the wire and the count, a client test for the mirror, the
route over the bridge and the picker.

`seaFrom` returns undefined with no lands, so `groundOf` is handed nothing and a world of one grid
builds the ground it always built. `plotsLeft` reads the Commons from `lands.home` rather than the
grown config, which is the one place that reads downtown correctly today.

What this does not settle: the town centre still moves when the world grows (decision 0326's own
correction), and until that is pinned to `lands.home` no land may open. The counter and the hall
each island gets are the island-doors slice. A ferry, a second commons, and whether 25 plots is the
right size for a first island are all still the RFC's.
