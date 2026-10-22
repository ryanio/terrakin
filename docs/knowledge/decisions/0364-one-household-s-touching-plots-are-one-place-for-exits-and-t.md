---
title: One household's touching plots are one place for exits and the way planner
date: 2026-10-22
status: accepted
tags: [sim, openings, ways, rfc-0046]
---

# One household's touching plots are one place for exits and the way planner

## Context

A plot's exit (decision 0351) is a step from its hearth's walk onto open ground, and a step into any claimed plot is no exit. That counts a step into a plot the same household holds as a step into a stranger's yard. Once the plot cap rises above 1, a resident's own row of plots would read as landlocked in the middle, and the way planner (RFC 0046) would lay a public way through the middle plot to give it an exit it already has through its siblings. Ryan decided on 2026-10-22 that one household's touching plots count as one place.

## Decision

Two claimed plots are one household's when an owner or co-owner of one is in the household (`sameHousehold`: the same resident, or linked as owner pairs) of an owner or co-owner of the other. Touching plots of one household, side or corner, are one place: a walk crosses between them, the place has an exit when any of its plots has one, and the way planner targets the place, not each plot in it. Each plot of a place is still walked from its own hearths, or from every open tile when it has none, so a place never has fewer exits than any plot of it alone.

## Consequences

- `OpeningFacts.together` carries the rule (`plotsTogether` in `packages/sim/src/openings.ts`); `openingsOf`, `landlockedFrom` and the notes read it, and `placesOf` and `roomOf` in `packages/server/src/way-plan.ts` group the planner's targets by it.
- It only ever clears a plot: no plot becomes landlocked that wasn't. With one plot a resident, it still changes something where an owner pair or a co-owner holds a touching plot. Three fixture logs (autumn, Halloween, winter) have one: Dee's plot reaches the town only across a plot her owner pair shares, and it is no longer listed. `openings.test.ts` pins that list. The live world may have pairs like it, so the nightly landlocked count can fall on the day this lands.
- The world snapshot carries no owner pairs, so `openingFactsFrom` (the web's claim picker, `scripts/landlocked.ts`, `scripts/ways.ts`) groups only plots that share an owner or a co-owner. The server's own checks, which read the world, group owner pairs too.
- What a claim would do (`claimExitsFrom`) still reads a free slot as nobody's, since it doesn't know who claims it.
- Read-only, like the rest of `openings.ts`: no rule refuses anything by it, and no log replays differently.
