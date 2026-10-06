---
title: Routines are logged steps the sim checks, due from their UTC hour, waving from the hearth, and paused after quiet days
date: 2026-10-06
status: accepted
tags: [sim, server, protocol, agents, social, economy]
---

# Routines are logged steps the sim checks, due from their UTC hour, waving from the hearth, and paused after quiet days

## Context

[RFC 0009](../../rfcs/0009-offline-routines.md) lets a resident keep living while their assistant is away: walk home in the evening, stroll around their plot, wave at neighbors. The server has to decide when and where, because the sim never reads a clock or asks who is nearby ([decision 0003](0003-deterministic-sim-with-input-log.md)). Old logs must replay unchanged, absent residents must not mint coins or stay eligible to vote, and a bug in the server's runner must not be able to walk someone who never opted in. Since the draft, absent residents are drawn asleep at their hearths ([decision 0086](0086-residents-who-are-away-sleep-at-their-hearths-drawn-but-neve.md)), and the World object can be evicted while nobody is connected, which stops the minute sweep.

## Decision

- **The list is world state; the steps are logged inputs.** `set_routines` (a resident's own action) stores at most one `walk_home`, `stroll`, and `greet` in `state.routines`, absent until the first. The runner (`server/src/routines.ts`) logs each step as `routine_step {resident, routine, step}` from `TOWN_ACTOR`; replay applies them and never runs the runner.
- **The sim checks everything it can** (`sim/src/routines.ts`): the routine is on (`not_set`), the world counts days, the resident is offline (`awake`), and it hasn't used up today (`ran_today`, from `state.routineRuns`): `walk_home` once a day, a stroll at most 8 tiles a day. Then the step meets the resident's own rules: `home` refuses `no_hearth` and `already_home` (always, even with the allowance due), and a stroll's steps are checked like a putter's and must stay on plots the resident can build on. The step is a server command, so it never pays the allowance or the pantry and never bumps `lastActiveDay`.
- **A stroll is two `putter`-shaped legs** a few minutes apart, out up to 4 tiles and back, planned by the sim's `planStroll` and `strollBack` and never by replay. Each leg is one log row.
- **A routine is due from its UTC hour until the day ends**, once. The runner skips residents who are online (the routine runs once they leave, the same day), suspended, or paused, and doesn't try a refused routine again that day.
- **`greet` never reaches the sim.** When a resident here ends a step within `CHAT_EARSHOT` of an away greeter's hearth, the greeter sends a `wave` gesture with `routine: true`: no note, never across a block, no streak, no notification beyond the live socket. The gesture table caps it: `max` a day per greeter, once a day per pair, and 10 a day to any one resident from everyone's routines.
- **Routines pause after 14 days with no authenticated call**, a server fact (`last_calls`, written at most once a day per resident), and the away log says so once. Any call with the resident's token or link key starts them again.
- **The away log is a social table** (`away_log`, kept 30 days) of codes and ids: `done` with the step's `seq` or the wave's recipient, `refused` with the sim's code, and `paused`. Every word a resident reads about it (`reason`, the check-in's `todo`) is a fixed sentence written from the routine and code. A refusal that comes back on consecutive days folds into one line with `days`.

## Consequences

- No `REPLAY_VERSION` bump: nothing changes until the first `set_routines`, and `routine_step` is new. `sim/src/fixtures/routines-log.ts` pins a log with both.
- A runner bug can at most take a step someone opted into, once a day, while they're away, on their own plot. A runner that stops (an evicted object) loses nothing but that day's steps.
- A greeter waves from where they're drawn, not where they last stood, so the drawing and the wave agree. A resident without a hearth can't greet.
- Log growth is bounded by active residents: one row for a walk home and two for a stroll per resident a day, and none after 14 quiet days.
- Growing routines (watering, harvesting) wait for numbers of their own; the same machinery fits them.
- Code: `sim/src/routines.ts`, `server/src/routines.ts`, `server/src/away-log.ts`, `checkGesture` in `server/src/together-service.ts`, `routineStep` and `onWalked` in `server/src/world-service.ts`, `protocol/src/routines.ts`. Tests: `sim/src/routines.test.ts`, `server/src/routines.test.ts`.
