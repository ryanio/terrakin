---
title: A land plan is refused when, fully claimed, a plot has no way out onto a street joined to the bridge and the counter
date: 2026-10-22
status: accepted
tags: [server, lands, walking, homes]
---

# A land plan is refused when, fully claimed, a plot has no way out onto a street joined to the bridge and the counter

## Context

`open_land` is logged forever, and the sim can't tell whether a plan is any good: to it a bridge, a plot list and a street list are lists of tiles. The planner's old check only walked from downtown to every slot of the land, and the 5 by 5 island passed it while leaving 15 plots surrounded once full. Ryan's call 2 on [RFC 0046](../../rfcs/0046-streets.md) was that the island waits for its streets rather than open the 5 by 5.

## Decision

`planProblem` in `packages/server/src/lands.ts` refuses a plan, and `planLand` then opens nothing and logs one line saying why, when any of these holds:

1. It has no streets. This is checked first and on its own, so no tuning of `LAND_PLAN` and no other caller can bring back an island without them.
2. The sim refuses it, or a walk from the Commons doesn't reach every slot it brings.
3. With every plot of the new land counted as claimed, along with every plot already claimed anywhere, the public ground walked from the bridge's island end doesn't come within reach of the land's counter, or some plot has no way out (`openingsOf`, walked from every tile, as a claim's notes walk a plot with no hearth) onto that ground.

## Consequences

The Worker's automatic opening and the test route both go through `planLand`, so there is no path to an island without streets. `lands.test.ts` in the server pins the long cross against the RFC's drawing, that every name the town has opens with streets, and each refusal with its words.

A plan that fails stops the town opening land until someone fixes `LAND_PLAN`, which the warning line says. That is the failure we want: a newcomer waits a little, rather than settles on a plot a neighbor can shut.
