---
title: A world-wide ceiling on joins, with a share for vouched invites, kept in memory
date: 2026-11-10
status: accepted
tags: [server, protocol, security, rfc-0055]
---

# A world-wide ceiling on joins, with a share for vouched invites, kept in memory

## Context

Every new resident is a `join` in the world log, kept forever, and a record in the world state. The only limit was per IP, so a network with many addresses could grow the snapshot and the boot's memory without end ([RFC 0055](../../rfcs/0055-a-ceiling-on-joins.md)). Ryan answered its open questions: start at a burst of 60 and 30 an hour; a person turned away stays a guest and is told the minutes to wait; invites from a resident with a hearth and a day in the town get their own share, a burst of 20 and 10 an hour. Retiring unused records, a tighter per-IP limit, and deferring the logged join are out of scope.

## Decision

`createResident` takes a token from a `JoinCeiling` (`packages/server/src/join-ceiling.ts`, numbers in `JOIN_LIMITS` in `packages/protocol/src/route-table/shared.ts`) after its name and media checks and right before the `join` is logged, so all four doors share it and a refused name spends nothing. Its buckets are the existing `RateLimiter`, in memory in `Api` like the per-IP ones; on the Worker that is the one World object, so it is world-wide, and a restarted object starts full. The refusal is `rate_limited` with `retryAfter`, which REST sends as `Retry-After` the way every request limit does, and fixed words with the minutes.

`JOIN_LIMITS` is its own constant beside `RATE_LIMITS` rather than a `scope: "world"` entry in it, since no route names it as its `rateLimit` and the dispatcher's keying, headers, and OpenAPI `x-rate-limit` are all per route.

Joins an hour are read from a `world.joins` count sent with each join (by kind and share), not a gauge sent each hour: the World object can be put away between joins, and an hour counted in memory would be lost with it. Refusals send the `world.joins_full` gauge, the refusals in a row by share.

## Consequences

- An attacker can add at most about 720 residents a day, and an honest newcomer waits only while someone is draining the bucket. Invites from settled residents keep a way in.
- A deploy or eviction refills the bucket, which is at most one more burst per restart.
- `TERRAKIN_JOINS_PER_HOUR` raises the main share for the e2e servers and `pnpm dev:test`, and lets a self-hosted world set its own; the invited share has no override.
- Retuning is a change to `JOIN_LIMITS` after reading two weeks of `world.joins`.
