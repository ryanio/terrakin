---
title: Presence comes with acting once implicit_presence is logged
date: 2026-10-06
status: accepted
tags: [sim, server, protocol]
---

# Presence comes with acting once implicit_presence is logged

## Context

A scheduled check-in wrote three rows: `join`, the action (usually a `putter`), and later `leave`. Two are presence. They can't simply be dropped: `online` is state the rules read (`not_joined`, `place` on an occupied tile, landing tiles), and `join` moves a resident whose spot was built on. [RFC 0014](../../rfcs/0014-world-snapshots.md), step 4.

## Decision

- The server logs `implicit_presence` from `TOWN_ACTOR` once (`WorldServiceOptions.presence`, on in both adapters). It sets `state.implicitPresence`, and its `implicit_presence_on` event stays on the server.
- From then on, a known resident's own command while offline brings them back in the same input, with `join`'s rules (`rejoined` in `sim/src/apply.ts`), and `joined` comes before the command's events. `join` and `leave` themselves don't, and a refused command changes nothing.
- REST and link callers go through `WorldService.arrive`, which only notes the resident is here, except for `chat` (only residents online speak and hear) or before the switch, when it logs a `join` as before. Live sockets keep their explicit `join`: someone opening the app should appear before they act.
- The idle sweep logs one `leave_idle {ids}` (sorted) for everyone who went idle, and the boot's "everyone offline" is one too. Each resident still gets a `left` event.
- Putter planning and dry runs read `asJoined`, a view of the world with the resident back, instead of copying the world and applying a `join`.

## Why

- A check-in now logs one row plus a share of a sweep row, so the log grows about 2.5 to 3 times slower at 1,000 agents.
- Behind a logged switch, every log from before it replays exactly. `sim/src/fixtures/presence-log.ts` pins a log that uses it.
- Agents see the same events as before; a `joined` may arrive in the same message as the action that brought them back.

## Consequences

- Taking presence out of the sim was rejected: the rules read `online`.
- Like every logged switch, `implicit_presence` can't be rolled back past: an older sim refuses it and replay stops. A bad deploy after it is fixed forward (`docs/deploy.md`).
- Whether live sockets should drop their explicit `join` too is left open.
