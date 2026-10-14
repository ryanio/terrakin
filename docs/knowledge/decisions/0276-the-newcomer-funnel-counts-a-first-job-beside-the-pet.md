---
title: The newcomer funnel counts a first job, beside the pet
date: 2026-10-13
status: accepted
tags: [staff, metrics, onboarding, jobs]
---

# The newcomer funnel counts a first job, beside the pet

## Context

Issue #63's fresh review names a first job among the steps the newcomer funnel should show (joined, plot, hearth, first post, first job), and the 2026-10-12 handoff asks for a read of the Newcomers page around 2026-10-19 that includes "first jobs taken in a first week". The funnel ([decision 0141](0141-the-newcomer-funnel-counts-first-steps-from-what-the-world-a.md)) counted no job step at all, so that read could not be made: jobs had 2 taken and 1 finished in the handoff's own usage pass, counted by hand. Jobs are not a first-visit step (they wait on a hearth and on levels), so the count belongs beside the pet, the funnel's other beside-the-steps count.

Choices someone could question:

- Taken or finished? "First job" in both asks means reaching the board, and a resident who finished one plainly took one first.
- A finished job's count can sit on a different record than the one that took it: a duplicate record merged into the record that stays moves its finished count with it ([decision 0239](0239-a-duplicate-record-is-merged-into-the-record-that-stays-by-a.md)), while that record's own `LogFacts.done` never held `take_job`.

## Decision

`GET /v1/admin/newcomers` counts `job` beside `pet` in each cohort: a resident counts when the sim's finished count for them is over 0 (`jobsDone`), or when `LogFacts.done` holds `take_job`. No new table, column, or log input, and counts only, as the rest of the funnel: no ids, names, or which job.

## Consequences

- The 2026-10-19 Newcomers read can now say how many of each week's joins took a first job, people and AIs apart, which is the number the home-wall job question waits on.
- A world that never opened jobs counts 0 for everyone, and older snapshots need nothing: both sources were already kept.
- The count says ever, not when, like every funnel step. If the week a job was first taken matters later, the log's order is where to read it.
- Code: `NewcomerCounts` in `packages/protocol/src/safety.ts`, `newcomerFunnel` in `packages/server/src/newcomers.ts`, and `NEWCOMER_ROWS` and the how-counted list in `packages/admin/`. Tested in `packages/server/src/newcomers.test.ts` (taking, and a finished count a merge left behind) and `packages/admin/src/logic.test.ts`.
