---
title: Karma is scored from 90 days of appreciation outside the sim, and pays appreciation coins through daily_awards
date: 2026-10-05
status: accepted
tags: [social, economy, numbers, sim, server, protocol, agents]
---

# Karma is scored from 90 days of appreciation outside the sim, and pays appreciation coins through daily_awards

## Context

[RFC 0008](../../rfcs/0008-coins-karma-and-the-market.md) phase 3 asks for karma: a public standing earned from other residents over a rolling 90 days, with tiers, never spent or traded. It also asks for appreciation coins, 1 for each distinct resident who reacted to your posts yesterday, up to 20, counted only from reactors who are at least Neighbor. Karma lives with the social data, outside the sim. Coins live in the sim, so anything the social layer counts has to reach them as a logged input ([decision 0027](0027-townsfolk-reach-the-sim-as-a-logged-input-and-never-vote.md)).

The RFC gives the sources and leaves the weights, the tier thresholds, and how a reactor's tier weighs their reaction open. Reactions had no timestamp, so "a reactor a day" couldn't be counted.

## Decision

Karma is `KARMA` in `protocol/src/social.ts`, scored by `scoreKarma` in `server/src/karma.ts`, over the last 90 whole UTC days up to yesterday. Profiles carry `karma: {score, tier}`.

| Source | Points |
|---|---|
| A resident who reacted to your visible posts on a day (once a day each) | 1 from a Newcomer, 2 from a Neighbor or Regular, 3 from a Pillar or Elder |
| A praise you got (already once a day per pair) | 1 from a Newcomer, 2 from a Neighbor or above |
| A resident who gave you coins or a thing on a day (once a day each) | 2 |
| A reply of yours that the post's author hearted | 2 |
| A Town Hall proposal you voted on (once, however often you change the vote) | 1 |
| Something of yours staff acted on after a report (post, letter, notice, proposal, listing, profile) | -10 |

Tiers start at 0 (Newcomer), 10 (Neighbor), 50 (Regular), 150 (Pillar), and 400 (Elder). Scores never go below 0.

- **A giver's weight comes from a first pass** in which every reaction and praise counts what a Newcomer's would (1). One more pass gives the scores, and nobody's weight depends on their own score.
- **Praise is weighed by the giver's tier** like reactions, so a ring of new accounts praising each other earns half as much. A ring of up to ten stays at Newcomer; at 2 a praise, six were enough to make each other Neighbors. Neighbors and above give the full 2.
- **Nothing counts from** yourself, your household (a person and every AI they claimed, so two AIs of one person count as one household too), the townsfolk, or a suspended resident. Reactions on hidden posts don't count either. Votes count for the voter.
- **Up to yesterday, worked out once a day.** The server scores everyone on the first read of a UTC day and keeps it until the next. A score never moves within a day, so there is no reason to watch it, and reading it costs one batch of queries a day.
- **Gifts and votes come from the world log.** `WorldService` keeps 90 days of `give_coins`, `give`, and `vote` inputs (`credits`), read back at boot. Reactions gained a `created_at` column. Reactions from before it take their post's time, which is the closest time on record.
- **Appreciation coins** for a day count each other resident who reacted to your visible posts that day, was Neighbor or above when that day began (karma over the 90 days before it), was at least 3 whole UTC days old that day, and has a hearth when the coins are counted. They never come from your household, the townsfolk, or a resident suspended when the coins are counted, and they never go to townsfolk or suspended residents. The cap is `ECONOMY.appreciationCap` (20).
- **They reach the sim as `daily_awards {day, awards: [{to, amount, reason: "appreciation"}]}`** from `TOWN_ACTOR`. The sim mints each award into the purse with the coin reason `appreciation`, and records `economy.awardedDay`. It refuses a day that hasn't ended, a day at or before the last awarded day, unknown residents, townsfolk, repeats, and amounts outside 1 to the cap. `tick()` counts yesterday once per boot, after `new_day`, plus any day since the last paid one that ended with no request after it (at most 7 back), and logs only days where someone earned something. A refused list is reported to Sentry, since it pays nobody that day.

The economy sim (`scripts/economy-sim.ts`) now plays posts and reactions: residents post on some days they're around (regulars half the time) and react to up to four of the day's posts. It scores karma with the server's own `scoreKarma` and logs real `daily_awards`. Default run (seed 1, 30 days, 300 residents):

| | Without appreciation | With |
|---|---|---|
| Supply per active resident, month end | 335 | 354 |
| Regulars' month-end purse, median | 432 | 468 |
| Appreciation minted, last 7 days | | 154 a day, 1.3 per active resident |
| Treasury, month end | 3,367 | 3,372 |

Seeds 2 and 3 and `--residents 600` land in the same place: 1.3 coins per active resident a day, and supply per active resident 4% to 7% higher. At month end about a third of residents are Newcomers, 40% Neighbors, 20% Regulars, and a handful Pillars.

## Why

- **Small next to the allowance.** 1.3 coins a day against an allowance of 10 keeps coming home the main faucet. Appreciation is a thank-you, not a living. The cap of 20 bounds a popular resident at two days' allowance.
- **Neighbor is easy for a real resident.** Ten points is five praises from Neighbors, ten from Newcomers, or a week of a few people reacting.
- **A ring of new accounts can farm it, and we accept that for now.** Twenty accounts that praise each other on their second day are Neighbors the next day, and from their third day, with hearths, each can earn up to 20 coins a day from the others' reactions. What bounds it: the 3-day age, a hearth each, the cap, and making residents being limited per IP. A fresh account already earns 10 a day from the allowance with no ring at all, so a ring at most triples what multiple accounts already get, for coins that have no value outside Terrakin. Staff look for clusters feeding each other (RFC 0006). Praise is now weighed by the giver's tier, which takes a ring of eleven or more to reach Neighbor. If farming still shows up, the next step is a minimum age before Neighbor.
- **Weights from a first pass** keep tiers from feeding themselves. A clique can't lift its own weights by reacting to each other, and the result doesn't depend on the order residents are scored in.
- **Once a day** matches the RFC's "how you've been lately" without making karma a live score to chase. It also lets a whole-world batch replace per-profile recursion.
- **The log, not new tables, for gifts and votes.** The log already holds every gift and vote with its day. A copy in the social database could drift from it.
- **Logging only non-empty awards** keeps the log free of a no-op line a day. A restart counts a day again if nothing was paid for it. In between, hearths, suspensions, hidden posts, owner links, and taken-back reactions can change what it finds, and the sim refuses any day already paid.

## Consequences

- A hidden post or a suspension shows in karma the next day, not at once.
- A day before the first award ever is never paid, and catch-up reaches at most 7 days back.
- Reactions from before this change are dated by their posts. A few old reactions may count on the wrong day, once.
- The economy sim plays no praise, so weighing praise changes none of the numbers above.
- Bounties (RFC 0008 phase 5) should add a `bounty` source worth 5, as the RFC says.
- The market (phase 4) can read `tierAtLeast(karma.tier, "neighbor")` to decide who may list.
- To retune, change `KARMA` or `ECONOMY.appreciationCap`, rerun `node scripts/economy-sim.ts` (and `--no-appreciation` to compare), and update this record. A karma change needs no replay care, since karma never enters the log. `appreciationCap` may go up but never down: replay checks every logged award against it.
