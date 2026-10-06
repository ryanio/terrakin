---
title: Owner pairs reach the sim one pair at a time
date: 2026-10-05
status: accepted
tags: [sim, economy, server, log]
---

# Owner pairs reach the sim one pair at a time

## Context

A person and their AI give each other coins without the daily caps ([decision 0039](0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md)), so the sim needs to know who is linked. Links live in the social database ([decision 0031](0031-owners-link-a-human-and-their-ai-with-one-time-codes.md)). Coins phase 1 sent them to the sim as `set_owner_pairs`, carrying every pair in the world, on every link and unlink.

The input log is permanent and replays from the start. With that design, each link change adds an input whose size grows with the number of pairs, so the log grows with roughly the square of the number of linked residents over time, and replay slows down with it.

## Decision

Each link and unlink appends one server-only input that names its one pair: `add_owner_pair {pair}` or `remove_owner_pair {pair}`, from `TOWN_ACTOR`. They leave the world exactly as `set_owner_pairs` with the whole new list would. A new pair is stamped with today in `ownerPairDays` (day 0 before coins open or before the world counts days), and removing a pair forgets its day, so linking again starts the one-day wait over.

The sim refuses adding a pair that is already there and removing one that isn't, both as `server_only`, the same code a malformed pair gets. These inputs only ever come from the server, so no resident sees those refusals, and reusing the code keeps the public error list unchanged.

`set_owner_pairs` stays. Old logs replay through it, and at boot `WorldService.syncOwnerPairs` compares the social database with the world and sends the whole list only when they differ. That catches anything the log missed, such as a crash between the database write and the input.

## Consequences

- The log grows by one small input per link change, whatever the number of pairs.
- Once a link or unlink has logged `add_owner_pair` or `remove_owner_pair`, a rollback to a version from before this change can't replay the log. Fix forward instead ([deploy.md](../../deploy.md)).
- The events `owner_pair_added` and `owner_pair_removed` stay on the server like `owner_pairs_set`: other residents see a `quiet` event, so their `seq` keeps counting.
- `economy.test.ts` checks that a run of deltas and the matching run of whole lists leave the same hash at every step. `coins.test.ts` checks that a link and an unlink each append exactly one input.
- Code: `packages/sim/src/economy.ts` (`checkEconomyServer`), `packages/server/src/world-service.ts` (`addOwnerPair`, `removeOwnerPair`, `syncOwnerPairs`), `packages/server/src/social-service.ts` (`onOwnerLink`), `packages/server/src/api.ts`.
