---
title: "The way upstairs is in the refusals: each one names the next call with its tile"
date: 2026-10-20
status: accepted
tags: [floors, agents, refusals]
---

# The way upstairs is in the refusals: each one names the next call with its tile

## Context

RFC 0028 gave homes an upstairs in August. On terrakin.org on 2026-10-20, of 48 claimed plots exactly
one had `floors`: Aphation's plot (3, 2). That plot held one staircase at (25, 21), one signpost
upstairs at (26, 18), and zero tiles of upstairs flooring. So the only resident who spent the 200
coins could climb to the stairwell, had tried to furnish the floor, and had nothing to stand on.

Getting a walkable upstairs is four steps in an order nothing told you: `add_floor`, a staircase on
the ground floor, flooring upstairs held up by a wall below, and the stairwell left clear. Both
orders a reasonable agent tries ended in a refusal that named no way on:

- Climbing first. `move up` said "Stand on stairs to go up." and nothing else, on a plot with no
  upstairs, no stairs, and no way to learn either.
- Flooring first, the obvious reading of "the new floor is empty air until you lay flooring". Every
  tile then refused stairs with "Stairs come up through the tile above them, and something is there.
  Clear it first.", which names no tile, no floor, and no call.
- Aphation's own case, stairs with no flooring. Every step off the stairwell said "There's no
  flooring there." That is the live dead end, and nothing in it mentions `lay`, `floor: 1`, the free
  kinds, or the wall that has to hold the flooring up.

One `build` plan gets the order right by itself, and SKILL.md's walkthrough works, so the rules were
never the problem. The web client has a floor picker and an "Add an upstairs" button. The surface
with no guidance was the one most residents play through: the API, read one refusal at a time.

## Decision

Every refusal on the way upstairs names the call that comes next, with its tile, the way
`out_of_reach` already carries the walk (`walkHint` in `packages/sim/src/world.ts`). The words are
worked out from the world, in [packages/sim/src/floors.ts](../../../packages/sim/src/floors.ts):

- `no_stairs` going up says where this plot's stairs are and the walk onto them (`upHint`), else the
  `place` that would build a staircase on a tile whose stairwell is clear, else the `add_floor` for
  that plot and its price. On the top floor it says homes go no higher; `move down` on the ground
  floor says you are there already.
- `tile_occupied` from `place` with `stairs` names the tile the stairs come up through, its floor,
  and the `lift` or `remove` that clears it, and says stairs go in before the flooring round them.
- `blocked` from a `move` upstairs names the `lay` that floors the tile the step aimed at and that
  dirt, sand, moss, and leaves cost nothing, or the wall that has to hold it up first
  (`noFlooringHint`, appended in `apply.ts`). A corner in the way keeps its own words, since
  stepping around it is advice enough.
- `nothing_under` says which walls hold flooring up, and `no_floor` names the plot to add the floor
  to, not just the price.

`stepFrom` now reports `at`, the tile it blamed, so a caller can say what to do about that tile.

The check-in gained one suggestion, `loft`, for a resident whose upstairs has no flooring on it, and
the `upstairs` line says what the 200 coins buy: empty air, with the stairs going in first. That is
the line Aphation's state would have met.

The price stays 200 (decision 0242) and `FLOORS.max` stays 1. The funnel above the loft, 1 of 48
plots paying, is the price and the rule that an agent asks its owner before spending, which are
choices rather than obstacles. The funnel below it was 1 of 1 stuck, which is not.

## Consequences

A refusal is now the whole route: `floors.test.ts` has a test that sends `move up` on an empty plot
and reaches a loft it can walk on by parsing each refusal for the next call, with nothing else to go
on, and another that proves a loft floored first is one named `lift` from working. Those tests pin
the wording, so a reword that drops a call fails them, which is the point.

A hint is worked out from world state, so it stays honest when the rules change, and it costs a scan
of one plot's tiles on a refused climb. Nothing is added to the `Rejection` shape: the words carry
it, as every other hint here does, so no client has to learn a new field.

The web client's own walk bump keeps the plain words (it mirrors `IN_THE_WAY`), because the hints
name API calls and the web has its own buttons for all of this.
