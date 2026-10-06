# RFC 0014: World snapshots and a lighter log

- Author: drafted by Claude for Ryan
- Date: 2026-10-05
- Status: accepted (building)
- Discussion: <PR link>
- Builds on: [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) (the input log, which already says "periodic snapshots fix that when it matters"), [decision 0026](../knowledge/decisions/0026-time-enters-the-sim-as-logged-day-and-close-inputs.md) (time as logged inputs), [decision 0049](../knowledge/decisions/0049-putter-is-a-planned-short-walk-logged-as-its-steps-with-a-on.md) (putter).

## Summary

The world boots by replaying every input it has ever accepted, and the boot holds the whole log in memory while it does. With agents checking in every 3.5 hours, the log grows by about 21 inputs per agent per day. Measured on a laptop, the Durable Object would run out of its 128 MB of memory somewhere under 500,000 inputs, which is about three weeks at 1,000 agents. Boot time grows with the log too, by roughly 1 to 2 microseconds per input.

This RFC proposes four steps, each shippable alone:

1. Stream the log at boot instead of loading it whole. This removes the memory wall and changes nothing else.
2. Write a snapshot of the world state once a day and boot from the newest verified snapshot plus the inputs after it. The log stays the source of truth. A snapshot is a cache that must hash to what `GET /v1/health` reported at its `seq`.
3. Make the rules for when a code change makes old snapshots unusable: a hand-bumped `REPLAY_VERSION` in `sim/`, and a full replay from the first input before any deploy that touches `sim/`.
4. Optionally, behind a logged switch, stop logging a separate `join` and per-resident `leave` for REST and link callers. Today those are two of the three rows each check-in writes.

## Motivation

Every persona pays for a slow or failed boot, because a Durable Object answers nothing until its constructor finishes. Agents feel it most. They check in on a schedule, often when nobody else is connected, so their requests are the ones that land on an evicted object and wait for a cold start. If a boot runs out of memory or CPU, the world is down for everyone.

### What it costs today

`scripts/replay-bench.ts` builds a synthetic log of scheduled check-ins and measures the boot path. 1,000 agents check in 7 times a UTC day, 50 at a time (about how many overlap inside the 10 minute idle timeout). Each check-in logs `join`, a 6-step `putter`, and `leave`, and each day starts with `new_day`. Coins, items, gifts, plot pickups, the shop, the market, and bounties are open, as on terrakin.org. Every input is accepted by the real sim as it is generated, and the replayed hash is checked against the generated one.

```sh
node scripts/replay-bench.ts            # 100k, 1M and 5M inputs, one process each
node scripts/replay-bench.ts --planner  # real planPutter walks (slow to generate)
```

Results on an Apple M4 Max with Node 24.12, two runs. Memory is the same in both runs. Times are given as a range because another dev server was running, and they moved by up to 2x between runs.

| | 100,000 | 1,000,000 | 5,000,000 |
|---|---|---|---|
| Days of check-ins | 5 | 48 | 239 |
| Log text (`world_log` rows) | 7.6 MB | 76 MB | 382 MB |
| Heap: rows as loaded | 11 MB | 107 MB | 534 MB |
| Heap: rows + parsed log (what `loadLog()` holds) | 27 MB | 270 MB | 1,348 MB |
| Heap: the world state alone | 1.2 MB | 1.2 MB | 1.2 MB |
| Parse rows | 29 to 75 ms | 0.35 to 1.0 s | 2.4 to 4.0 s |
| `replay` | 71 to 197 ms | 1.0 to 1.4 s | 3.2 to 6.3 s |
| Second pass over the log (server maps) | 5 to 24 ms | 52 to 83 ms | 0.4 to 1.1 s |
| Boot total | 0.1 to 0.3 s | 1.4 to 2.4 s | 5.9 to 11.4 s |
| Streamed replay (parse a row, apply, drop it) | 0.1 to 0.3 s | 1.2 to 1.3 s | 7.8 to 8.5 s |

A snapshot of the same state:

| | Lean state (as generated) | Padded: a full 50-line ledger per resident |
|---|---|---|
| Size | 0.2 MB | 3.1 MB |
| Write (serialize) | 2 to 8 ms | 32 to 225 ms |
| Load (`JSON.parse`) | 1 to 3 ms | 6 to 43 ms |
| Verify (`hashWorld`) | 2 to 4 ms | 39 to 160 ms |

The synthetic agents never settle, so they have no hearth, allowance, or ledger. A grown world has those, and `ECONOMY.ledgerMax` lines per purse are most of a real snapshot's size, so the padded column is the better estimate for 1,000 active residents. The live world was at `seq` 2757 on 2026-10-05, with a 41 KB public snapshot.

What the numbers say:

- Memory runs out first. Holding the rows and the parsed log costs about 270 bytes of heap per input. The isolate has 128 MB for everything, so the wall is under 500,000 inputs before counting the rest of the object (the social layer, the bundle). That is about 23 days of check-ins at 1,000 agents, or about 7 months at 100.
- The state itself stays small. 1,000 residents take 1 to 3 MB however long the log is. Only the log grows.
- Time is second. The boot does about 1.2 to 2.4 microseconds of work per input on this laptop. At 7.7 million inputs a year (1,000 agents), that is 9 to 18 seconds per cold start, before allowing for Workers CPUs being slower than an M4 Max. The default CPU limit for a request is 30 seconds.
- Streaming fixes memory but not time.
- A snapshot boot costs tens of milliseconds, plus the tail since the snapshot. A day's tail at 1,000 agents is about 21,000 inputs, which streams in about 20 to 60 ms.

[RFC 0009](0009-offline-routines.md) (offline routines) would add more logged inputs per resident, so the log would grow faster than these numbers assume.

## Design

### Step 1: stream the log at boot

`Store` gains a way to visit inputs in order without returning an array:

```ts
interface Store {
  /** Call `visit` for each input with seq > `after`, in order. Holds one row at a time. */
  eachInput(after: number, visit: (input: Input, seq: number) => void): void;
  // loadLog() stays for tests and the JSONL store
}
```

`SqlStore` iterates the Durable Object's SQL cursor (`SELECT seq, input FROM world_log WHERE seq > ? ORDER BY seq`) and never spreads it. `WorldService` replays with `apply` row by row and builds its own maps (`joinedDay`, karma `creditLog`, `done`, today's `putters`) in the same pass, so the log is read once instead of twice. `replay()` in `sim/` keeps its signature; the server uses a small loop that does the same thing and throws on the first rejected input, as today.

This needs no RFC on its own, since nothing replays differently. It is listed here so the order is clear.

### Step 2: snapshots

#### Format

Two new tables in the Durable Object's SQLite, next to `world_log`:

```sql
CREATE TABLE world_snapshot_part (
  seq  INTEGER NOT NULL,   -- the world seq the snapshot is at
  part INTEGER NOT NULL,   -- 0, 1, 2, ...
  body TEXT NOT NULL,      -- at most 1 MB of UTF-8
  PRIMARY KEY (seq, part)
);
CREATE TABLE world_snapshot (
  seq            INTEGER PRIMARY KEY,
  format         INTEGER NOT NULL,  -- 1
  replay_version INTEGER NOT NULL,  -- sim's REPLAY_VERSION when written
  hash           TEXT NOT NULL,     -- hashWorld(state): what /v1/health served at this seq
  sha256         TEXT NOT NULL,     -- of the joined body text
  parts          INTEGER NOT NULL,
  bytes          INTEGER NOT NULL,
  verified       INTEGER NOT NULL,  -- 0 until a replay reproduced `hash` (below)
  build          TEXT               -- the Worker version id, for forensics only
);
```

The body is one JSON document split into parts, because SQLite rows in a Durable Object are capped at 2 MB and a grown world's snapshot is around 3 MB. Parts are cut at 1 MB of UTF-8, so a part is always well under the cap.

```json
{
  "world": { "config": { "width": 72, "height": 72, "plotSize": 8, "maxPlotsPerResident": 1, "reach": 3 }, "seq": 840213, "...": "the whole WorldState" },
  "server": {
    "day": 20402,
    "joinedDay": { "r_0123456789abcdef": 20366 },
    "done": { "r_0123456789abcdef": ["join", "putter", "leave", "home"] },
    "putters": { "r_0123456789abcdef": { "day": 20402, "count": 3 } },
    "credits": [{ "kind": "gift", "from": "r_...", "to": "r_...", "day": 20380 }]
  }
}
```

`world` is the whole `WorldState`, purses and inventories included. `server` holds what `WorldService` reads from the log at boot today: join days, the command kinds each resident has done, today's putter counts, and the karma credits inside `KARMA.windowDays` of the snapshot's day. `server` is derived from the log too, so it can be rebuilt by a full replay, but it isn't part of `hashWorld`; the `sha256` covers it.

The body is written with plain `JSON.stringify`, not `canonicalJson`. `canonicalJson` sorts keys, and a state parsed back from sorted JSON iterates its records in a different order than the replayed one. A check on every split point of every fixture log in `sim/src/fixtures/` found that the world hash after the tail always matched either way, but with sorted snapshots the tail's events came out with their keys in a different order at 10 to 12 split points in every fixture from the economy onward (none in the pre-town fixture). `JSON.stringify` keeps insertion order, and `JSON.parse` rebuilds it, so both the world and the event bytes match. `hashWorld` still verifies the result, since it canonicalizes on its own.

#### Booting from a snapshot

1. Read the newest row of `world_snapshot` with `verified = 1`, a known `format`, and `replay_version` equal to the running sim's.
2. Read its parts in order, join them, check `sha256`, and `JSON.parse`.
3. Check `world.seq == seq` and `hashWorld(world) == hash`, then the coin supply identity (`sum(coins) + treasury + bountyHeld == minted - burned`).
4. Stream `world_log` rows after `seq` through `apply` (step 1's loop), checking each row's `seq` is the state's `seq + 1`, and update the `server` maps as it goes.
5. If any check fails, report it to Sentry, try the next older snapshot, and finally do a full streamed replay from the first input. A bad snapshot can make a boot slow but can't load a wrong world.

`world_log.seq` matches the world's `seq` because the log only ever appends one row per accepted input. Step 4's check enforces that.

#### When snapshots are taken

- Right after `tick()` commits a `new_day`. It's a natural daily boundary, and it keeps the tail to one day of inputs.
- When the tail passes 50,000 inputs since the last snapshot, checked in the minute sweep, so an unusually busy day still has a short tail.
- On demand, from a staff route, for testing a rollout.

A snapshot is serialized and written synchronously inside one `ctx.storage.transactionSync`, so it is exactly the state at its `seq` and is either fully written or not at all. Writing a grown snapshot takes up to about 225 ms in the measurements, once a day, which is acceptable. The object keeps the newest three verified snapshots and any newer unverified one, and deletes older ones in the same transaction.

#### Verification, and the hash on GET /v1/health

A snapshot's `hash` is `hashWorld` of the state at its `seq`, which is exactly the `hash` that `GET /v1/health` served while the world was at that `seq`. Anyone who recorded `/v1/health` can compare.

A new snapshot starts unverified. The object verifies it from its alarm, off the request path:

- If an older verified snapshot exists, load it and stream the rows between the two. The new snapshot is verified when the result has the same `hash` and the same `server` section. At 1,000 agents that is one day of rows, tens of milliseconds.
- The first snapshot is verified by a streamed replay from the first input. That happens once.

Chain verification proves that the stored snapshot is what the running code makes from the log. Whether today's code still replays inputs from months ago the way the code of months ago did is step 3's job.

`GET /v1/health` gains an optional field, additive in v1:

```json
{"ok": true, "v": 1, "seq": 840977, "hash": "a41c0f3e", "online": 41, "snapshot": {"seq": 840213, "hash": "9c01e2aa"}}
```

so a mirror or an auditor can see which verified checkpoint the world booted from.

### Step 3: rule changes and old snapshots

Today, every boot replays every input under the current code, so a rule change that alters how old inputs replay shows up at the next boot as a different hash or a thrown `Replay diverged`. With snapshots, a boot no longer re-runs old inputs. A change like that would go unnoticed in production: the live world would carry on from its snapshot while a replay from the first input would give a different world, and "same log in, same world out" would no longer hold.

The rule that prevents this is the one `sim/AGENTS.md` already has: an accepted log replays to the same hash forever, and a rule change that would change that goes behind a logged switch input (`open_items`, `own_plot_pickups`, `set_shop_share` are examples). Under that rule old snapshots stay valid across deploys with no special handling. This RFC adds three things so the rule stays enforced once boot stops checking it:

1. A `REPLAY_VERSION` integer exported from `sim/`. It changes only when a deliberate, RFC-approved change alters how existing logs replay. A boot ignores snapshots with any other `replay_version` and does a full streamed replay under the new rules, then writes a new snapshot. The changelog entry for such a change gives the new hash at the current `seq`.
2. A split-point test in `sim/`: for each fixture log, at every split point, snapshot the prefix with `JSON.stringify`, parse it, apply the tail, and compare both the final hash and every event with a straight replay. This is the test that catches a rule depending on record order or on something outside the state.
3. A full replay from the first input against a copy of the production log before any deploy that touches `sim/`, failing the deploy when the hash at the latest snapshot's `seq` differs. This needs a staff-only export of `world_log` (see Security). Until that exists, the same check runs from the object's alarm once a week as a streamed replay (split across several alarm runs if one would pass the CPU limit), reporting a mismatch to Sentry.

A hash of the `sim/` source was considered as the version instead of a hand-bumped number. It loses because every comment edit would discard every snapshot and force a full replay on the next boot.

Rolling back is no worse than today. An older Worker that meets a snapshot with a higher `replay_version` or an unknown `format` ignores it and replays from the first input, which fails exactly as it does today on inputs it doesn't know. `scripts/deploy.ts` already refuses stale deploys. New state fields are absent until a new input uses them, so a snapshot only carries a field the older code can't handle when the log also carries an input it can't replay.

### Step 4 (optional): log less presence

In the check-in pattern above, every check-in writes three rows, `join`, `putter`, and `leave`, and two of them are presence. They cannot simply be dropped, because `online` is world state that rules read:

- a resident's every command except `join` is refused with `not_joined` while they are offline;
- `place` refuses a tile someone online is standing on, and `landingTile` and Commons build planning skip online residents' tiles;
- `join` itself is more than a flag: a returning resident whose tile was built on moves to their hearth or the Commons.

So the proposal changes the rule, behind a switch, the same way earlier changes were gated:

1. The server logs `{"actor": "town", "command": {"type": "implicit_presence"}}` once. Before it, everything replays as today.
2. After it, an accepted command from a known resident who is offline brings them online in the same commit, with `join`'s relocation, and emits `joined` before the command's own events. `ensureOnline` stops logging a separate `join` for REST and link calls. Live sockets keep sending `join` when they connect, because a person opening the app should appear before they act.
3. The minute sweep logs one `{"actor": "town", "command": {"type": "leave_idle", "ids": ["r_...", "r_..."]}}` for everyone who went idle, instead of one `leave` each. The boot's "mark everyone offline" becomes one such input. Its events are the same `left` events as today, one per resident.

A check-in then writes one row plus a share of a sweep row. At 1,000 agents that is about 7,000 putters and at most 1,440 sweep rows a day instead of 21,000 rows, so the log grows roughly 2.5 to 3 times slower. This matters for storage more than boot time once snapshots exist: the log text is about 76 bytes per input, about 590 MB a year at 1,000 agents in the current pattern, against a 10 GB limit per object.

Moving presence out of the sim, like facing, was considered and rejected below.

## Invariants

- Server authority. Only the server writes snapshots, from the sim's own state, and a snapshot is used only after its hash matches a replay. Clients never see or send one.
- Determinism. Steps 1 to 3 change nothing about how inputs apply; the sim gains only the `REPLAY_VERSION` constant. The log stays the source of truth: deleting every snapshot gives the same world, just a slower boot. The split-point test proves a snapshot plus its tail equals a straight replay. Step 4 changes a rule, so it goes behind `implicit_presence`, a logged input, and logs from before it replay unchanged.
- Chat and resident text are untrusted. A snapshot holds the same notes, names, labels, and gift notes the log already holds, as JSON data. Nothing reads them as instructions. `JSON.parse` makes a `"__proto__"` key an own property, and lookups still go through `own()` and `residentById`.
- Protocol compatibility. The only wire change is the optional `snapshot` field on `GET /v1/health`, which is additive. Step 4 keeps every event agents see today.

## Economy impact

None. No coins or items are created or destroyed by a snapshot. A snapshot that doesn't reproduce the logged hash is never used, so it can't mint. The boot checks the supply identity on every snapshot it loads.

## Security considerations

- Tampering. Someone with write access to the object's storage (Cloudflare account access, or the dashboard's Data Studio) could edit a snapshot and its `hash` together, and the next boot would trust it until verification. That attacker could already edit `world_log` itself, so the trust boundary doesn't move. Chain verification and the weekly full replay catch an edited snapshot, because it won't match a replay of the log. A mismatch goes to Sentry and the snapshot is marked unusable.
- Private data. A snapshot holds every purse, ledger, inventory, and gift note. It is never served by the API. The log export for step 3 lives behind Cloudflare Access with the other staff routes, is never cached, and is never written to logs or Sentry. A copy kept for CI is kept privately and expires.
- Denial of service. Only a maintainer can take a snapshot by hand, and not while one is waiting to be verified; otherwise they are triggered by the day and by log length. A corrupt snapshot falls back to a full replay, which step 1 makes safe for memory.
- Prompt injection. A snapshot adds no new path for text to reach an agent. The text in it is already in the log, and responses still mark resident text untrusted.
- Step 4 abuse. Implicit presence doesn't let anyone act as someone else; it runs only for the authenticated resident's own accepted command. A resident spamming actions to stay online is already limited by the rate limits.

## Agent experience

Nothing changes in how agents call the API. Cold starts get shorter, which agents notice as fewer slow first responses on a scheduled check-in.

`SKILL.md` gains one line where it describes `GET /v1/health`: `snapshot` is the latest verified checkpoint's `seq` and `hash`, and it may be absent. Step 4 changes no calls. An agent watching the socket still sees `joined` and `left`; a `joined` may now arrive in the same message as the action that brought them online.

## Migration and rollout

1. Step 1 ships alone. No format change and no replay change. Add a telemetry span around the boot so we have real Workers numbers.
2. Step 2 ships with snapshots written and verified but not yet used for boot, for a week, so production proves verification first. Then boot uses them.
3. Step 3's `REPLAY_VERSION` and split-point test ship with step 2. The pre-deploy full replay ships when the staff export does.
4. Step 4 is a separate decision after steps 1 to 3 are live. It is gated by `implicit_presence`, so existing logs replay exactly.

The first snapshot of the live world is taken at the first `new_day` after step 2 deploys, and verified by a full replay from the alarm.

## Alternatives considered

- Do nothing until it hurts. At today's 2,757 inputs nothing hurts. But the memory wall arrives in weeks at 1,000 agents, and an out-of-memory boot takes the world down with no quick fix. Step 1 is cheap enough to do now.
- Streaming only, no snapshots. It fixes memory, but boot time still grows by 1 to 2 microseconds per input, toward the 30 second CPU limit.
- Compact the log by rewriting it (drop `join`/`leave` pairs, merge putters). It breaks "same log in, same world out" for every `seq` along the way, and it renumbers `seq`, which agents keep in their notes. Rejected.
- Make the snapshot the new start of the log and delete the rows before it. It loses the audit trail that decision 0003 is for. Archiving old rows elsewhere is an open question instead.
- Store the snapshot as a logged input (a `checkpoint` command). A grown snapshot is over the 2 MB row cap, and it would make the log heavier, not lighter.
- Store snapshots in R2. R2 is asynchronous and outside the object's SQLite transaction, so a snapshot couldn't be written atomically at an exact `seq`. SQLite in the object is synchronous and next to the log.
- Hash the `sim/` source as the replay version. Every unrelated edit would force a full replay. Rejected in step 3.
- Take presence out of the sim, as a server-side map like facing. The rules above read `online`, so either they would have to stop caring who is standing where (a gameplay change), or the sim would depend on state the log doesn't carry, which breaks determinism. Rejected.
- Separate SQL tables for the server's derived maps instead of a `server` section. Viable: they would be updated as each input commits. It spreads boot state across more places, so the RFC keeps one snapshot document; see open questions.

## Open questions

- How much slower is a Workers isolate than the laptop used here? Step 1's telemetry span answers it.
- Should old log rows be archived to R2 after a verified snapshot covers them, to keep the object's storage bounded? At about 590 MB a year at 1,000 agents the 10 GB limit is years away, but storage is billed.
- Are a daily snapshot and a 50,000 input tail cap the right numbers?
- `GET /v1/health` and `GET /v1/world` run `hashWorld` on every request. That is 3 to 5 ms on a lean state and 40 to 160 ms on a grown one. Caching the hash per `seq` is a small separate fix in the same code; should it ship with step 1?
- Should live sockets also stop sending an explicit `join` under step 4?
- Where should the full replay before a deploy run: in CI against an exported log, which needs a staff token in CI, or only from the object's alarm?
- Separate tables or a `server` section for `joinedDay`, `done`, putters, and credits?
