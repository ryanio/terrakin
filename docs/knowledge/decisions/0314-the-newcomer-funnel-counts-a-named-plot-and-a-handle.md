---
title: The newcomer funnel counts a named plot and a handle
date: 2026-10-19
status: accepted
tags: [admin, server, protocol, onboarding]
---

# The newcomer funnel counts a named plot and a handle

## Context

The roadmap dated a read for 2026-10-19 that asks three things of the staff Newcomers page: of
people with a hearth, the share with a first thing; first jobs taken in a first week; and whether
plot names and handles still get set. The page ([decision 0141](0141-the-newcomer-funnel-counts-first-steps-from-what-the-world-a.md),
[decision 0276](0276-the-newcomer-funnel-counts-a-first-job-beside-the-pet.md)) could answer the
first two and had no row for the third.

The read was taken from `GET /v1/plots` instead. That works, but it sees only residents who hold a
plot, it cannot split a cohort by the week it joined, and it is a different query every time
somebody asks.

## Decision

`NewcomerCounts` gains `plotName` and `handle`, and `NEWCOMER_STEPS` carries them in the order a
newcomer meets them: a named plot after a first thing, a handle after doing something social.

- `plotName` is the check-in's own `plotNamed`, the rule behind the `plot_name` first-visit step:
  a plot the resident can build on has a name now, or they ever sent `name_plot`. One rule, so the
  page and the step can never disagree about who is done.
- `handle` is a handle held now, read from the `handles` table where `released_at = 0`. A handle
  given up does not count, because the name is free for anyone again.

## Consequences

- The dated read is answerable from the page the roadmap names, split by cohort like every other
  step, and it stays counts only: no id, handle, or name reaches the response.
- `plotName` counts a co-owner of a plot somebody else named. That follows from reusing the
  check-in's rule, which is the right trade: one rule beats a second one that drifts. The row is
  called "Has a named plot" rather than "Named their plot" so the label matches, and the page's
  "How each step is counted" says so.
- `plotNamed` scans every plot per resident. At terrakin.org's size (about 60 residents, 48 plots)
  that is nothing; past roughly a million resident-plot pairs, build the set once as
  `newcomerFunnel` already does for `plotHolders`.
- The funnel's counts still are not nested, so "of people with a hearth, the share with a first
  thing" is still only approximated by things over hearths. A count of residents who reached both
  would answer it exactly, and would be the first count here that is not "everyone who ever did
  this". Left for when somebody needs it.
- Staff routes are internal, so nothing new reaches `openapi.json`, SKILL.md, `llms.txt`, or the
  public changelog.
- Code: `packages/protocol/src/safety.ts`, `packages/server/src/newcomers.ts`,
  `packages/server/src/handlers/safety.ts`, `packages/admin/src/logic.ts`,
  `packages/admin/src/newcomers-view.ts`; tests in `packages/server/src/newcomers.test.ts`.
