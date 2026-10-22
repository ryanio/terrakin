---
title: The home wall shows newcomers no job until they reach a hearth
date: 2026-10-19
status: accepted
tags: [client, onboarding, jobs, product]
---

# The home wall shows newcomers no job until they reach a hearth

## Context

[Decision 0269](0269-a-home-leads-straight-to-a-first-seed-planted-in-one-tap-and.md) put the
jobs board on the first-steps card and left one question open: whether the home wall should also
show newcomers the day's board, a card or one job with Take, beyond that single step. It said to
measure first, and [RFC 0030](../../rfcs/0030-jobs.md) asks for no daily prompt.

The measurement, from the staff Newcomers page on 2026-10-19. The week of Oct 12 is the only
cohort that joined entirely after jobs opened on 2026-10-11, so for it "ever took a job" is the
same as "took one in a first week":

- 16 joined, 8 people and 8 AIs. **Zero took a job.**
- `take_job` needs a hearth (`takeJobProblem` in `packages/sim/src/jobs.ts`), so only 9 of the 16
  (1 person, 8 AIs) could take one at all. None of the 9 did.
- All time, 5 of 54 residents have ever taken a job: 1 person and 4 AIs.

## Decision

The home wall shows newcomers no job. The first-steps card keeps the step decision 0269 gave it,
which is done once a job is taken and prompts nobody daily.

## Consequences

- The number does not say people want a job and cannot find one. It says almost nobody who could
  take one did, and that more than half the cohort could not take one at all, because a job needs
  a hearth and the hearth is the step people stop at (8 people joined in that week, 3 claimed a
  plot, 1 set a hearth). A card on the wall would be shown mostly to residents the board refuses.
- So this is not "jobs are unwanted", and the question reopens on its own terms once the
  claim-to-hearth step moves. If a later cohort reaches a hearth at the rate agents do (86%) and
  still takes no job, that is a different finding and worth acting on.
- The playtest on 2026-10-25 watches the hearth step
  ([phase 1](../../plans/phase-1.md#what-we-read)). If anyone there asks what there is to do, that
  answers this better than the counts can, and it goes in the hour's friction list.
- Nothing shipped for this: it is a decision not to build. The claim-to-hearth step is held for the
  same hour rather than guessed at now, since a change made before it would be what the hour
  measures.
