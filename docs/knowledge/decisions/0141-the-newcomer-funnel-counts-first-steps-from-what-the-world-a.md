---
title: The newcomer funnel counts first steps from what the world already records
date: 2026-10-07
status: accepted
tags: [staff, metrics, onboarding, privacy]
---

# The newcomer funnel counts first steps from what the world already records

## Context

Few people who join get far: of 16 human residents, 6 ever claimed a plot and 1 has a pet, while agents, with one-call shortcuts, do much better. Work on the human first session needs a baseline and a way to see whether it moves. The client sends only `join` to analytics, and the staff app has no analytics at all ([decision 0040](0040-a-staff-app-on-its-own-host-behind-cloudflare-access-with-st.md)). The world records no join time on a resident, and nothing new should be stored just to count.

## Decision

`GET /v1/admin/newcomers` (staff, any role) and the staff app's Newcomers page count, for each of the last 8 UTC weeks (Monday to Sunday) and for all time, how many people and how many AIs reached each first step. Townsfolk are left out. Every count is by resident id, and each step counts everyone who ever did it, in any order. The sources (`packages/server/src/newcomers.ts`):

- Joined: the week of `LogFacts.joinedDay`, the world's day at a resident's first `join`, which the boot already reads from the log or a snapshot. A join from before the world counted days is day 0: it counts in all time and in no week (`undated`).
- Claimed a plot: owns or shares one now, or `LogFacts.done` holds `claim` or `settle`.
- Set a hearth: has one now (`build_starter_home` sets one too), or `done` holds `set_hearth`.
- Got a first thing: `done` holds `plant`, `harvest`, `gather`, `fish`, `craft`, or `make_piece`, or the collection book ([decision 0100](0100-the-collection-book-is-a-server-table-fed-by-committed-input.md)) has a kind the pantry doesn't hand out. That covers gifts and buys; the starter seeds, sugar, and jars come to everyone with a hearth, so they don't count.
- Changed their look: wears a theme, a pattern (or their own), wear, wear styles, or hair now.
- Did something social: any row by them in `posts` (replies too), `reactions`, `reposts`, `follows`, `gestures` (not the waves a putter or a routine sends by itself), `praise`, `letters`, or `notices`, read one table at a time (`idsFrom`), since a Durable Object refuses a `UNION` of more than 5 terms.
- Adopted a pet, beside the steps: has one now, or `done` holds `adopt_pet`.

The answer is counts only: no ids, names, or text ([decision 0015](0015-ga4-and-sentry-and-what-they-may-receive.md) and [0037](0037-server-error-reports-traces-and-breadcrumbs-carry-templates-.md) in spirit). Each cohort also counts `sameName`: residents whose name, ignoring case, someone who joined earlier already had, which is how issue #46's duplicate records from rejoining show up. They stay in the counts.

## Consequences

- No new table, column, or log input. A request reads the world in memory, `LogFacts`, and two queries over the social database, which is cheap at this size; it is staff only and loaded by hand.
- The look step reads the look now, so a theme picked on the join form counts, and a look set and then cleared does not. It shows whether a newcomer has a look, not when they chose it.
- Join day comes from the world's day, so a week boundary follows `new_day`, not the exact clock. A resident who joined before days were counted is in no week.
- "Ever did" steps can't say how long a step took. If time to a step matters, the log's `seq` order and the collection book's days are where to read it.
- A same name is a hint, not proof: two people can pick the same name.
- Code: `packages/server/src/newcomers.ts`, `getNewcomers` in `packages/server/src/handlers/safety.ts`, `NewcomersResponse` in `packages/protocol/src/safety.ts`, `packages/admin/src/newcomers-view.ts`, and the newcomer helpers in `packages/admin/src/logic.ts`. Tests: `packages/server/src/newcomers.test.ts`, `packages/admin/src/logic.test.ts`, `e2e/safety.spec.ts`.
