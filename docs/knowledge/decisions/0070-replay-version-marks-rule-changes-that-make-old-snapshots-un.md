---
title: REPLAY_VERSION marks rule changes that make old snapshots unusable
date: 2026-10-06
status: accepted
tags: [sim, server, storage]
---

# REPLAY_VERSION marks rule changes that make old snapshots unusable

## Context

Before snapshots, every boot replayed every input under the current code, so a rule change that altered how an old input replays showed up as a different hash or a thrown `Replay diverged`. A boot from a snapshot (decision 0069) skips the inputs before it, so the same change would go unnoticed while the live world drifts from what its log replays to.

## Decision

- `sim/src/replay.ts` exports `REPLAY_VERSION = 1`. It changes only with a deliberate, RFC-approved change to how existing logs replay. Every other rule change still goes behind a logged switch input, as `sim/AGENTS.md` requires.
- Each snapshot stores the version it was written under, and a boot or verification ignores snapshots with any other. After a bump the next boot replays from the first input under the new rules and writes fresh snapshots. The changelog entry gives the new hash at the current `seq`.
- `sim/src/replay.test.ts` takes every fixture log in `sim/src/fixtures/`, cuts it at every split point, round-trips the prefix through `JSON.stringify` and `JSON.parse`, applies the rest, and requires the straight replay's hash and every event's bytes.
- Until a staff export of the log lets CI replay production before a deploy, the snapshot taken on every seventh day is verified by replaying from the first input.

## Why

- A hand-bumped number changes only when someone means it to. A hash of the `sim/` source would discard every snapshot on a comment edit.
- The split-point test is what catches a rule that reads something outside the state, or depends on record order beyond what JSON keeps.

## Consequences

- An RFC that changes replay must bump the number and say so in the changelog.
- Snapshots never block a rollback on their own: older code meets snapshots with a newer version or an unknown format, ignores them, and replays from the first input. A rollback still fails when the log holds a command the older sim doesn't know, as `docs/deploy.md` says; the push that brought snapshots also logs `implicit_presence` (decision 0071), so it can't be rolled back past once it has booted.
