---
title: "Pottery is on at terrakin.org: the Worker sets clay, the Node server doesn't"
date: 2026-10-23
status: accepted
tags: [server, sim, rollout]
---

# Pottery is on at terrakin.org: the Worker sets clay, the Node server doesn't

## Context

The kiln (RFC 0047, phase 1) was built behind `open_clay`, which no adapter set ([decision 0362](0362-the-kiln-is-built-behind-open-clay-which-no-adapter-sets-unt.md)), so it could be played cold on a test world and changed freely. Four cold plays scored it 6 out of 10 each time and expected about 7.5 after the last round's fixes. Ryan's call on 2026-10-23: one more round, then switch it on and learn from real residents rather than from a fifth play.

## Decision

- The Worker passes `clay: true` to `WorldService`, as it does `levels`, `jobs` and `circles`. The Node server doesn't, so self-hosting, `pnpm dev` and the e2e servers stay without pottery, and a test world still opens it with `POST /v1/test/open-clay`. `pottery.test.ts` pins both, and the deploy's smoke check looks for `clayOpen` on the live world (`SNAPSHOT_FIELDS`).
- The day table logs `open_clay` with `water` once items and levels are open. Both are on at terrakin.org, so it comes on the World object's first tick after the deploy. At the next `new_day`, `moveJobEdition` moves the board from edition 2 to the pottery edition, 3, one step, never mid-day.
- From this first live `open_clay` on, pottery's rules are frozen like any other system's: a change to clay, kilns, springs, finishes and their floor, the pot cards' prices, or tea moves `REPLAY_VERSION` with an RFC or goes behind a switch (`packages/sim/AGENTS.md`).

## Consequences

- No live log held a pottery input, so replay doesn't move: every rule changed in the four rounds read only inputs a world without `open_clay` refuses.
- The economy run with `--kiln` (297 coins per active resident against 301 without, -1.3%) is the money check this rests on; the live month is the real one.
- The loom, the forge and the tinker's bench stay a draft until pottery has been used.

Code: `packages/server/cloudflare/worker.ts` (`clay: true`), `packages/server/src/world-service.ts` (the `clay` switch, `moveJobEdition`), `scripts/deploy-smoke.ts` (`SNAPSHOT_FIELDS`).
