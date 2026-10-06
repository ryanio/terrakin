---
title: The world boots from a verified snapshot and the log after it
date: 2026-10-06
status: accepted
tags: [server, storage, sim]
---

# The world boots from a verified snapshot and the log after it

## Context

The World object booted by loading the whole input log into memory and replaying it. `scripts/replay-bench.ts` measured about 270 bytes of heap per input, so the 128 MB object runs out somewhere under 500,000 inputs: about three weeks at 1,000 agents checking in every 3.5 hours. Boot time also grows by 1.2 to 2.4 µs per input. [RFC 0014](../../rfcs/0014-world-snapshots.md) has the numbers.

## Decision

- The boot streams the log one row at a time (`Store.eachInput`) and builds the server's own facts in the same pass: join days, done kinds, today's putters, and karma's credits (`LogFacts` in `packages/server/src/snapshots.ts`, which also keeps them up as inputs commit).
- Snapshots live in the object's SQLite next to `world_log`: `world_snapshot` (one row each: `seq`, `format`, `replay_version`, `hash`, `sha256`, `parts`, `bytes`, `verified`) and `world_snapshot_part` (the body in parts of at most 1 MB of UTF-8, never cut inside a surrogate pair, since a row holds at most 2 MB).
- The body is `JSON.stringify({format, world, server})`. Plain `JSON.stringify` keeps the order records were made in; `canonicalJson` sorts keys, and a world parsed back from it emits some later events with their keys in another order.
- One is taken right after `tick()` commits a `new_day`, and from the minute sweep when the log is 50,000 inputs past the newest. It's written in one transaction (`ctx.storage.transactionSync` on Cloudflare, which refuses `BEGIN`). Only a world that counts days takes them, since its join days come from the log alone, only when every `world_log` row's `seq` matches the world's, and only while the coin supply adds up. Either of the last two failing is reported, and a `world.supply_holds` gauge is set at every boot.
- The minute sweep verifies new snapshots, oldest first, 25,000 inputs a slice: from the previous verified snapshot, or from the first input for the first snapshot and for one taken on a day where `day % 7 === 0`. It passes when the replay has the same world hash, the same SHA-256 of the world as canonical JSON (the 32-bit hash alone is too short to vouch for a world), and the same join days, done kinds, and credits from its `creditsFrom`.
- A boot uses the newest verified snapshot in a known format with the running `REPLAY_VERSION`, after checking its SHA-256, `seq`, world hash, and the coin supply identity, then replays the rows after it, each `seq` the next one. Any failure goes to Sentry and the boot tries an older snapshot, then the first input. The newest 3 verified snapshots are kept, plus newer unverified ones.
- `GET /v1/health` gains optional `snapshot {seq, hash}`: the newest verified one.
- `hash()` is cached per `seq`, since only `run()` changes the world.

## Why

- The log stays the source of truth: deleting every snapshot gives the same world, only a slower boot.
- A snapshot is only ever used after a replay reproduced it, so a bad one makes a boot slower but never wrong.
- The weekly replay from the first input also catches a rule change that would replay old inputs differently, which a snapshot boot no longer notices (decision 0070).

## Consequences

- RFC 0014's rollout had a week of verified snapshots before boot used them. That week is folded into verification: a snapshot can't be booted from until a replay has reproduced it, and the first one is replayed from the first input.
- Booting from a snapshot skips `Replay diverged` on old inputs. Decision 0070 and the weekly replay cover that.
- Each snapshot holds every purse, inventory, and gift note. It is never served by the API.
