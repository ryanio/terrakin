---
title: The staff app imports the sim directly for lengths of time
date: 2026-10-27
status: accepted
tags: [admin, sim, dependencies]
---

# The staff app imports the sim directly for lengths of time

## Context

Lengths of time (`MINUTE_MS`, `HOUR_MS`, `DAY_MS`) live in the sim's `clock.ts`, and the server, the client, and `packages/ui` read them from there. The staff app reached the sim only through `packages/ui` and the protocol, so its log and cohort headings wrote `86_400_000` by hand. The other ways to reach the constants were a re-export from `packages/ui` or the protocol, which would make a second place to import them from.

## Decision

`packages/admin` lists `@terrakin/sim` as a dependency and imports the clock from it, as the client does. The dependency map in the root `AGENTS.md` says the staff app imports the sim directly.

## Consequences

The sim depends on nothing and is free of side effects, so the staff app's bundle gains only what it imports. Anything else the staff app needs from the sim can come straight from it too, rather than through `packages/ui`. `packages/client/src/shared-components.test.ts` fails on a hand-written length of time in any package but the sim's pinned fixture logs. Code: `packages/admin/src/logic.ts`, `packages/admin/package.json`.
