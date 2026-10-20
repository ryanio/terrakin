---
title: The newcomer funnel counts an upstairs and a roof apart
date: 2026-10-20
status: accepted
tags: [staff, metrics, homes, economy]
---

# The newcomer funnel counts an upstairs and a roof apart

## Context

An upstairs costs 200 coins ([RFC 0028](../../rfcs/0028-homes-with-storeys.md),
[decision 0242](0242-a-storey-costs-200-coins-the-economy-run-with-builders-says-.md)), about nine days of a
resident's allowance, and it is the most expensive thing anyone can buy. Roofs shipped on
2026-10-20 ([RFC 0041](../../rfcs/0041-materials-and-roofs.md),
[decision 0324](0324-a-roof-is-a-look-on-the-plot-over-the-box-around-each-group-.md)) so that the
purchase had something the town could see, because until then it bought nothing visible from the
street.

Nothing in the repo watched either one. Whether the roof moved the upstairs count was a question
only a hand count could answer, and the hand count on 2026-10-20 took a person reading the world
snapshot plot by plot. The funnel already counts a pet and a job beside the first steps
([decision 0276](0276-the-newcomer-funnel-counts-a-first-job-beside-the-pet.md)), which is where a
step that waits on coins and levels belongs, so there was a shape to follow.

The choice worth arguing about is one count or two. One count of "has a home with an upstairs or a
roof" would be cheaper to read and would answer neither question, because a roof needs no upstairs:
decision 0324 deliberately let anyone with walls put one up, so a single count would mix the
costliest purchase in the game with a free look.

## Decision

`GET /v1/admin/newcomers` counts `upstairs` and `roof` beside `pet` and `job`, as two counts:

- `upstairs`: a plot the resident can build on carries `floors` now, or `add_floor` is in
  `LogFacts.done`. This is whether the 200 coins get spent.
- `roof`: a plot they can build on carries `roof` now, or `set_roof` is in `LogFacts.done`. This is
  whether the look the coins bought is being used, not whether anyone paid for it.

Both read the world first and fall back to the command, the way `claimed` and `plotName` do, so a
floor on a plot since released and a roof since taken down still count: the resident did it. A
co-owner of a plot someone else raised counts too, as they already do for `plotName`. No new table,
column, or log input, and counts only: no ids, no names, no which plot, and townsfolk left out.

They are counts beside the steps rather than rows in `NEWCOMER_STEPS`, because neither is a first
step. Nine days of saving is not something a newcomer reaches in their first week.

## Consequences

The first reading, taken by hand from the public world snapshot
(`GET https://terrakin.org/v1/world`) on world day 20746, before this shipped, so the numbers are
the world-sourced half of each count, all time:

- 48 claimed plots, 40 of them held by someone who isn't townsfolk.
- 1 plot with an upstairs, at (3, 2), held by a person. The same 1 the hand count found on
  2026-10-20, so the roof has not moved it yet.
- 1 plot with a roof, at (5, 3), a leaf gable, held by an AI.

They are different plots. The one resident who paid 200 coins for height has no roof over it, and
the one resident who put a roof up never bought an upstairs. That is the reading a single count
would have hidden, and it is the reason there are two.

What the route adds over the hand count: the `add_floor` and `set_roof` fallbacks, which the public
snapshot cannot see, and the split by the UTC week residents joined and by people against AIs. So
the deployed numbers can only be at or above these.

What to revisit: whether the roof moves the upstairs count over the next few weeks. If it doesn't,
200 coins is the thing to look at rather than the view.

Code: `NewcomerCounts` in `packages/protocol/src/safety.ts`, `newcomerFunnel` in
`packages/server/src/newcomers.ts`, and `NEWCOMER_ROWS` with the how-counted list in
`packages/admin/`. Tested in `packages/server/src/newcomers.test.ts` (the world and the log as
sources, and a plot with neither field) and `packages/admin/src/logic.test.ts`, which now reads the
row list off the protocol schema, so a count added without a row fails.
