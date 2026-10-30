---
title: The first load's budget is 136 kB, for the events and snapshot fields of things on tables and walls
date: 2026-10-30
status: accepted
tags: [client, performance, tooling]
---

# The first load's budget is 136 kB, for the events and snapshot fields of things on tables and walls

## Context

Slice 1 of [RFC 0050](../../rfcs/0050-roomier-homes.md) adds four world events (`put_on`, `taken_off`, `hung`, `unhung`), two snapshot fields (`tops`, `hung`), two item categories, and eighteen catalog kinds. The first load parses every world event and the snapshot, so all of it rides in `schemas.ts` and the sim's catalog, which the first load already holds whole. The build measured 135.2 kB of script against a budget of 135.0 kB.

[Decision 0258](0258-the-first-load-s-budget-is-135-kb-counted-as-it-is-downloade.md) rules out shrinking code to fit, and says a change that doesn't fit is loaded lazily, fixed by a cut that makes sense on its own, or met by raising the budget with a reason. None of these schemas can load lazily while the feed reads world events.

## Decision

`FIRST_LOAD_BUDGET.js` is 136 kB. The styles' budget stays at 26 kB.

## Consequences

- The next feature that grows the first load meets the same wall within a kilobyte. The cut decision 0258 already named is the way back: the 66 action request schemas and `Action` sit in `schemas.ts` and never run in the first load (about 2 to 3 kB gzipped). Moving them to a module of their own, with `ClientMessage`, takes them out, as long as nothing the first load imports reaches them.
- Code: `FIRST_LOAD_BUDGET` in `packages/client/vite.config.ts`.
