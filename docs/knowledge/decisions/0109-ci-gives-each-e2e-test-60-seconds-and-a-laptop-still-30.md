---
title: CI gives each e2e test 60 seconds, and a laptop still 30
date: 2026-10-06
status: accepted
tags: [e2e, ci, tooling]
---

# CI gives each e2e test 60 seconds, and a laptop still 30

## Context

On 2026-10-06 main was red for most of a day, and no deploy went out, because three different specs ran past Playwright's 30-second test timeout on CI: the 3D plot at night, the shop's Halloween step, and the docs page. Each passed locally in 6 to 17 seconds. A CI runner takes two to four times as long for the same spec, and longer when other specs share its CPU, so whichever long test ran beside the others timed out. Splitting each slow test after it fails fixes one spec and leaves the next one to fail.

## Decision

`playwright.config.ts` gives each test 60 seconds when `CI` is set and 30 seconds otherwise. `test.slow()` still triples either.

## Consequences

- A spec that needs more than 30 seconds fails on a laptop before it reaches CI, so the local run is still the guard against slow tests.
- A test that hangs on CI takes up to a minute to fail instead of 30 seconds.
- Splitting a long test into serial tests (as `three-d.spec.ts` and `shop.spec.ts` now do) is still the fix for a test that is slow everywhere.
