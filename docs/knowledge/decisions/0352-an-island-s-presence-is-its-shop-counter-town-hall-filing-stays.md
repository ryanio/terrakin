---
title: "An island's presence is its shop counter; Town Hall filing stays downtown"
date: 2026-10-21
status: accepted
tags: [world, lands, town-hall, shop, agents]
---

# An island's presence is its shop counter; Town Hall filing stays downtown

## Context

[RFC 0038](../../rfcs/0038-new-lands.md) could not finish drafting until Ryan picked how an
island gets shop and Town Hall presence, because lands are gated on it: the island slice is
built and armed at terrakin.org ([decision 0341](0341-new-lands-are-armed-at-terrakin-org-the-worker-watches-the-c.md)),
and the first island opens when the free plots downtown fall to 9.

Two answers were on record. On 2026-10-20 Ryan first took the fuller one, and
[decision 0332](0332-every-island-gets-a-counter-and-a-hall-door-of-its-own-on-a-.md) shipped
it: every island brings a square with a shop counter and a Town Hall door of its own, and
filing resolves to the nearest hall. The island-presence brief written the same day
recommended a split instead: commerce local to the island, civic filing kept downtown, so
downtown stays the hub the first grid was always meant to become and every island resident
keeps a recurring reason to travel in.

On 2026-10-21 Ryan picked the split (recorded in
[issue #97](https://github.com/ryanio/terrakin/issues/97)). This decision records that pick
and supersedes the hall half of decision 0332. The counter half of 0332, the square in the
logged `open_land` input, and everything else in it stand as built.

## Decision

**An island opens once it has a working shop counter, and that counter is its presence.**
Buying, selling, and crafting resolve to the island's own counter, as 0332 built them.

**Town Hall filing stays downtown-only.** Proposals are filed in person at the downtown
Town Hall, as they are today; island residents travel in to file. Voting is unchanged: it
was already remote by Ryan's earlier call. A per-island hall is not part of this decision
and can be revisited once an island has residents and a real gathering need.

## Consequences

What gets easier: RFC 0038's drafting finishes against this model, and downtown keeps its
civic gravity instead of thinning into self-sufficient islands.

What it costs, and what is still owed: the code currently serves filing at an island hall
(`nearestHall` in `packages/sim/src/doors.ts`, the hall building on an island square,
`GET /v1/town`'s `you.hall`). That has to change before the first `open_land` is logged on
the live world, and it is tracked as
[issue #98](https://github.com/ryanio/terrakin/issues/98): filing from an island resolves to
the downtown door, and the follow-up decides what an island square's hall building becomes,
keeping the logged input replay-safe (no island has opened on the live log yet). Lands stay
armed in the meantime; at the 2026-10-20 count (32 free) the trigger is weeks away, and
issue #98 must land first.

What to revisit: a second shopkeeper for an island counter stays a townsfolk decision, as
0332 left it, and a per-island hall comes back only with residents and a gathering need
behind it.
