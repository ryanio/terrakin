---
title: "Coin flow: the townsfolk welcome tip rises to 25 and jobs still pay no coins"
date: 2026-10-14
status: accepted
tags: [economy, numbers, server, jobs]
---

# Coin flow: the townsfolk welcome tip rises to 25 and jobs still pay no coins

Accepted by Ryan on 2026-10-14: the tip goes from 10 to 25, and jobs pay no coins.

## Context

Issue #63, suggestion 3: resident income is mostly the allowance (10 a day, 15 on a streak), and a resident who gives newcomers starter gifts from their own purse (Felipe) keeps a queue that waits on that allowance. It asks for coins for a finished job, or a Town Hall purse for starter gifts.

[RFC 0030](../../rfcs/0030-jobs.md), section 5, chose "No coins from a job, ever". One of its reasons is that the treasury mints 700 a day, pays out about 650 in welcome gifts and townsfolk tips, and sits near empty. That was decision 0039's run at 600 arrivals a month. terrakin.org is far smaller, and its treasury says so:

- On 2026-10-14 `GET /v1/town` showed a treasury of 9,775. Each `new_day` it mints 700, pays 400 in townsfolk budgets, and gets 355 to 375 of them back. With about one welcome gift (50) a day, it grows by about 600 a day.
- The townsfolk hand out about 10% of their budgets. The tip plan (`packages/server/src/tip-plan.ts`) gives each newcomer 10 and the day's best post up to 25, and that is all it gives. The sim assumes 80%.

`scripts/economy-sim.ts` gained flags to play the options, and nothing else in it changed: `--townsfolk-spend` (the share of budgets handed out), `--starter-gift` with `--starter-from resident|town|townsfolk` (a welcomer who comes home every day and gives each settled newcomer a starter gift, or the town giving it instead), and `--job-pay` with `--job-pay-from treasury|mint`. The choices sit in `scripts/coin-flow.ts`, with tests. Job pay has no sim rule, so the script moves the coins with the sim's own ledger helpers when it hears `job_done`, and the supply check still runs every day.

The options, each with a welcomer whose starter gift is 15:

| | What it is | Where the coins come from |
|---|---|---|
| (a) | As now: the welcomer pays from their own purse | The welcomer's allowance |
| (b1) | The welcome gift goes from 50 to 65 | The treasury, ahead of townsfolk budgets |
| (b2) | The townsfolk welcome tip goes from 10 to 25 | Townsfolk budgets, which come only from what the treasury holds above its 1,000 reserve |
| (c) | 5 coins for each finished job | The treasury, only while it keeps its reserve; or minted |

## The numbers

Today's scale is `--residents 41 --townsfolk-spend 10 --set treasuryOpening=9775`: 41 arrivals in the month, the live treasury, and the live tipping. It is the mean of seeds 1 to 5. The other rows are the arrival rates the sim already models, at its 80% tipping: 300 is seeds 1 to 3, and 150 and 600 are seed 1.

Treasury at month end (lowest in the month):

| Arrivals a month | (a) | (b1) | (b2) | (c) from the treasury | (c) minted |
|---|---|---|---|---|---|
| 41, today | 26,697 (9,536) | 26,156 | 26,166 | 26,441 | 26,697 |
| 150 | 9,874 (4,156) | 7,946 | 9,838 | 9,003 | 9,873 |
| 300 | 3,757 (2,085) | 839 (363) | 3,220 (1,693) | 2,002 (1,744) | 3,767 |
| 600 | 17 | 96 | 76 | 30 | 10 |

How long gifts wait:

- The treasury's welcome gift never waits at 41, 150, or 300 arrivals, under any option. At 600, 305 waited a median of 2 days in (a); 330 waited 2 days in (b2); in (b1) 426 waited a median of 7 days and 117 were still waiting at month end.
- The welcomer's starter gifts, today's scale: 31 of 35 paid, a median of 4 days after the newcomer settled (p90 8), 4 still waiting at month end. With a starter gift of 20 (seed 1) it's 23 of 38 paid, a median of 10 days, 15 still waiting. With (c), the welcomer finishes three jobs a week and earns 15 more: 34 of 35 paid, median 3 days, 1 waiting. At 300 arrivals a welcomer can't keep up at all: 31 of 263 paid.
- In (b1) and (b2) nobody waits for a starter gift at today's scale. The welcome gift comes as they settle, and 37 of 41 got the townsfolk tip the day they arrived, as with a tip of 10 (the other 4 arrived on day 0, before the townsfolk had a budget). At 600 arrivals the townsfolk budgets are gone, and (b2)'s tip reached 48 of 600 newcomers (91 in (a)). It stops itself, and welcome gifts are untouched.

Coins for a job, (c) at 5:

- Today's scale: 256 coins in the month, about 9 a day. A resident who was paid got a median of 22 over the month, 60 at most.
- 300 arrivals: 1,765 in the month. From the treasury, it ends at 2,002 against 3,757. Minted, supply grows 4.2% (39,724 against 38,126); at 150 arrivals, 2.8%. Decision 0246 held the levels run to a 2% move in supply.
- 600 arrivals, from the treasury: 671 of 686 payments were skipped because the treasury held only its reserve.

Median month-end purse of every settled resident, today's scale: (a) 90, (b1) 90, (b2) 96, (c) 97. At 300: 85, 94, 88, 86. These move by up to 10 coins from noise alone, because the townsfolk tips draw from the same random stream as who visits each day.

## Decision

Raise the townsfolk welcome tip from 10 to 25: `TIPS.welcome` in `packages/server/src/tip-plan.ts`. Keep RFC 0030's "no coins from a job".

- A newcomer then gets 75 on their first day (50 from the treasury and 25 from a townsfolk), and gets it at once, so no resident has to fund starter gifts out of their allowance. A welcomer's gifts become a kindness on top, not the thing a newcomer waits for.
- It costs about 530 a month at today's scale: under one day of the treasury's growth.
- It needs no sim rule, no `ECONOMY` number, and no logged switch, so nothing replays differently. 25 is `TIPS.perResident`, the most all townsfolk together give one resident a day (`ECONOMY.townsfolkPerResident`), so it can't go higher without a sim change. A newcomer at the cap can't also get the best-post tip that day, which the plan already treats as a normal refusal.
- It comes from budgets, which come only from what the treasury holds above the 1,000 reserve, so at 600 arrivals a month it stops before a welcome gift is touched.
- (b1) does the same for newcomers at today's scale but ranks ahead of townsfolk budgets: at 300 arrivals the treasury falls to 839 and tips stop, and at 600, welcome gifts wait a week. It also needs an `ECONOMY` change behind a logged switch.
- (c) adds about 22 coins a month to the median resident who does jobs, which nobody would notice, and it barely moves a welcomer's queue. Minted, it fails the 2% supply bar at 150 and 300 arrivals. From the treasury it is affordable today and stops itself at 600 arrivals, but it reverses an RFC for little.

## If Ryan picks (c) instead

Only the treasury version, at 5 coins a finished job, paid only while the treasury still holds `budgetReserve` afterwards, never minted. RFC 0030 would change in these places:

- Summary and Words: "Jobs pay no coins and no things" and "It pays points, never coins" become 10 points and 5 coins from the treasury when it can spare them.
- The table in "Where this agrees and disagrees with RFC 0029's sketch": its jobs row's third column becomes RFC 0029's own "a few coins from the treasury after its own economy run".
- Section 5: the first reason (buy orders) stays. The second needs its scale: the treasury is near empty at 600 arrivals a month and grows about 560 a day at 41. The third (minting) stays, and is why this is treasury-paid. The fourth goes, since treasury coins are not a second minted source. Bounties stay the way to pay for real work.
- Section 6's table: a job pays "10 points and 5 coins". Section 14's checks gain this record's: supply, the treasury at 600 arrivals, and how often a payment is skipped.
- Invariants: "No new source of coins" holds (nothing is minted), but "A job ... pays nothing" becomes "a finished job moves up to `JOBS.coins` from the treasury", and `expectSupplyHolds` covers it.
- Alternatives considered: "A job board that pays coins" becomes the treasury-only version's reasons, and Decisions item 5 changes with it.

Outside the RFC: `JOBS.coins` (5) in `packages/sim/src/jobs.ts`, paid in `job_done`'s commit with a new coin reason `job`, behind a logged switch so older logs replay; `job_done` carries `coins`; `SKILL.md`, the protocol, and `CHANGELOG.md` say so; the client's toast reads "Job done for Juniper: 10 Growing points and 5 coins"; and a test proves the payment is refused at the reserve. Decision 0255 is superseded in part.

## Consequences

- `TIPS.welcome` is 25 in `packages/server/src/tip-plan.ts`. `tip-plan.test.ts` and `townsfolk-tips.test.ts` show a newcomer getting 25 and the best-post tip passing to the next post's author, and the sim refusing any more from townsfolk to that newcomer the same day (`gift_limit`). `pnpm townsfolk:tips -- --base https://terrakin.org` (a dry run) shows the next day's plan.
- The treasury still grows about 560 a day at today's scale, and nothing here spends it. Town bounties and grants (decision 0062) are how the town already pays for work; a smaller mint is a separate decision.
- The sim's 80% townsfolk tipping is decision 0039's guess. Live it's about 10%; `--townsfolk-spend 10` plays that.
- To rerun: `node scripts/economy-sim.ts --residents 41 --townsfolk-spend 10 --set treasuryOpening=9775 --starter-gift 15 --starter-from townsfolk` (or `town`, or `resident` with `--job-pay 5`, and `--job-pay-from mint`), with `--seed 1` to `5`.
