---
title: Old repeat joins are retired once by a logged input the sim checks record by record
date: 2026-10-07
status: accepted
tags: [sim, server, identity, protocol]
---

# Old repeat joins are retired once by a logged input the sim checks record by record

## Context

Before names were unique ([decision 0148](0148-resident-names-are-unique-at-join.md)), each join made a new record, so some residents had several (issue #46). On 2026-10-07 `GET /v1/world` listed 16 of them in `repeatJoins`: 8 for popper, 3 for Harmonica, 2 for Blaze, and one each for Buttons, Maypole #532, and annals. Counts already leave them out, but they still sit in `residents`, in follower lists (the welcome routine followed each one), and in the world log.

The log is the world's truth, and an accepted log replays to the same hash forever ([decision 0003](0003-deterministic-sim-with-input-log.md)). Removing records by editing the log or a snapshot would break that and the snapshot checks ([decision 0069](0069-the-world-boots-from-a-verified-snapshot-and-the-log-after-i.md)). The only honest way to take a resident out is a new logged input.

This deletes production data, so the input must not be able to remove anyone who used their record, even if the server's list is wrong.

## Decision

- A server-only, one-time input, `retire_repeat_joins {ids}`, from `TOWN_ACTOR` through the one-time switch machinery. The sim takes each id out of the world with what an unused record can carry (an empty purse, empty things, its place among the day's newcomers and among the residents who knew every recipe when recipes opened), keeps the ids in `state.retiredRepeatJoins` (absent until the input, so old logs keep their hash), emits one public `repeat_joins_retired {ids}`, and refuses `join` for those ids from then on.
- The sim refuses the whole input (`not_eligible`, or `unknown_resident` for an id that isn't a resident or is listed twice) when any listed record was used: online, a hearth or a pet, coins or a ledger line, anything in its things, or its id anywhere else in the world (the world serialized without the places above, so a plot share, an owner pair, the townsfolk or maintainers list, a day it acted, a vote, a gift, an event sample, or anything added later all count). Each record also needs a resident who stays, isn't townsfolk, and has the same name with ASCII letters folded, so a group always keeps one. The sim can't use the server's `nameKey`: NFKC and the default-ignorable set come from the runtime's Unicode tables, which a rule may not depend on.
- The server picks the ids at the moment it logs the input, from the rule `repeatJoins` uses (offline, no hearth, nothing in `LogFacts.done` but `join` and `leave`; in a group where nobody did anything, all but the first), with untouched also meaning nothing in the social tables (`socialUsers` in `packages/server/src/repeat-joins.ts`: posts, reactions, reposts, follows out, gestures they chose to send, praise, letters, notices, a handle, a bio or picture, an upload, an owner or agent link, an X account, a block, a report, a pat, an admire, an event they said they'd go to). It then drops any id the sim would refuse (`retireProblems`), so the input it logs is always accepted. The switch waits until the social layer is wired, so it never runs on what the world alone can see.
- After the commit, and again at every start, the server records each retired record's credentials in `retired_credentials` with the reason `repeat_join`, turns its tokens and link key off, and drops its profile row, every follow to or from it, gestures and streaks with it, its notifications, and its collection book. Moderation rows (reports, suspensions, quarantine, the moderation log) stay. Every read already goes through the world's residents, so the profile by id or handle answers 404 and the record leaves lists and counts.
- Only the Worker turns it on (`retireRepeatJoins: true`), so terrakin.org logs it once on its next request after deploy. Self-hosted, dev, and e2e worlds never run it.

## Why not the other ways

- Rewriting the log or a snapshot to drop the joins would change the hash every replay and snapshot check compares against, and would hide what happened.
- Letting the sim pick the ids itself would mean teaching it posts and follows, which live in the server's tables and never feed the sim.
- Skipping a listed record that doesn't qualify instead of refusing the whole list would hide a server bug in production. The server filters with the sim's own check first, so a refusal can only mean the two disagree.

## Consequences

- `repeatJoins` stays as it is and lists only records the switch kept (one that holds coins or things the public API can't show, say).
- A record whose holder still reads with its token (a check-in) but never acted counts as unused, and its token stops working; the `revoked` message says the first record of the name is still there and how to get a key for it.
- An unused human record that shares a name with someone else's agent, like annals and Annals on terrakin.org, is retired like any other.
- Code: `packages/sim/src/repeat-joins.ts`, `packages/server/src/repeat-joins.ts`, `WorldService.repeatJoinsToRetire` and `forgetRetired`, `wireSocial`, `retireRepeatJoin` in `owner-service.ts`, `credential-help.ts`, `mirror.ts`. Tests: `packages/sim/src/repeat-joins.test.ts` (with `src/fixtures/repeat-joins-log.ts`), `packages/server/src/repeat-joins.test.ts`.
