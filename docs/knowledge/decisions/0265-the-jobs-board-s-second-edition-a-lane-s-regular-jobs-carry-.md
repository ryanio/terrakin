---
title: "The jobs board's second edition: a lane's regular jobs carry on from the last one it gave"
date: 2026-10-11
status: accepted
tags: [sim, server, jobs]
---

# The jobs board's second edition: a lane's regular jobs carry on from the last one it gave

## Context

The board ([RFC 0030](../../rfcs/0030-jobs.md), section 2) gives each slot's two lanes alternate days, and a lane gives its regular jobs in table order, one a turn. In the first edition the job is `regular[turn % n]`, where `regular` is the lane's jobs up that day. Two things move that index under the lane:

- While a holiday runs, its jobs take the even turns and the regular jobs the odd ones, read as `regular[floor(turn / 2) % n]`. The index halves when the holiday starts and doubles when it ends, so the lane goes back to jobs it just gave and skips ahead past ones it hadn't.
- At a season's edge a season's job joins or leaves, `n` changes, and `turn % n` lands somewhere unrelated.

Making shares the home slot with Growing, so it has a turn every other day and a round of its nine jobs takes 18 days. Beside Halloween and Midwinter every one of Clem's, Bram's and Ansel's regular jobs waited up to 35 days, two rounds less a day: on the 2026 calendar Ansel's bouquet and flower box came up October 7 and 9 and then not until November 12 and 14. Sable's fish lost turns another way: on a day the turns leave with nothing that needs nothing bought, the walk becomes a find in place of the fish, and the fish that turn would have given waited a second round, 11 days where a round is 6.

The economy run's check 7 looked at one 30-day month from one start date, so it missed both. Jobs are live, so the fix can't change a board a logged `take_job` was checked against: it has to be a new edition behind a logged `set_job_edition`.

## Decision

Edition 2 has edition 1's jobs, unchanged, and reads them by a new rule (`carriesOn` in `packages/sim/src/jobs.ts`):

- A lane's regular job is the first one up that day after the last regular job the lane gave, in table order, going round. A holiday's jobs still take the even turns while it runs, and the regular ones carry on through the odd turns. A season's job joins the round where it sits in the table and leaves without moving the rest.
- On a day the turns leave with nothing that needs nothing bought, the walk is the finds lane's next find, when it has two or more up, and the finds lane carries on from it. The fish it stood in for comes on the lane's next turn.
- The board stays a pure function of the state. "The last job the lane gave" is counted from `state.jobs.opened`, a stretch at a time between the days the jobs up can change (each season's first day, each holiday's first day, and the day after one ends). A stretch where every day has a job that needs nothing bought is counted in closed form; elsewhere it goes day by day. A board takes about 0.2 ms after four years.

The economy run's check 7 now slides over every start day of a year and reports each regular job's longest wait for the board (`jobWaits`). The bound is two rounds of the job's lane less a day (`laneRound`: its regular jobs up times the days between its turns), the wait of a job its lane skipped once. The run fails, with exit code 1, when a regular job waits that long. A holiday's turns can make a wait longer than a round, but never by a whole round.

The server logs the switch with `WorldService`'s `jobEdition` option, right after a `new_day` and never mid-day, since the board changes from then on and people may be looking at today's. It only moves forward. The Worker passes `jobEdition: 2`, so terrakin.org switches once at the first midnight after the deploy. The Node server passes nothing, so self-hosted, dev, and e2e worlds stay on the edition `open_jobs` starts on (1) unless they set it.

## Consequences

Longest waits, in days, from every start day of a year, edition 1 and then 2. Starting 2026-10-12 with jobs opened 2026-10-11, as terrakin.org's were:

| Giver | Round | Edition 1 | Edition 2 |
|---|---|---|---|
| Juniper | 8 | 9 | 7 |
| Clem | 18 | 35 | 23 |
| Bram | 18 | 35 | 23 |
| Ansel | 18 | 33 | 21 |
| Marlo | 8 | 9 | 6 |
| Sable | 6 | 11 | 7 |
| Otis | 4 | 3 | 3 |
| Pip | 6 | 5 | 5 |

Making's 23 is a round plus the turns Midwinter's candy canes take. On the four years `jobs.test.ts` checks from 2024-10-07, edition 1 has every regular Making job at 35 and every fish at 11, and edition 2 has none over the bound: Making 23, Growing and fish 9, finds 6, Hosting 3, Playing 5. Ansel's next jobs after the switch come October 25 and 29 in place of November 12 and 14.

The economy run, 300 residents, seeds 1 to 3, an autumn month (2024-10-04) and a winter one (2024-12-04), with edition 2 and with `--job-edition 1`. With edition 1 its output is the run before this change line for line, plus the new check, which fails there (in the default month, Bram's chair, table and stone wall at 35 days and Sable's three fish at 11) and holds in edition 2. Per active resident at month end against `--no-jobs`, and what the town bought a day in the last 7 days against `--no-jobs`:

| Month | Seed | Edition 1 | Edition 2 |
|---|---|---|---|
| autumn | 1 | -1.8%, 752 against 753 | -0.4%, 756 against 753 |
| autumn | 2 | 1.1%, 675 against 674 | 1.1%, 669 against 674 |
| autumn | 3 | -1.1%, 623 against 637 | -2.2%, 632 against 637 |
| winter | 1 | 0.7%, 670 against 660 | 2.4%, 687 against 660 |
| winter | 2 | -2.4%, 584 against 609 | 0.3%, 598 against 609 |
| winter | 3 | -0.3%, 580 against 591 | -1.0%, 590 against 591 |

Supply per active resident moves -0.6% on average in edition 1 and 0.0% in edition 2, both inside the RFC's 2% on average, and each edition has two runs of six where the town bought a little more with jobs than without. Regulars who take jobs in their skills finished 1.6 to 2.6 a week in edition 2 against 1.7 to 2.6 in edition 1. Every other check comes out the same in both editions, except two that edition 2 holds and edition 1 misses: at most one level above `--no-jobs` in autumn with seed 2, and every skill at level 5 inside 10 to 20 days in winter with seed 1.

Other things that follow:

- The board on the day of the switch is edition 2's from midnight. A job held from before stays held and still finishes, since `jobById` reads every edition. A board can't repeat a job across the switch: the lanes alternate days, and the day before belonged to the other lanes.
- Edition 1 is untouched: its boards for twenty years and every state of the parts of the game hash as before, every fixture keeps its hash, and `REPLAY_VERSION` doesn't move. `jobs.test.ts` pins a hash of each edition's boards for four years, and `src/fixtures/job-edition-log.ts` replays the switch and three jobs taken from edition 2's boards.
- The board reads `state.jobs.opened` from edition 2 on, so two worlds that opened jobs on different days can have different boards on the same day. Each world's board is still the same for everyone in it.
- A test that needs an edition of its own now puts it after the newest (`MADE_UP` in `jobs.test.ts`).
- Spring's and summer's jobs and the other items the RFC left for later are still later. A new edition with them would read by edition 2's rule.
- Code: `packages/sim/src/jobs.ts` (`carriesOn`, `carriedBoard`, `lastGiven`, `laneRound`, `jobWaits`), `packages/server/src/world-service.ts` (`moveJobEdition`), `packages/server/cloudflare/worker.ts` (`jobEdition: 2`), `scripts/economy-sim.ts` (check 7 and `--job-edition`).
