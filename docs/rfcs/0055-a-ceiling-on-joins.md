# RFC 0055: Keeping the world log from being grown by abuse

- Author: drafted by Claude for Ryan
- Date: 2026-11-09
- Status: accepted (Ryan, 2026-11-09; option A and the `insertSorted` fix built, answers under Open questions)
- Discussion: <PR link>
- Builds on: [RFC 0014](0014-world-snapshots.md) (snapshots and the 128 MB isolate), [RFC 0048](0048-guest-visitors.md) and [decision 0380](../knowledge/decisions/0380-a-newcomer-walks-the-town-as-a-guest-first-and-moves-in-with.md) (guests walk without joining), [decision 0148](../knowledge/decisions/0148-resident-names-are-unique-at-join.md) (unique names), [decision 0230](../knowledge/decisions/0230-old-repeat-joins-are-retired-once-by-a-logged-input-the-sim-.md) (retiring old repeat joins), [decision 0141](../knowledge/decisions/0141-the-newcomer-funnel-counts-first-steps-from-what-the-world-a.md) (the newcomer funnel)

## Summary

Every new resident is a `join` in the world log, kept forever, and a record in the world state, kept until staff remove it. The only limit on making one is per IP address: 3 a minute with a burst of 20, about 4,320 a day for each IPv4 address or IPv6 /64. Nothing limits the world as a whole, so a network with many addresses can add residents without end, and each one grows the snapshot, the boot's memory, and replay time for good. This RFC proposes a world-wide joins-per-hour bucket that honest newcomers never reach, with invites drawing on a share of their own; weighs deferring the logged `join` until a resident's first real call; and says how unused records could stop costing state. It recommends the world-wide bucket first, sized from two weeks of hourly counts, because it changes no rule and no replay, and getting people in is the stated priority.

## Motivation

The persona is every newcomer, and the town that has to stay up for them. [docs/plans/README.md](../plans/README.md) puts new work on getting people in and keeping them, so a fix here must not cost an honest newcomer a join.

### Where joins come from

Four doors call `createResident` in `packages/server/src/world-service.ts`, which logs `{type: "join"}`:

| Door | Limit |
|---|---|
| `POST /v1/session` (`createSession` in `handlers/world.ts`) | `rateLimit: "sessions"`, per IP |
| `POST /v1/invites/{code}/accept` (`acceptInvite` in `api.ts`) | `rateLimit: "sessions"`, per IP |
| The live socket's `hello` with a name (`live.ts`) | `api.takeSession(ip)`, per IP |
| `GET /v1/join` with its confirm code (`links/keys.ts`) | the same `sessions` bucket, per IP, only when it joins |

The bucket is `RATE_LIMITS.sessions` in `packages/protocol/src/route-table/shared.ts`: `perSecond: 3 / 60, burst: 20`, keyed by `ipKey` in `handlers/shared.ts`, which groups IPv6 by /64. That is 200 joins in the first hour from one key and 180 an hour after. `createResident` also refuses a filtered name, a name that breaks `nameProblem`, and a name another resident holds (`nameTaken`), but a script picks fresh names. There is no ceiling across keys. An IPv6 /48, which many hosts hand out, holds 65,536 /64s.

### What a join costs

Measured with the real sim on a laptop (a script that opens coins and items, then logs `join` and `leave` for N residents with unique names):

| | Per join |
|---|---|
| World state, an unused record (resident, purse, things) | about 160 to 173 bytes |
| World log, `join` plus `leave` | about 137 bytes |
| Replay, `join` plus `leave`, 500 joins a day | about 50 microseconds |

The state cost is what matters. A Durable Object has 128 MB for everything (RFC 0014). At 170 bytes a record, 100,000 junk residents are 17 MB of world state before the server's own per-resident maps (`LogFacts` in `snapshots.ts` keeps each resident's join day and done kinds), the welcome routine's social rows (`onNewResident` notes each one for the townsfolk welcome), and the snapshot that carries all of it. At one address's 4,320 a day that is 23 days; at 100 addresses, under a day.

Replay has a second cost the measurement found. Within one world day, replay time per join grows with the day's joins:

| Joins in one day | Microseconds per join and leave |
|---:|---:|
| 2,500 | 42 |
| 5,000 | 65 |
| 10,000 | 137 |
| 40,000 | 786 |

40,000 joins in a day take 31 seconds to replay. The cause is `markNewcomer` in `packages/sim/src/economy.ts`, which adds each new resident to `economy.today.newcomers` through `insertSorted`: an `includes`, a `push` and a full `sort` on every join. The list is cleared each `new_day`, so spread over days it is flat; in a burst it is quadratic.

### What exists against it

- **Guests (decision 0380, RFC 0048).** A person on the web walks the town as a guest before they move in, and a guest is never in the log. That keeps a curious person who leaves from becoming a record. It does nothing for a script, or for an agent, which joins through `POST /v1/session` or `GET /v1/join` straight away.
- **Retiring repeat joins (decision 0230).** `retire_repeat_joins` in `packages/sim/src/repeat-joins.ts` takes unused records out of the world, and the server's `socialUsers` in `repeat-joins.ts` makes sure nothing it takes was ever used (any authenticated call, a passkey, a handle, a follow). But it is a one-time switch (`oneTimeSwitch` on `state.retiredRepeatJoins`), and it takes a record only when a resident who stays has the same name and kind. Since names are unique at join (decision 0148), no new record has a namesake, so it can't take any record made after it ran. And a retired record's `join` stays in the log.

### How many honest joins there are

RFC 0048's read: by 2026-10-25, 33 people and 43 AIs had joined in all, and the busiest week had 8 people. The plans page reads a week of Oct 12 at 8 joins. Even counting agents and townsfolk runs, honest joins are a few dozen a week, single digits on the busiest hour.

## Design

### Option A: a world-wide joins bucket

One more bucket in `Api`, not keyed by IP: `RATE_LIMITS.joins = { scope: "world", perSecond: 30 / 3600, burst: 60 }`, taken by `createResident` itself, so all four doors share it whatever the per-IP bucket says. Numbers to be set from the measurement below; these are a starting point at more than ten times any honest hour seen so far.

Invites get a share of their own. An accepted invite is vouched for by a resident, so it takes from `joinsInvited` (`burst: 20, perSecond: 10 / 3600`) instead, and only when the inviter has a hearth and joined at least one world day before. Without that rule a sybil could invite more sybils: each resident holds `MAX_OPEN_INVITES` (5) open invites.

When the bucket is empty:

- A person on the web stays a guest. The "Move in" button answers with the server's words and a time, and their walk, chosen name and look stay on their screen to try again:

  ```json
  {"error": {"code": "rate_limited", "message": "A lot of people are moving in right now. Try again in 4 minutes. You can keep looking around."}, "retryAfter": 240}
  ```

- An agent gets the same `rate_limited` with `retryAfter`, the shape SKILL.md already teaches for putters and builds. `GET /v1/join` says it in its page.
- The server reports a `world.joins_full` gauge (counts only), so Ryan hears about it the first time it happens, not from a newcomer.

What it costs an honest newcomer: nothing while nobody is abusing it. Under an attack, newcomers wait behind the attacker for minutes, and an invited newcomer doesn't wait at all. What it costs an attacker: the world can still gain up to 720 residents a day (about 120 KB of state), 263,000 a year (about 45 MB). That is a ceiling, not a cure, which is why option C exists.

It needs no sim change, no switch, and no replay change. The per-IP bucket stays as it is.

### Option B: defer the logged `join` until a first real call

`createResident` would issue the id and token and keep the profile in a server table (`pending_joins`) without logging anything. The first authenticated call with that token logs the `join` and then answers the call. A token never used again never reaches the log. Names in `pending_joins` count as taken for 24 hours, then free.

- Gain: an agent whose fetcher retries, or a person who closes the tab after the door (decision 0380 already covers the web), never becomes a record. The funnel's `sameName` count says how often that happens.
- Cost: a protocol change. `POST /v1/session` answers with `world` today, and `GET /v1/join` tells the agent where it is standing; both would describe a resident not yet in the world. The townsfolk welcome (`onNewResident`) waits for the first call. Every route that takes a viewer must handle a pending one, or log the join first.
- It does not stop an attacker: a script makes one call per token.

### Option C: unused records stop costing state

A repeating `retire_unused {ids}` from `TOWN_ACTOR`, logged at most once a world day, which takes records with no use anywhere (the same `retireProblem` checks and the server's `socialUsers`) and older than 30 world days, with no namesake needed. `state.retiredRepeatJoins` becomes a record keyed by id, since `isRetired` reads it with `includes` and the list would grow.

- Gain: an unused record's 170 bytes, its server maps and its social rows go. The world's state stays proportional to residents who did something.
- Cost: a new sim command with a fixture, and a decision on what "unused" means for a record that only read. The `join` and the `retire_unused` both stay in the log, so replay pays about 50 microseconds per drive-by forever. Only a checkpoint ([RFC 0054](0054-a-log-checkpoint.md)) removes that, and RFC 0054 recommends against one for now. At 50 microseconds, a million drive-bys add 50 seconds to a full replay and nothing to a snapshot boot.

### A fix that needs no RFC

`insertSorted` can insert at the place a binary search finds instead of pushing and sorting. The array is the same after every join, so the world's hash and every event are the same and nothing about replay changes; only its time does. It belongs in a commit of its own, with a test that 20,000 joins in a day replay in linear time (a ratio of times, not a clock), since the burst case is exactly an attacker's.

## Recommendation

Ship **option A** first, after two weeks of measuring, plus the `insertSorted` fix. It is server only, changes nothing that replays, and caps the damage at a number we choose. Then decide on **option C** from what the measurement shows about drive-bys. Leave **option B** for now: the web path already defers through guests, and for agents it costs a protocol change without stopping abuse.

What to measure first, from `GET /v1/admin/newcomers` (`newcomers.ts`) and one new gauge:

1. Joins per hour, people and agents apart, for two weeks. The world log has no times (`world_log` rows are `seq` and `input`), and `LogFacts` keeps only the join day, so this needs a counter in `createResident` sent as a `world.joins` gauge each hour. The bucket's refill should be at least five times the busiest hour seen, and its burst at least the busiest ten minutes times three (a Sunday gathering arriving together).
2. Invited joins against the rest, from `invites` rows used in the window.
3. The share of each week's cohort that reached no step at all: joined, but not claimed, no look, no hearth, no social act, no handle. That share sets whether option C is worth its command.
4. The funnel's `sameName` count per week, which says how often one person makes two records, the case option B is for.
5. The world's `seq` from `GET /v1/health` each day, so joins can be read against the log's growth.

## Invariants

- **Server authority.** Option A is a server limit, like the per-IP one. Option C is a sim rule, checked by the sim from the server's list, as decision 0230's was.
- **Determinism.** Option A changes nothing in the sim. Option C is a new command, so logs before it replay as they were. The `insertSorted` fix gives the same array.
- **Untrusted text.** No text added. The refusal is fixed words with a number.
- **Protocol.** Option A adds a `rate_limited` answer to the four join doors under an existing code, with `retryAfter`; nothing breaks. Option B would change what `POST /v1/session` and `GET /v1/join` answer.

## Economy impact

A join mints nothing. But a resident who settles or claims a plot gets a 50-coin welcome gift from the treasury (`welcomeDue` in `economy.ts`), and is queued in `econ.owed` when the treasury can't pay, which holds up every newcomer behind them. A sybil that claims also takes a plot, and when the free plots downtown fall to `LANDS.openAt`, the town opens a new land. Option A caps all three at the bucket's rate. It doesn't change any number.

## Security considerations

- **Address rotation.** The attack this RFC is about: many /64s, or many IPv4 addresses from a cloud provider, each under the per-IP limit. Option A is the only option that bounds it.
- **Locking newcomers out.** An attacker who drains the world bucket keeps honest newcomers out for as long as they keep it drained. Invites keep a way in, guests keep looking, and the gauge tells staff to act (a Cloudflare rule on the addresses, or a lower per-IP limit).
- **Invite chains.** Bounded by requiring a hearth and a day's age for an invite to take the invited share.
- **Retiring someone real (option C).** The same checks decision 0230 uses, with any authenticated call counting as use, so a record that ever did anything stays.

## Agent experience

SKILL.md's joining section says that a join can be refused with `rate_limited` when many are joining at once, and to wait `retryAfter` seconds and try again with the same name. The CHANGELOG gets an Added line for the new refusal.

## Migration and rollout

1. Ship the `world.joins` gauge and the `insertSorted` fix.
2. Read two weeks of the five numbers above, then set `RATE_LIMITS.joins` and `joinsInvited`.
3. Ship option A. It applies to every world with no switch; self-hosted owners can override it like `sessionsPerMinute`.
4. Decide on option C from number 3.

## Alternatives considered

- **A CAPTCHA at the door.** Turns away agents, which are half of Terrakin's residents and the half it is built for, and makes a person's first minute worse.
- **A tighter per-IP limit.** Cheap and worth doing if the measurement shows nobody honest makes more than a few joins an hour from one address, but it doesn't bound rotation.
- **A proof of work on `POST /v1/session`.** Raises the price per join for a script and costs every phone a battery hit. A world-wide ceiling bounds the damage without it.
- **Requiring a verified agent card or an X link to join.** Shuts out the person who just wants to look, and the agents with neither.

## Open questions

1. **The ceiling's numbers.** Recommended: start at a burst of 60 and 30 an hour, then set them from two weeks of hourly counts at five times the busiest hour.
   - Answered 2026-11-09 by Ryan: start at a burst of 60 and 30 an hour, for the whole world.
2. **What a person sees when it is full.** Recommended: they stay a guest, keep looking around, and the move-in answer says how many minutes to wait.
   - Answered 2026-11-09 by Ryan: as recommended.
3. **Do invites skip the ceiling?** Recommended: they take a smaller share of their own (a burst of 20, 10 an hour), and only from an inviter with a hearth and a day in the town.
   - Answered 2026-11-09 by Ryan: as recommended. Any other invite takes from the main bucket.
4. **Option C: retire unused records on a schedule?** Recommended: decide after the measurement; if more than a third of a week's joins reach no step, build it with 30 world days of no use as the line.
   - Answered 2026-11-09 by Ryan: not in this build.
5. **Tighten the per-IP limit too?** Recommended: not yet. Read the hourly counts first.
   - Answered 2026-11-09 by Ryan: not yet. Deferring the logged join (option B) is out of scope too.
