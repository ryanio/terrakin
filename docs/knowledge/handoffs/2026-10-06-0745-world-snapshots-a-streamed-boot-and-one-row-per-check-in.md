---
title: World snapshots, a streamed boot, and one row per check-in
date: 2026-10-06
tags: [server, sim, storage, presence, replay]
---

# World snapshots, a streamed boot, and one row per check-in

## Done

- Ryan accepted [RFC 0014](../../rfcs/0014-world-snapshots.md); it is now "accepted (building)". All four steps are built in one push.
- Step 1: the boot replays through `Store.eachInput` one row at a time and builds `LogFacts` (join days, done kinds, today's putters, karma credits) in the same pass. `hash()` is cached per `seq`. A `world.boot` span and a `world.boot_inputs` gauge (`from: snapshot` or `log`) give real Workers numbers.
- Step 2: snapshots in the World object's SQLite, `server/src/snapshots.ts` ([decision 0069](../decisions/0069-the-world-boots-from-a-verified-snapshot-and-the-log-after-i.md)). `GET /v1/health` has `snapshot {seq, hash}` once one is verified.
- Step 3: `REPLAY_VERSION = 1` in `sim/src/replay.ts`, and `sim/src/replay.test.ts` replays every fixture log from every split point ([decision 0070](../decisions/0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)).
- Step 4: `implicit_presence` and `leave_idle` in `sim/src/presence.ts`, `WorldService.arrive` for REST and link callers, pinned by `sim/src/fixtures/presence-log.ts` ([decision 0071](../decisions/0071-presence-comes-with-acting-once-implicit-presence-is-logged.md)).

## State of things

- On the first boot after this deploy, the World object replays from the first input as before (no snapshots exist yet), then logs `implicit_presence`. The first snapshot comes at the next `new_day` (midnight UTC), and the next minute sweep verifies it from the first input.
- This deploy can't be rolled back once it has booted: the log then holds `implicit_presence`, which the older sim refuses. Fix forward (`docs/deploy.md`). If the snapshot boot itself misbehaves, deleting the rows in `world_snapshot` and `world_snapshot_part` makes the next boot replay from the first input.
- RFC 0014's rollout had a week of write-only snapshots before boot used them. That week is folded into verification: a snapshot is never booted from until a replay reproduced it.
- If `world_log` row numbers ever didn't match the world's `seq`, the boot reports "world_log seq doesn't match the world's; snapshots are off" to Sentry and takes none. Nothing else changes.
- Snapshot failures report to Sentry under `world.snapshot_boot`, `world.snapshot_verify`, and `world.snapshot`, with codes and `seq`s only. If the world's coins ever stop adding up, no snapshot is taken and `world.snapshot` says so once a day; the `world.supply_holds` gauge (1 or 0) is set at every boot.

## Next

1. After the first midnight UTC following the deploy, check `GET /v1/health` for `snapshot`, and Sentry for any `world.snapshot*` or `world.boot` report (a misaligned log or coins that don't add up both turn snapshots off).
2. Read the `world.boot` span and `world.boot_inputs` gauge to see how much slower a Workers isolate is than the M4 Max numbers in the RFC.
3. A staff-only export of `world_log` (behind Access, never cached or logged), then a CI step that replays it before a deploy touching `sim/` and fails on a hash mismatch at the newest snapshot's `seq`. The every-seventh-day replay covers it until then.

## Open questions

- Ryan: should live sockets also stop sending an explicit `join` (RFC 0014 open question)? They still do.
- Ryan: archive old `world_log` rows to R2 once a verified snapshot covers them? Not needed for years at current growth.
- Are a daily snapshot, a 50,000 input tail, and 25,000 inputs per verification slice the right numbers? The telemetry will say.
