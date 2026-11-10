---
title: A hardening sweep: snapshot boot fixed, server guards, dedupe, a sim fuzz, three RFC drafts
date: 2026-11-09
tags: [hardening, snapshots, tests, fuzz, rfc-0053, rfc-0054, rfc-0055]
---

# A hardening sweep: snapshot boot fixed, server guards, dedupe, a sim fuzz, three RFC drafts

## Done

Five read-only audits (server, sim, client and ui, tests, what agents read), then fixes from what they found.

- Snapshots record `origin`, the config the world was created from, and a boot compares that and never `world.config`. Before this, no snapshot taken after `regrid` or `open_land` could be verified, so each boot replayed a longer tail. The snapshot format is 2.
- Server guards, each with a test that shows it refuses: `hello` sockets capped per resident (5), per network (100) and for those listening for posts (2,000), with a resident at the cap able to replace a socket silent for 30 seconds; a maintainer's re-key by resident token is logged and refused where staff sign in through Access; an invite from a suspended resident is gone; `GET /v1/world` builds its snapshot at most once a second per `seq`; triage calls time out; test routes are gated by the `/v1/test/` prefix and refuse anything through a proxy; the idempotency store has a per-resident cap that never forgets a running request; the request body cap has its test.
- Words that disagreed with the rules: the check-in and link pages' attendance line, settle's `plot_limit` refusal, `outside_lot` (it names the lot size that reaches the tile and how many steps away), SKILL.md's `nothing_under` row and its lines about self-hosted worlds, `docs/architecture.md`, and `docs/plans/README.md`, which has an RFC 0052 entry now. Decisions 0249, 0262 and 0285 are superseded by 0373.
- The knowledge index lists superseded decisions in their own block and the newest 3 handoffs.
- Sim: a fixture on both sides of six switches that had none, a supply check over every fixture, refusal tests for the land and way size limits, and one helper each for the shop payment split, a plot about to change, a tile on a slot, and what `release` finds on a plot.
- Client: one attachment uploader for posts and letters (letters gain the size check, the limit message and the stop after close), the vote outcome read from the sim's `tallyOutcome`, the sim's `chebyshev`, `inBounds` and `tileHash` in place of copies, `serverTime`, `Mirror.canBuildAt`, `stored.ts`, `townNews`, `chunkPlan` and `placeTags`.
- CSS: lazy views' styles moved out of `style.css` into each view's sheet, pieces `packages/ui` builds are styled in `base.css` (a test holds it), and docs and footer links tap at 44px.
- Tests: `scripts/mirror-parity.test.ts` runs every fixture through the client's mirror and found the missing `townsfolk_set` case, now fixed. `packages/sim/src/fuzz.test.ts` throws seeded random commands at real worlds and checks every invariant after each input (`pnpm fuzz` for a long run). The replay test checks one step from every snapshot. The e2e suite allows no fixed wait.
- Three RFC drafts: [0053](../../rfcs/0053-two-rule-gaps-behind-one-switch.md), [0054](../../rfcs/0054-a-log-checkpoint.md), [0055](../../rfcs/0055-a-ceiling-on-joins.md).

## State of things

- `pnpm verify` is green on main.
- `build.spec.ts`'s lot outline step failed whenever the world's clock read night, since the outline was drawn under the night's tint. The outlines are drawn over the night now. On the maintainer's machine `town.spec.ts`'s 3D crowd photo times out now and then under load; it passes in CI.
- CI did not run on f5bc6087: the run ended in about a minute with no jobs and GitHub's "workflow file issue" note. The workflow file had not changed since earlier green runs that day.
- The staff app was looked at on a phone viewport after the stylesheet move: the queue with a reported picture, Townsfolk and Keys draw as before.
- After the deploy the first boot replays the whole log once, since a format 1 snapshot is never opened. The next new day's snapshot is format 2 and boots use it once the minute sweep verifies it.
- Known and left: a connected client keeps the old recipe page edition until it reloads, since `page_edition_set` stays off the wire (`KNOWN_GAPS` in the mirror parity test). `set_townsfolk` and the owner-pair commands accept ids like `hasOwnProperty` (`KNOWN_FAILURES` in the fuzz); only the server sends them.

## Next

1. Read the first CI run on main after this push. If it also ends with no jobs, the cause is in GitHub Actions for this repo and not in a commit.
3. After the deploy, check `GET /v1/health` shows a verified snapshot within a day.
5. Make `set_townsfolk`, the owner-pair commands and `join` look ids up with `own` and `isOwnableKey`, behind the switch RFC 0053 proposes if a logged input could differ.

## Open questions

- RFC 0053's other questions: one switch or two, and whether townsfolk keep an upstairs they already have. Ryan answered the Commons yard on 2026-11-09: blocks refused, paths allowed.
- RFC 0055: the numbers for a world-wide ceiling on joins, and what a person sees when it is full.
- Invite codes are stored as they are issued, not as a hash like owner codes. Hashing them needs a column pass over open invites.
- With the Access variables missing from the Worker, staff routes on the main host would accept a maintainer's resident token. Both variables are plain `vars` in `wrangler.jsonc`, so losing one takes an edit to that file.

Answered on 2026-11-09: RFC 0054 is accepted as "not now"; RFC 0053 gets one switch and townsfolk keep what they have; RFC 0055 starts at a burst of 60 and 30 an hour. Growing a lot is the agent's own call (SKILL.md version 50), and the tests that pin a whole table of constants stay.
