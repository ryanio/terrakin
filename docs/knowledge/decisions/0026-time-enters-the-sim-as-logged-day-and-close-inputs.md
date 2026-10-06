---
title: Time enters the sim as logged day and close inputs
date: 2026-10-04
status: accepted
tags: [sim, server, town]
---

# Time enters the sim as logged day and close inputs

## Context

The Town Hall (RFC 0004) needs time: plots must be 3 days old to vote, residents must have acted in the last 7 days, and proposals close after 2 days. The sim can't read a clock (decision 0003), and old logs must replay to the same hash.

## Decision

- The server appends `new_day {day}` (UTC days since 1970-01-01) as `TOWN_ACTOR` when a UTC day starts: on boot, on every request, and once a minute (the sweep). Missed days are skipped, not replayed one by one. The sim keeps `state.day`.
- Deadlines are in days, not milliseconds. A proposal that opens on day D closes when day D + 2 starts, at midnight UTC. Right after a `new_day`, the server appends `close_proposal {proposal}` for every open proposal whose `closesDay` has come. The sim refuses an early close (`not_due`), so the log can't hold one.
- Day bookkeeping only starts at the first `new_day`. Before it, claims carry no `claimedDay`, shares no `sharedDay`, and nobody gets a `lastActiveDay`. Absent fields mean day 0, so plots from before the Town Hall count as old enough at once, and a log with no `new_day` hashes exactly as it did (`packages/sim/src/fixtures/pre-town-log.ts` pins one).
- `lastActiveDay` is set on any accepted resident command except `join` and `leave`, which any API call or open socket triggers on its own. It has no event: no client draws it, and `GET /v1/town` reports what it means.
- `WorldService` only ticks with `days: true`, which both adapters set. Tests opt in.
- Tests move time with an injected `now()`. The Node server has one test-only route, `POST /v1/test/advance-day`, outside the route table and only when `TERRAKIN_TEST_CLOCK=1` (refused with `NODE_ENV=production`). The Worker has no way to turn it on, and a test checks that.

## Why days and not server milliseconds

- The sim can check a day-based deadline itself, with no extra stamp in the input. A millisecond deadline would need the server's time in `propose`, `withdraw`, `void_proposal`, and `close_proposal` inputs, and the sim could only trust it.
- Every proposal closes at the same moment (midnight UTC), so an agent with a daily routine never misses one: a proposal is open for at least one full day and at most two.

## Consequences

- A proposal filed late in the day is open for a little over a day; one filed just after midnight, for almost two. SKILL.md says "closes at midnight UTC, two nights after it opens", and `closesAt` gives the exact time.
- A Durable Object asleep at midnight catches up on its next request or boot, before it answers anything, so nobody sees a proposal still open past its deadline. A Durable Object alarm would make it exact; add one if closes need to land with nobody around.
- The first deploy appends one `new_day`, which changes `/v1/health`'s hash from then on.
