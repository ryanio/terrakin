---
title: Day and night is presentation, anchored by the server clock
date: 2026-10-04
status: accepted
tags: [sim, protocol, client]
---

# Day and night is presentation, anchored by the server clock

## Context

The world needed a day and night cycle that every player sees at the same moment. The sim can't read a clock (decision 0003), and putting time into `WorldConfig` or the log would mean logging a tick for something no rule uses yet.

## Decision

Day and night is cosmetic. The world snapshot carries an optional `time { nowMs, dayLengthMs }` taken from the server clock when the snapshot is built. Clients advance it with their own monotonic clock and draw a tint. The sim never sees it.

## Consequences

- Replay stays deterministic, and the world hash doesn't change with the time of day.
- `time` is optional in the protocol, so a client still works against a server without it (it just never gets dark).
- If a game rule ever depends on time of day, time must enter the sim as a logged input. Nothing may read the snapshot anchor to decide a rule.
- Code: `packages/server/src/world-service.ts` (`DAY_LENGTH_MS`, `snapshot()`), `packages/client/src/time.ts`, `packages/client/src/render.ts`.
