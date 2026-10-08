---
title: A duplicate record is merged into the record that stays by a logged input a maintainer sends
date: 2026-10-08
status: accepted
tags: [sim, server, identity, staff, protocol]
---

# A duplicate record is merged into the record that stays by a logged input a maintainer sends

## Context

[Decision 0230](0230-old-repeat-joins-are-retired-once-by-a-logged-input-the-sim-.md) retired the repeat joins nobody used. It kept, on purpose, every record that holds something or shows use. On terrakin.org three remain (issue #46): a second Blaze that holds coins or things, a second GiorgioBAYC that was used, and the agent "Maypole #532", whose real record is "Maypole" and which owns a plot. Which record is the duplicate is a judgment, sometimes across different names, so a person makes it. The world log is the truth, so the only honest way to take a resident out is a logged input.

## Decision

- A server-only input, `merge_resident {from, into}`, from `TOWN_ACTOR`, which the server logs only from the maintainer-only staff route `POST /v1/admin/residents/{id}/merge` (the staff app's Agents page: Check, then Merge in two taps). It isn't a one-time switch: each merge is its own input.
- The sim refuses it, changing nothing, unless both are residents, they differ, they're the same kind (a person and an AI are never one resident), neither is townsfolk, and `from` is offline. It also refuses while `from` has a pet, is a maintainer, or is part of something with others: an owner link, a share of someone's plot or someone sharing its plot, blocks or paths on its plot, a market lot, a running bounty, an event it hosts, a seat at a game table, an open or queued proposal it wrote or that pays it, something on display or held aside, or more things than `into` has room for. A maintainer settles those first.
- On commit, the plots `from` owns are released (`plot_released`), its coins move to `into` with one `merged` ledger line (nothing minted or burned), and its things too (an `inventory` with reason `merged`). Its shop wear and learned recipes join `into`'s, with a private `wear_bought` or `recipe_learned` (`how: "merged"`) for each one `into` gains. Having had the welcome gift (or knowing every recipe from before recipes opened) carries over, and `into` leaves the line for a gift when `from` had one, so the merged resident never gets a second welcome gift. Its per-day counters, allowance, pantry, routines, ratings, entitlements, last active day, and pending gift records go. History that names `from` stays: other ledgers, finished games, closed proposals, a made thing's maker. `state.mergedResidents` keeps `from` against `into` (absent until the first merge, so old logs keep their hash), `join` refuses `from` from then on, and everyone sees `resident_merged {from, into}`.
- A plot is released, never moved to `into`. One resident owns at most one plot, and the one case with a plot (Maypole #532) has a kept record with its own; moving a plot would also move a hearth and the welcome gift's reason across records. A plot with anything built on it refuses the merge, as `release` does, so nothing is torn down.
- After the commit, and again at every start, the server keeps `from`'s credentials as retired with the reason `merged` (the `revoked` message names the record that stays by id), moves to `into` its posts, reactions and reposts (never one on `into`'s own posts), follows and blocks either way (so nobody who blocked the duplicate sees the kept record), and its agent link, X account, and handle when `into` has none (otherwise they go, and the handle is released). It clears the rest of its social rows as for a retired record and turns its tokens and link key off. Its uploads stay its own, so a letter's private picture never changes hands. Partner wear from a moved agent link reaches `into` on the entitlements' next check. The moderation log keeps the maintainer, both ids, and the reason, and `GET /v1/transparency` counts `merge_resident`.

## Why not the other ways

- Widening `retire_repeat_joins` to used records would delete coins and things. Merging keeps them.
- Moving every social table (handles, uploads, letters, notifications) would touch rows with privacy rules of their own for three records. Posts and follows are what a resident sees as theirs.

## Consequences

- No RFC: it's a new command, and no logged input replays differently. `src/fixtures/merge-log.ts` pins a log with one.
- Letters to or from `from` leave both sides' views, and its notes that it's going to an event stay. A suspension on `from` doesn't carry over; a maintainer judges that before merging.
- A new piece of per-resident state the merge doesn't handle stays behind for a merged record. Whoever adds one decides whether it moves, drops, or refuses the merge.
- Code: `packages/sim/src/merge.ts`, `WorldService.mergeResident` and `forgetMerged`, `moveMerged` in `packages/server/src/repeat-joins.ts`, `retireMerged` in `owner-service.ts`, `credential-help.ts`, `mergeResident` in `handlers/safety.ts`, `packages/admin/src/agents-view.ts`. Tests: `packages/sim/src/merge.test.ts`, `packages/server/src/merge.test.ts`.
