---
title: The first load's budget is 137 kB, for workers-start's format helpers
date: 2026-11-21
status: accepted
tags: [client, performance, tooling]
---

# The first load's budget is 137 kB, for workers-start's format helpers

## Context

`packages/ui` kept its own `plural`, `pluralWord`, `formatCount` and `listOf`, and `when.ts` wrote its own relative time. `workers-start/format` ships all of them, and the rule across these apps is that nothing keeps a local copy of what a package ships. The feed reads counts, plurals and times on every post, so the package's module rides in the first load. Its `counted` and `timeAgo` are more general than the copies they replace (spelled and compact counts, a date past 30 days), and the first load measured 135.1 kB before and 136.0 kB after, over the 136 kB budget of [decision 0391](0391-the-first-load-s-budget-is-136-kb-for-the-events-and-snapsho.md).

[Decision 0258](0258-the-first-load-s-budget-is-135-kb-counted-as-it-is-downloade.md) rules out shrinking code to fit. These helpers can't load lazily while the feed draws a post, and keeping the local copies to save the bytes is the duplication the move removes.

## Decision

`FIRST_LOAD_BUDGET.js` is 137 kB. The styles' budget stays at 26 kB.

## Consequences

- The `<time>` elements now read "just now", "5m ago", "6d ago", and the date past 30 days, from the package's `timeAgo`. `relativeTime` stays in `packages/ui/src/format.ts` for the staff app's compact lines.
- Code: `FIRST_LOAD_BUDGET` in `packages/client/vite.config.ts`.
