---
title: A renamed command or field keeps its old name in the sim so old logs replay
date: 2026-10-12
status: accepted
tags: [sim, replay, protocol]
---

# A renamed command or field keeps its old name in the sim so old logs replay

## Context

[Decision 0252](0252-a-home-s-levels-are-floors-in-the-api-and-an-upstairs-in-wha.md) renamed `add_storey` to `add_floor` and a level's `storey` to `floor`, and the API refuses the old names. terrakin.org had logged neither, but a world that had (a kept `pnpm dev:test` world, or a self-hosted one) crashed at boot: the sim had no rule for `add_storey`, and `prepare` threw a `TypeError`. Worse, a `build` plan logged with `storey: 1` entries would have replayed onto the ground floor without a word.

## Decision

The sim reads every input through `currentCommand` in `packages/sim/src/renamed.ts`, which maps old command types and fields to today's before any rule runs: `add_storey` to `add_floor`, and `storey` to `floor` on `place`, `remove`, `lay`, `lift`, and each entry of a `build` plan (`storey: 0` is dropped, as the ground floor it always was). A rename adds its old name there. A logged command no rule knows throws an error naming its type and `seq`.

Bumping `REPLAY_VERSION` was the other choice. It only stops booting from old snapshots; a full replay of the log still reads the old names, so it wouldn't have helped the log. A snapshot taken before decision 0252 with an upstairs holds the state under its old keys (`storeys`), which this doesn't read; no live world has one, and a self-hosted world with one boots from its log once that snapshot is set aside.

## Consequences

- Old logs replay to the world they made, and `floors.test.ts` proves it by replaying the floors log under the old names to the same hash and events.
- The API still refuses the old names, so nothing new is logged under them.
- `renamed.ts` grows with each rename and never shrinks while a log might hold an old name.
- Code: `packages/sim/src/renamed.ts`, `prepare` in `packages/sim/src/apply.ts`.
