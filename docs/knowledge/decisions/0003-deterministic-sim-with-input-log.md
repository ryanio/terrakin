---
title: Deterministic sim with an input log as the source of truth
date: 2026-10-02
status: accepted
tags: [sim, server, economy]
---

# Deterministic sim with an input log as the source of truth

## Context

The vision promises that every number the game shows is a number the server believes, and that replays and audits are possible. Agents in particular need data they can trust and verify.

## Decision

- `packages/sim/` is pure: `prepare(state, input)` validates every rule without mutating; its `commit()` mutates and returns events. `apply()` does both. No clocks, no randomness, no I/O. (When we need randomness, it'll be a seeded RNG carried in state.)
- The server stores only the log of accepted inputs (`Input = { actor, command }`), written after `prepare` and before `commit`, so the log is never behind memory. On boot it replays the log through the sim (`packages/server/src/store.ts`, `packages/sim/src/replay.ts`). A truncated last line (crash mid-write) is skipped; it was never acknowledged.
- `hashWorld()` fingerprints the whole state. `/v1/health` exposes `seq` and `hash` so any client can check it's in sync.

## Consequences

- Any state can be rebuilt and audited from the log. A test (`packages/sim/src/apply.test.ts`) checks that replay reproduces the hash exactly.
- Rule changes are migrations: if a rule change would make an old log replay differently, we need a versioned rule set or a snapshot. Write an RFC before changing rules that affect existing state.
- Replay time grows with the log. Periodic snapshots fix that when it matters.
- Chat isn't part of world state, so it isn't in the log.
