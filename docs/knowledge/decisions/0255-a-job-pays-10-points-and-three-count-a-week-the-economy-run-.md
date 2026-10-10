---
title: A job pays 10 points and three count a week, the economy run with jobs says
date: 2026-10-10
status: accepted
tags: [sim, jobs, numbers, scripts]
---

# A job pays 10 points and three count a week, the economy run with jobs says

## Context

[RFC 0030](../../rfcs/0030-jobs.md) calls its numbers starting points and leaves them to an economy run (its PR 3), with eight checks:

1. Nobody finishes more than one job a day or three a week, and an account that plays every day earns the same job points in a month as one that plays three days a week.
2. A regular who takes jobs in the skills they play finishes two or three a week, and ends the month at most one level above the same regular without jobs.
3. A resident at every cap every day, with every job, is no further above the median regular in levels than without jobs.
4. Each skill played in earnest with its jobs reaches level 5 in 10 to 20 days, and no skill is twice as slow as another.
5. A household finishes no job among themselves, a jar one of them made finishes only its maker's job, and a ring of ten fresh accounts earns at most 30 job points an account a week.
6. Supply per active resident moves less than 2%, on average over the 18 months, and what the town paid for goods in the last 7 days is lower with jobs, never higher.
7. Every day has a job that needs nothing bought (no seed from the shop, no learned recipe, no rod), every job in season comes up, and each skill is on the board at least three days in every seven.
8. How often each job is finished.

`scripts/economy-sim.ts` now plays jobs. The world logs `open_jobs` after `open_levels`. From a PRNG stream of their own, about half the regulars (fewer of those who come by less) take a job when the board has one in a skill they already play, about one regular in ten (and fewer visitors) takes any job they could do, and every regular who plays one skill in earnest takes that skill's jobs. The shares are guesses, as the foragers' and hosts' were. The sim's bounds cap them whatever they are.

A resident takes a job only when they could do it from where they live. A harvest job takes a garden, and a named crop takes enough of it in their planters already. Something to make takes its recipe and its makings in hand, or the wood and stone it lacks lying within reach. A find job takes a find that fits lying within reach that day, a fish job a rod, a lesson a neighbor who lacks something they know, a host's job the habit of hosting and three neighbors, and a game job the habit of playing. Whoever takes any job also buys the seed a crop job asks for, and sits down to a game they wouldn't have. They make a job's thing first thing at home, before the garden's crops and jars go into what the town buys. A job held two days without being finished is let go when the board has another for them, unless it's a harvest, which waits for what's growing.

A small world of its own, played beside the month, holds what a month of ordinary residents doesn't show (`jobsLab`). Two accounts with a kitchen, a workbench, a rod, and a pond are handed whatever a job's thing is made of: one plays every day and takes a job whenever the sim lets it, the other plays three days of each UTC week, the last three that have a job the two can do in a day (a fish, or something to make). A household of a person and two AIs hold the day's job with neighbors and teach, pay, host, and play each other, and pass a jar one of them made around for Clem's job. A ring of ten fresh accounts hold the same jobs and do all of that among themselves, with real choices at the game table.

`--no-jobs` draws none of it. Its output matches the run before jobs byte for byte, in the default month and in a winter month with 150 residents and seed 2. Each run plays its month a second time with `--no-jobs` for the comparisons.

## Decision

The RFC's numbers stand, all of them.

| Number | Value |
|--------|-------|
| `points` | 10 to the job's skill, outside the daily cap |
| `perWeek` | 3 jobs finished in a UTC week |
| `perDay` | 1 a UTC day |
| `held` | 1 at a time |
| `board` | 3 jobs a day |
| `keepDays` | 7 days before a held job lapses |
| `titleAt`, `wearAt`, `masterAt` | Helping hand at 10 jobs, the town satchel at 25, Pillar of the town at 75 |

`jobs.test.ts` pins every one.

Two things about the table changed after the first run of these months, and every number below is from the run after them.

- The first edition has no job for being a counted guest or for being paid for a bounty. With both on the board they were finished 29% and 17% of the times they were taken (97 of 330 and 48 of 271 over the 18 months), against 68% or more for every giver but Otis. Both wait on a neighbor's calendar: an event held that week, a bounty posted. Otis keeps the lesson and the event with three counted guests.
- Every day's board has one job that needs nothing bought. The first run's check for a job a resident can do alone passed any harvest, and on 91 of the 1,461 days in four years the only such job was pumpkins or cranberries, whose seed only the shop sells. The season's crop jobs stay. On a day when one is the job for home, beside a fish and a job for a host, the walk is a find in place of the fish.

The garment's name is for a decision of its own, below.

### What the run says

The default run (seed 1, 30 days, 300 residents, an autumn month):

```
Jobs (RFC 0030): board=3 held=1 perDay=1 perWeek=3 keepDays=7 points=10 titleAt=10 wearAt=25 masterAt=75. Of 265 settled residents, 86 take jobs in the skills they play (22 of them play one skill in earnest) and 14 take any job they could do. In the month: 407 taken, 330 finished, 53 let go, 8 lapsed.
  1. The bounds. In the month nobody finished more than 1 in a day (holds: at most 1) or 3 in a UTC week (holds: at most 3). On their own, an account that played all 30 days finished 15 jobs for 150 points, turned away on 15 days, and one that played three days of each week finished 15 for 150 (holds: the same). Their tenth job, and the title Helping hand, came on day 17 and day 20.
  2. Regulars who take jobs in the skills they play and arrived with 2 weeks or more left (n=17), over the whole weeks after they came (34 in all): 1.7 jobs a week on average, median 2, two or three in 19 of 34 (56%) of their weeks (holds: two or three a week). Levels above the same resident with --no-jobs at month end: median 1, p90 1, most 2 (level 9 against 7); more than one level above: 1 of 17 (6%) (misses: at most one).
  3. Month end. Every cap every day with every first is 3660 points, level 19; with every job (15) it's 3810, level 20. The median regular who arrived in the first 3 days (n=15) is at level 8 with jobs and 8 without. So the top is 2.50 times the median regular in levels with jobs and 2.38 without (misses: no further above). In points: 3810 against a median of 610 with jobs, 6.25 times, and 3660 against 598 without, 6.12 times.
  4. Days to level 5 in a skill (200 points) at the median pace of the regulars who play it in earnest and arrived with 2 weeks or more left, with its jobs and without: growing 18 (19 without; 9 jobs finished by 2 residents), making 22 (25 without; 20 jobs finished by 5 residents), foraging 12 (14 without; 14 jobs finished by 4 residents), hosting 13 (25 without; 39 jobs finished by 4 residents), playing 14 (17 without; 18 jobs finished by 3 residents). Inside 10 to 20 days: 4 of 5 (misses). The slowest is 1.83 times the fastest (holds: under twice), against 1.79 without.
  5. A person and two AIs holding the day's job with neighbors, and teaching, paying, hosting, and playing each other for 30 days, finished 0 jobs that way (holds: none). A jar the person made and gave to her AI, both holding Clem's job: the AI's hand-in was refused and the maker's, with the jar back, taken (holds: only its maker's). A ring of ten fresh accounts doing all of it among themselves finished 12 to 13 jobs each in the month, at most 3 in a UTC week, which is 30 job points (holds: at most 30).
  6. Per active resident at month end: 275 with jobs, 280 without (-1.8%; holds: under 2%). Supply 38241 against 38751 (-1.3%). Sold to the town in the last 7 days: 752 a day against 753 (holds: no higher). Over the month the town paid 14305 for goods against 14480, and residents spent 23878 at the shop against 23927.
  7. The board. Days with no job that needs nothing bought (no seed from the shop, no recipe to learn, no rod): 0 of 30 (holds: none). Of the 27 jobs in season this month, 27 came up (holds: all). Seven-day stretches where a skill was on the board fewer than three days: 0 (holds: none).
  8. Each job: days on the board, times taken, finished, let go, and lapsed, then each giver's share of takes that were finished.
     juniper_crops         4 days  taken   46  finished   46  let go    0  lapsed   0
     juniper_herbs         4 days  taken   25  finished   24  let go    0  lapsed   0
     juniper_flowers       4 days  taken   24  finished   15  let go    0  lapsed   3
     juniper_pumpkins      3 days  taken    9  finished    6  let go    0  lapsed   3
     clem_herb_tea         1 days  taken   18  finished   18  let go    0  lapsed   0
     clem_jam              3 days  taken   25  finished   25  let go    0  lapsed   0
     clem_pumpkin_pie      2 days  taken    1  finished    1  let go    0  lapsed   0
     clem_candy            1 days  taken    0  finished    0  let go    0  lapsed   0
     bram_chair            1 days  taken    3  finished    3  let go    0  lapsed   0
     bram_table            1 days  taken    2  finished    2  let go    0  lapsed   0
     bram_stone_wall       1 days  taken    4  finished    4  let go    0  lapsed   0
     bram_barrel           2 days  taken    0  finished    0  let go    0  lapsed   0
     bram_jack_o_lantern   1 days  taken    0  finished    0  let go    0  lapsed   0
     ansel_bouquet         1 days  taken   10  finished   10  let go    0  lapsed   0
     ansel_flower_box      1 days  taken    0  finished    0  let go    0  lapsed   0
     marlo_find            7 days  taken   17  finished   14  let go    3  lapsed   0
     marlo_sand_find       4 days  taken    2  finished    2  let go    0  lapsed   0
     marlo_forest_find     4 days  taken    5  finished    5  let go    0  lapsed   0
     marlo_autumn_find     3 days  taken    3  finished    2  let go    1  lapsed   0
     sable_dusk_fish       4 days  taken   14  finished   12  let go    0  lapsed   0
     sable_night_fish      4 days  taken   17  finished   13  let go    4  lapsed   0
     sable_three_fish      4 days  taken   20  finished   16  let go    2  lapsed   0
     otis_teach            8 days  taken   24  finished   24  let go    0  lapsed   0
     otis_host             7 days  taken   31  finished   21  let go   10  lapsed   0
     pip_game              5 days  taken   37  finished   27  let go    7  lapsed   0
     pip_two_games         5 days  taken   30  finished   21  let go    9  lapsed   0
     pip_win               5 days  taken   40  finished   19  let go   17  lapsed   2
     Finished of taken, by giver: juniper 91 of 104 (88%), clem 44 of 44 (100%), bram 9 of 9 (100%), ansel 10 of 10 (100%), marlo 23 of 27 (85%), sable 41 of 51 (80%), otis 45 of 55 (82%), pip 67 of 107 (63%).
```

The run the RFC asks for: 150, 300, and 600 residents, seeds 1 to 3, an autumn month (`--start 2024-10-04`) and a winter month (`--start 2024-12-04`). "With and without" is the month with jobs and the same month with `--no-jobs`.

| Month | Residents | Seed | Take jobs | Taken, finished | 2. Jobs a week | More than one level above | 3. Median regular's level, with and without | Top against it in levels, with and without | In points, with and without | 6. Per active, with and without | Sold a day, last 7 days, with and without |
|---|---|---|---|---|---|---|---|---|---|---|---|
| autumn | 150 | 1 | 47 of 130 | 184, 148 | 2.2 (n=6) | 0 of 6 | 10 and 9 | 2.00 and 2.11 | 4.22 and 4.58 | 338 and 351 (-3.7%) | 356 and 348 |
| autumn | 150 | 2 | 54 of 131 | 262, 218 | 2.7 (n=8) | 0 of 8 | 10 and 10 | 2.00 and 1.90 | 4.02 and 3.94 | 336 and 337 (-0.3%) | 384 and 384 |
| autumn | 150 | 3 | 49 of 128 | 186, 158 | 2.4 (n=10) | 0 of 10 | 8 and 8 | 2.50 and 2.38 | 5.72 and 6.49 | 357 and 359 (-0.6%) | 303 and 308 |
| autumn | 300 | 1 | 100 of 265 | 407, 330 | 1.7 (n=17) | 1 of 17 | 8 and 8 | 2.50 and 2.38 | 6.25 and 6.12 | 275 and 280 (-1.8%) | 752 and 753 |
| autumn | 300 | 2 | 88 of 258 | 436, 343 | 2.3 (n=15) | 1 of 15 | 9 and 9 | 2.22 and 2.11 | 4.80 and 4.88 | 266 and 263 (1.1%) | 675 and 674 |
| autumn | 300 | 3 | 94 of 266 | 443, 359 | 2.6 (n=15) | 0 of 15 | 9 and 8 | 2.22 and 2.38 | 5.23 and 5.85 | 271 and 274 (-1.1%) | 623 and 637 |
| autumn | 600 | 1 | 192 of 521 | 836, 703 | 2.1 (n=33) | 2 of 33 | 8 and 8 | 2.50 and 2.38 | 5.95 and 6.40 | 220 and 221 (-0.5%) | 1431 and 1440 |
| autumn | 600 | 2 | 177 of 512 | 809, 674 | 2.4 (n=32) | 0 of 32 | 8 and 8 | 2.50 and 2.38 | 5.38 and 5.43 | 214 and 218 (-1.8%) | 1366 and 1353 |
| autumn | 600 | 3 | 172 of 519 | 832, 673 | 2.5 (n=32) | 0 of 32 | 8 and 8 | 2.50 and 2.38 | 5.52 and 5.34 | 235 and 239 (-1.7%) | 1184 and 1208 |
| winter | 150 | 1 | 47 of 130 | 198, 161 | 2.1 (n=6) | 0 of 6 | 9 and 8 | 2.22 and 2.38 | 4.65 and 5.10 | 373 and 374 (-0.3%) | 316 and 320 |
| winter | 150 | 2 | 54 of 131 | 281, 232 | 2.7 (n=8) | 0 of 8 | 10 and 9 | 2.00 and 2.11 | 4.00 and 4.34 | 360 and 369 (-2.4%) | 337 and 340 |
| winter | 150 | 3 | 49 of 128 | 207, 174 | 2.5 (n=10) | 0 of 10 | 8 and 7 | 2.50 and 2.71 | 6.29 and 7.15 | 374 and 380 (-1.6%) | 274 and 283 |
| winter | 300 | 1 | 100 of 265 | 430, 360 | 1.9 (n=17) | 0 of 17 | 8 and 8 | 2.50 and 2.38 | 6.35 and 6.04 | 297 and 295 (0.7%) | 670 and 660 |
| winter | 300 | 2 | 88 of 258 | 466, 370 | 2.6 (n=15) | 0 of 15 | 9 and 9 | 2.22 and 2.11 | 4.90 and 5.03 | 279 and 286 (-2.4%) | 584 and 609 |
| winter | 300 | 3 | 94 of 266 | 432, 347 | 2.2 (n=15) | 0 of 15 | 8 and 8 | 2.50 and 2.38 | 5.40 and 5.83 | 289 and 290 (-0.3%) | 580 and 591 |
| winter | 600 | 1 | 192 of 521 | 885, 738 | 2.3 (n=33) | 0 of 33 | 8 and 7 | 2.50 and 2.71 | 6.03 and 6.96 | 238 and 239 (-0.4%) | 1292 and 1319 |
| winter | 600 | 2 | 177 of 512 | 875, 722 | 2.6 (n=32) | 0 of 32 | 8 and 8 | 2.50 and 2.38 | 5.52 and 5.90 | 231 and 239 (-3.3%) | 1188 and 1199 |
| winter | 600 | 3 | 172 of 519 | 850, 694 | 2.5 (n=32) | 0 of 32 | 8 and 8 | 2.50 and 2.38 | 5.92 and 6.12 | 256 and 257 (-0.4%) | 1077 and 1096 |

The fourth check: days to level 5 in a skill at the median pace of the regulars who play it in earnest, with its jobs, then without them and how many such regulars the month had.

| Month | Residents | Seed | Growing | Making | Foraging | Hosting | Playing |
|---|---|---|---|---|---|---|---|
| autumn | 150 | 1 | 16 (21, n=2) | 21 (29, n=1) | 12 (14, n=1) | 19 (30, n=1) | 12 (14, n=1) |
| autumn | 150 | 2 | 18 (21, n=1) | 16 (19, n=1) | 10 (11, n=2) | 17 (24, n=6) | 11 (14, n=3) |
| autumn | 150 | 3 | none | 13 (16, n=2) | 12 (16, n=1) | 15 (22, n=1) | 14 (18, n=1) |
| autumn | 300 | 1 | 18 (19, n=2) | 22 (25, n=5) | 12 (14, n=4) | 13 (25, n=4) | 14 (17, n=3) |
| autumn | 300 | 2 | 19 (22, n=4) | 16 (16, n=1) | 12 (14, n=2) | 17 (25, n=6) | 11 (14, n=4) |
| autumn | 300 | 3 | 18 (21, n=1) | 20 (23, n=3) | 11 (14, n=2) | 13 (19, n=3) | 13 (15, n=1) |
| autumn | 600 | 1 | 17 (22, n=5) | 20 (24, n=9) | 14 (18, n=9) | 13 (20, n=7) | 11 (15, n=5) |
| autumn | 600 | 2 | 20 (24, n=7) | 19 (23, n=6) | 10 (13, n=6) | 16 (24, n=7) | 12 (16, n=4) |
| autumn | 600 | 3 | 16 (17, n=4) | 17 (18, n=6) | 13 (15, n=3) | 14 (21, n=7) | 11 (14, n=4) |
| winter | 150 | 1 | 17 (20, n=2) | 23 (30, n=1) | 16 (14, n=1) | 18 (29, n=1) | 12 (14, n=1) |
| winter | 150 | 2 | 16 (20, n=1) | 13 (17, n=1) | 11 (14, n=2) | 17 (24, n=6) | 11 (13, n=3) |
| winter | 150 | 3 | none | 15 (19, n=2) | 12 (13, n=1) | 14 (21, n=1) | 15 (18, n=1) |
| winter | 300 | 1 | 17 (21, n=2) | 22 (30, n=5) | 12 (16, n=4) | 15 (23, n=4) | 13 (18, n=3) |
| winter | 300 | 2 | 18 (21, n=4) | 13 (17, n=1) | 12 (14, n=2) | 18 (24, n=6) | 10 (13, n=4) |
| winter | 300 | 3 | 18 (21, n=1) | 17 (21, n=3) | 13 (15, n=2) | 15 (19, n=3) | 13 (16, n=1) |
| winter | 600 | 1 | 18 (21, n=5) | 18 (25, n=9) | 18 (20, n=9) | 14 (21, n=7) | 12 (15, n=5) |
| winter | 600 | 2 | 20 (24, n=7) | 20 (27, n=6) | 13 (15, n=6) | 15 (23, n=7) | 12 (15, n=4) |
| winter | 600 | 3 | 19 (22, n=4) | 16 (21, n=6) | 12 (15, n=3) | 14 (20, n=7) | 11 (15, n=4) |

In every one of the 18 months: nobody finished more than one job in a day or three in a UTC week; the account that played every day and the one that played three days a week both finished 15 jobs, with the tenth, and its title, on day 17 or 19 for the first and day 20 or 22 for the second; the household finished no job among themselves; the AI's hand-in of the person's jar was refused and the person's was taken; no account in the ring finished more than three in a week; and the board had a job that needs nothing bought every day, every job in season, and every skill at least three days in every seven.

Over all 18 months, by giver, of the jobs taken: Juniper's were finished 90% of the time (1,926 of 2,136), Clem's, Bram's, and Ansel's every time (1,614), Marlo's 95% (434 of 453), Sable's 75% (1,152 of 1,524), Otis's 70% (891 of 1,264), and Pip's 68% (1,387 of 2,028). Inside Otis's: the lesson 94% (575 of 609) and hosting an event three guests are counted at 48% (316 of 655).

### The eight checks

Three hold in every month as written (the first, the fifth, and the seventh). The second holds but for four residents. The sixth holds on average, which is how the RFC words it, and misses its "never higher" in 4 months. The third and the fourth miss as written. The eighth is a count, and with his guest and bounty jobs out it says Otis's jobs are finished about as often as Sable's and Pip's.

1. The bounds hold. Nobody in any month finished two in a day or four in a week. Fifteen jobs is all a 30-day month has, for the account that played 30 days and the one that played 15, so 15 of the daily account's days ended with a refusal and nothing more.
2. Two or three a week holds: 2.4 a week on average over 763 resident-weeks, with a median of 2 or 3 in every month. At most one level above misses for 4 residents of 336, in three autumn months, who ended two levels above themselves without jobs (the furthest in each of those months at level 9 against 7, 10 against 8, and 9 against 7). The median regular is one level up, or none. The four gained more than their jobs' 150 points: a job sends a resident to deeds they'd have skipped, and those earn their own points and firsts.
3. Every cap and every job against the median regular misses in levels in 12 of 18 months, by one level's worth: 2.50 times against 2.38 in most of them. A 30-day month spans five UTC weeks, so it has 15 jobs, not the 12 the RFC counted, and 150 points puts the ceiling at 3,810, ten past level 20's 3,800, while the median regular stays at level 8. At 12 jobs it would hold everywhere. In points the gap narrows, as the RFC said it would: the ceiling is 5.3 times the median regular with jobs and 5.6 without, and narrower with jobs in 14 of the 18 months. Nobody in any month was near either ceiling.
4. Ten to twenty days misses in 4 of 18 months, and is much nearer than it was. With its jobs, Growing takes 18 days on average (16 to 20, inside the range in all 16 months that had someone growing in earnest), Making 18 (13 to 23, over 20 in 4 months, which are the four misses), Hosting 15 (13 to 19), Foraging 13 (10 to 18), and Playing 12 (10 to 15). Without jobs the same residents take 21, 22, 23, 15, and 15, and Growing, Making, and Hosting were inside the range in 4, 7, and 4 months. No skill is more than twice as slow as another in any month (twice in one autumn month, Growing's 20 days against Foraging's 10).
5. The household and the ring hold. Every rule that keeps a household's lesson, bounty, game, and guests from earning points keeps them from moving a job, because a job reads the same rule. The ring gets its three a week each and no more: 11 to 14 jobs an account in the month.
6. Supply holds on average: per active resident at month end moved by 1.2% down, by under 2% in 14 of the 18 months, and by 3.7% at most. Jobs mint nothing. Over the month the town paid 1.3% less for goods on average (less in 17 of 18 months), since a jar handed in is a jar not sold and its makings went into it, and residents spent 0.8% more at the shop. The last 7 days' sales were lower on average too, 744 a day against 751, but higher with jobs in 4 of the 18 months, by up to 2.3%, so "never higher" misses in those. A single month moves a couple of percent either way for a reason that isn't jobs: once anyone's purse differs, the script's later draws for shopping fall differently (decision 0246 saw the same).
7. The board holds in every month, with two things to know about what it says. "Needs nothing bought" is `soloJob` in the sim: a find, a harvest of any crop or of one a starter seed grows, or a craft or a made thing everyone knows that takes only starter crops, the pantry's sugar and jars, wood, and stone. And it holds because the world has finds out: on the days the walk is a find in place of the fish (3 of the autumn month's 30 days, 4 of the winter month's), a world with no finds has no find to give.
8. Otis's jobs are finished 70% of the time they're taken, between Pip's 68% and Sable's 75%. His lesson is finished 94% of the time. His event is the job finished least often of all, 48%: it waits on three counted guests turning up. Marlo's finds are taken more than in the first run (453 times against 330) and Sable's fish less (1,524 against 1,915), since the find takes the fish's place on some days.

### What else was tried

The RFC says a retune changes the points or the week's bound, never both. Both were run over the same 18 months, and neither is better.

- 15 points a job (`--set jobs.points=15`). The fourth check barely improves: every skill is inside 10 to 20 days in 15 of 18 months, against 14. The second gets worse: 19 regulars of 336 end more than one level above themselves without jobs, in 10 of the 18 months, against 4 in 3. And the fast skills leave the range at the other end: Playing and Foraging each take 9 days in one month.
- Five a week (`--set jobs.perWeek=5`). The account that played every day finished 23 jobs and the one that played three days a week 15, which is the first check's second half gone, and the reason the week's bound is three. The regulars who take jobs finished 2.8 a week, up from 2.4, and 8 of 336 ended more than one level up. The fourth check barely moved.

### Choices made in the sim along the way

These are in PRs 1 and 2, where the RFC left something open or the code said otherwise.

- The garment is `town_satchel`, "Town satchel". The RFC says a satchel, and `satchel` is already a free accessory in `WEAR_ITEMS` that residents wear in the live log. It can't become earned without breaking replay and taking something away, so the earned one has its own id. The name is the simplest that came to hand, and it's cheap to change before the API opens jobs.
- The two job titles and the garment are lists of their own (`JOB_TITLES`, `JOB_WEAR`) beside `TITLES` and `WEAR_ITEMS`, as earned wear was before the web drew it. The protocol's enums hold neither, and the garment takes no style yet. They join the main lists when the API opens jobs.
- The board's turns. Each slot has two lanes that swap by the day: Growing with a fish and Hosting on even days, Making with a find and Playing on odd ones. That pairing gives every day a harvest or a find. A harvest of pumpkins or cranberries takes the shop's seed, so on the even days when Growing's turn falls on one of those the walk is the first find up that day that the turns give neither the day before nor the day after. `soloJob` says which jobs need nothing bought, and a test checks every day of four years. While a holiday runs, a lane with jobs for it gives one every other turn, since a nine-day holiday would otherwise pass with its jobs never up. A job whose part of the game isn't open is left out, and its lane's slot goes to the other lane.
- A find job counts a recipe page too, since Foraging's find points do.
- Points for one event a day as a host, and one as a guest, are a cap like the daily one, not part of whether the deed counts. So a second event in a day still moves a job, as a harvest past the cap does. Nothing about levels changed.
- An event's credit comes in a later input than the event. A held job keeps the `seq` of the input that took it and an event the `seq` of the input that ended it (written only once jobs are open, so older events hash as they did), and a job taken after an event ended isn't moved by its credit. Every other deed is reported in its own input. Two of them finish a job taken after most of the work was done, and both are meant: a game counts for a job held when the game ends, so one taken mid-game counts, and a bounty counts for a job held when it's paid, so one taken after `complete_bounty` and before the poster's or the maintainer's confirm counts. A guest's job taken after an event's samples and before it ends would be a third, and no edition has a guest's job.
- `hand_in` is refused for someone made townsfolk after they took the job, so a job is never finished with no points behind it.
- `board`, `held`, and `perDay` are in `JOBS` because the RFC lists them, and no rule reads them: the board has three slots, the state holds one job a resident, and the day's list names a resident once.
- Before `open_jobs` the refusals are the ones the RFC already has: `unknown_job` for a take and `no_job` for the rest. There's no sixth code.
- A harvest job counts harvests, not crops: three planters, whatever each yields.
- `hand_in` takes the oldest by the made thing's id, which comes from one counter.
- The giver is in the sim's table as a fixed word (`JOB_GIVERS`) that no rule reads, so a job's id can be checked against it and the run can count by giver. The protocol still owns the giver's name and face.
- `set_job_edition` takes any edition that exists but the one in use, back as well as forward. No second edition exists, so the tests put one in the table for themselves, and the fixture has no switch in it. The first real second edition adds one.
- A merge says the kept record's new count with a `job_total` event.
- The table is written out as plain data, a row a job with every field named.
- The sim still counts a counted guest and a paid bounty for a job (`JobDeed`, `creditJob`, `bountyJob`, `townBountyJob`), though the first edition asks for neither. `jobs.test.ts` proves both with the two jobs added in an edition of its own, and the run's residents still know how to do both, so a later edition can bring them back.
- The jobs with a second resident landed in PR 2 with their tests, not in PR 1 as the RFC's build plan has it.

## Consequences

- The numbers can still change before the server logs `open_jobs`, since no live log holds a job. After that any of them changes only behind a logged switch. Rerun `node scripts/economy-sim.ts` first: `--set jobs.points=15` tries one without editing it, and each run compares itself with `--no-jobs`.
- Otis's event job is finished about half the times it's taken. The RFC's first thing to try, 20 points for a job that needs other people, would pay more for a job that still waits on three neighbors turning up, so it wouldn't change how often it's finished. Giving a held one longer than the rest would. The edition isn't frozen until a live world reads it.
- Juniper's pumpkin and cranberry jobs take a seed only the shop sells, in its season, so the RFC's "a job never asks anyone to buy anything" doesn't hold for them. They stay, and the rule in its place is that one of each day's three jobs needs nothing bought. In the run they're taken by residents who already have enough of the crop planted and by the few who take any job, who buy the seed for it: 98 takes over the 18 months, 87 of them finished. SKILL.md's words in PR 4 should say that a job may take a seed from the shop and that one job a day never does.
- The third and fourth checks miss as written. Neither is a reason to move a number: the third is ten points over a level's edge in a five-week month, and the fourth's misses are Making a day or three over the range in four months.
- For PR 4: `packages/server/src/checkin-suggest.ts` reads `WEAR_INFO` for everything a resident wears and has no entry for the town satchel; `toWire` drops a `title_changed` that carries a job's title, so a client showing a skill's title would keep showing it; `levelView` reads a job's title as none; and after a merge the kept record can't hand in what the duplicate made, since a made thing keeps its maker's id.
- The takers' shares are guesses. Once jobs are live, the real ones can replace them.
