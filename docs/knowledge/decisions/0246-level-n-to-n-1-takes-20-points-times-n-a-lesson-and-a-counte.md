---
title: Level n to n + 1 takes 20 points times n, a lesson and a counted guest earn 8, and a rated game 6, the economy run with levels says
date: 2026-10-10
status: accepted
tags: [sim, levels, numbers, scripts]
---

# Level n to n + 1 takes 20 points times n, a lesson and a counted guest earn 8, and a rated game 6, the economy run with levels says

## Context

[RFC 0029](../../rfcs/0029-levels-and-skills.md) calls its numbers starting points and leaves them to an economy run (its PR 3), with six checks: a newcomer reaches level 2 on their first day; a regular reaches level 5 in their first week and a skill at level 3 within two; at month end a resident at every cap every day is at most twice a regular's level; each skill played alone reaches level 5 in 10 to 20 days; a household and a ring of fresh accounts earn nothing from each other past the cap; and supply per active resident moves less than 2%.

`scripts/economy-sim.ts` now plays levels. The world logs `open_levels`, `own_plot_pickups`, and `open_bounties`, as terrakin.org would. From a PRNG stream of their own, some residents pick up the finds within reach of their hearth, make furniture from the wood and stone that lie there, keep casting until Foraging's cap, hold an event on their plot once a week and post a small bounty once a week, and sit down to one to four rated games a day. A quarter of the regulars play one skill in earnest and leave the rest alone: a full garden; a garden cooked into goods, with furniture from what lies near; ten casts a day and every find near home; an event a week, every neighbor's event, a lesson a day, and any bounty going; or three slow tables a day, as many seats as one resident holds. The shares are guesses, as the builders' and anglers' were. The sim's caps bound them whatever they are.

A small world of its own, played beside the month, holds what a month of ordinary residents doesn't show: a newcomer's first day, a household of a person and two AIs who teach, pay, host, and play each other every day, and a ring of ten fresh accounts who teach each other, pay each other two bounties a day, go to two of their own events a day, and sit down to two rated tables a day each where nobody ever chooses. The script applies the server's guest rule (`countGuests`: three days old with a hearth, outside the host's household, counted for at most two other hosts a day) before it sends `credit_event`, and for the household it sends the uncounted guests anyway, to see the sim refuse them.

`--no-levels` draws none of it. Its output matches the run before levels byte for byte, in the default month and in a winter month with 150 residents and seed 2.

## Decision

| Number | Value | RFC start |
|--------|-------|-----------|
| `dailyCap` | 20 points a skill a UTC day | 20 |
| `first` | 10 | 10 |
| `step` | 20: level n to n + 1 takes 20 times n | 25 |
| `harvest`, `craft`, `fish` | 2 | 2 |
| `find` | 4 | 4 |
| `lesson` | 8 | 4 |
| `bounty`, `bountyMinReward` | 6, and 5 coins | 6, and 5 coins |
| `guest` | 2 a counted guest for the host | 2, up to 10 guests |
| `attend` | 8 for a counted guest, once a day | 4 |
| `game`, `win` | 6, and 2 more | 2, and 2 more |
| `UNLOCKS` | a title at skill level 3 and 10, a garment at 5 | the same |

Level 2 is 20 points, level 3 is 60, level 5 is 200, level 10 is 900, level 20 is 3,800, and level 50 is 24,500. `levels.test.ts` pins every number and the table.

The RFC says a retune changes the step or the cap, never both. This keeps to that for the curve: the step moved and the cap didn't. The three deed values are a different question, which the RFC's fourth check asks and its rule doesn't cover: whether one skill is far slower than another.

### What the run says

The default run (seed 1, 30 days, 300 residents, an autumn month), with the RFC's numbers (`--set progress.step=25 --set progress.lesson=4 --set progress.attend=4 --set progress.game=2`):

```
Levels (RFC 0029): dailyCap=20 first=10 step=25 harvest=2 craft=2 find=4 fish=2 lesson=4 bounty=6 bountyMinReward=5 guest=2 attend=4 game=2 win=2. Level 2 at 25 points, 3 at 75, 5 at 250, 10 at 1125.
  1. First day. Settled newcomers in the month ended their first day with a median of 0 points (p90 4); level 2 that day: 5 of 265 (2%).
     On their own: the first visit's steps earned 0 points. Then 31 steps for the wood and stone, a chair, a rod, a pond, and 10 casts (5 fish): 64 points, level 2. Holds for a newcomer who makes and fishes; the first visit alone has no deed in it.
  2. Regulars with two weeks or more left (n=52): level 5 after a median of 8 days (p25 5, p90 not in the month), within 7 days 21 of 52 (40%), within 14 45 of 52 (87%); a skill at level 3 after a median of 4 days (p90 14 days), within 14 days 47 of 52 (90%).
  3. Month end. Regulars who arrived in the first 3 days (n=15): level median 7 (p25 6, p90 8), points median 594; those with a garden and a rod (n=7): level median 7. Every cap every day with every first (66 kinds) is 3660 points, level 17: 2.43 times (fails: at most 2) the median regular, 2.43 times (fails: at most 2) one with a garden and a rod. The highest level anyone reached: 8.
  4. Days to level 5 in a skill (250 points). Regulars who play that one skill in earnest and arrived with 2 weeks or more left: how many reached it and when, and the days it takes at the points a day they earned over their days here. Then the same pace for every regular who plays the skill at all.
     growing   in earnest n= 2: reached it 0 of 2 (0%), soonest not in the month; 10.3 a day at the median (24 days), 10.3 at best (24 days). The rest who play it, n=25: 10.4 a day (24 days). At the cap on 21% of the 1087 days anyone earned in it.
     making    in earnest n= 5: reached it 0 of 5 (0%), soonest not in the month; 7.9 a day at the median (32 days), 9.1 at best (27 days). The rest who play it, n=30: 7.5 a day (33 days). At the cap on 0% of the 1258 days anyone earned in it.
     foraging  in earnest n= 4: reached it 2 of 4 (50%), soonest 12 days; 14.3 a day at the median (18 days), 14.5 at best (17 days). The rest who play it, n=29: 8.8 a day (28 days). At the cap on 9% of the 541 days anyone earned in it.
     hosting   in earnest n= 4: reached it 0 of 4 (0%), soonest not in the month; 4.6 a day at the median (54 days), 5.8 at best (43 days). The rest who play it, n= 3: 0.9 a day (269 days). At the cap on 0% of the 194 days anyone earned in it.
     playing   in earnest n= 3: reached it 0 of 3 (0%), soonest not in the month; 5.1 a day at the median (49 days), 5.4 at best (46 days). The rest who play it, n= 7: 5.3 a day (47 days). At the cap on 0% of the 302 days anyone earned in it.
     In the month: 28 events with 83 guests (74 counted), 32 bounties paid, 88 lessons from those hosting in earnest, 506 games played.
  5. A person and two AIs teaching, paying, hosting, and playing each other for 30 days earned 0 Hosting and 0 Playing points (holds: nothing), and the sim refused 4 event credits that named them as guests. A ring of ten fresh accounts earned 13.2 Hosting points an account a day, 20 at most (holds: the cap is 20); by month end each had 384 to 410 points, Hosting 6, with the title from day 6 and the garment from day 18. The ring also sat down to 300 games where nobody ever chose (540 seats rated) and earned 0 Playing points (holds: nothing).
  6. Per active resident at month end: 280 with levels, 276 without (1.4%; holds: under 2%). Supply 38751 against 38257 (1.3%). Sold to the town in the last 7 days: 753 a day against 750.
```

The same month with the numbers above:

```
Levels (RFC 0029): dailyCap=20 first=10 step=20 harvest=2 craft=2 find=4 fish=2 lesson=8 bounty=6 bountyMinReward=5 guest=2 attend=8 game=6 win=2. Level 2 at 20 points, 3 at 60, 5 at 200, 10 at 900.
  1. First day. Settled newcomers in the month ended their first day with a median of 0 points (p90 6); level 2 that day: 5 of 265 (2%).
     On their own: the first visit's steps earned 0 points. Then 31 steps for the wood and stone, a chair, a rod, a pond, and 10 casts (5 fish): 64 points, level 3. Holds for a newcomer who makes and fishes; the first visit alone has no deed in it.
  2. Regulars with two weeks or more left (n=52): level 5 after a median of 6 days (p25 4, p90 19 days), within 7 days 36 of 52 (69%), within 14 46 of 52 (88%); a skill at level 3 after a median of 4 days (p90 6 days), within 14 days 47 of 52 (90%).
  3. Month end. Regulars who arrived in the first 3 days (n=15): level median 8 (p25 7, p90 10), points median 598; those with a garden and a rod (n=7): level median 8. Every cap every day with every first (66 kinds) is 3660 points, level 19: 2.38 times (fails: at most 2) the median regular, 2.38 times (fails: at most 2) one with a garden and a rod. The highest level anyone reached: 10.
  4. Days to level 5 in a skill (200 points). Regulars who play that one skill in earnest and arrived with 2 weeks or more left: how many reached it and when, and the days it takes at the points a day they earned over their days here. Then the same pace for every regular who plays the skill at all.
     growing   in earnest n= 2: reached it 2 of 2 (100%), soonest 14 days; 10.3 a day at the median (19 days), 10.3 at best (19 days). The rest who play it, n=25: 10.4 a day (19 days). At the cap on 21% of the 1087 days anyone earned in it.
     making    in earnest n= 5: reached it 4 of 5 (80%), soonest 21 days; 7.9 a day at the median (25 days), 9.1 at best (22 days). The rest who play it, n=30: 7.5 a day (27 days). At the cap on 0% of the 1258 days anyone earned in it.
     foraging  in earnest n= 4: reached it 2 of 4 (50%), soonest 10 days; 14.3 a day at the median (14 days), 14.5 at best (14 days). The rest who play it, n=29: 8.8 a day (23 days). At the cap on 9% of the 541 days anyone earned in it.
     hosting   in earnest n= 4: reached it 3 of 4 (75%), soonest 21 days; 8.1 a day at the median (25 days), 9.6 at best (21 days). The rest who play it, n= 3: 0.9 a day (215 days). At the cap on 4% of the 194 days anyone earned in it.
     playing   in earnest n= 3: reached it 2 of 3 (67%), soonest 17 days; 11.6 a day at the median (17 days), 12.2 at best (16 days). The rest who play it, n= 7: 11.9 a day (17 days). At the cap on 39% of the 302 days anyone earned in it.
     In the month: 28 events with 83 guests (74 counted), 32 bounties paid, 88 lessons from those hosting in earnest, 506 games played.
  5. A person and two AIs teaching, paying, hosting, and playing each other for 30 days earned 0 Hosting and 0 Playing points (holds: nothing), and the sim refused 4 event credits that named them as guests. A ring of ten fresh accounts earned 16.1 Hosting points an account a day, 20 at most (holds: the cap is 20); by month end each had 474 to 500 points, Hosting 7, with the title from day 4 and the garment from day 11. The ring also sat down to 300 games where nobody ever chose (540 seats rated) and earned 0 Playing points (holds: nothing).
  6. Per active resident at month end: 280 with levels, 276 without (1.4%; holds: under 2%). Supply 38751 against 38257 (1.3%). Sold to the town in the last 7 days: 753 a day against 750.
```

The run the RFC asks for, with the numbers above: 150, 300, and 600 residents, seeds 1 to 3, an autumn month (`--start 2024-10-04`) and a winter month (`--start 2024-12-04`).

| Month | Residents | Seed | 1. Level 2 on day one | 2. Level 5, median days | Within 7 days | A skill at 3, median days | 3. Regular's level at month end (with a garden and a rod) | Highest level reached | 6. Per active, with and without levels |
|---|---|---|---|---|---|---|---|---|---|
| autumn | 150 | 1 | 2% | 6 | 85% | 3 | 9 (9) | 10 | 351 and 349 (0.6%) |
| autumn | 150 | 2 | 2% | 6 | 71% | 4 | 10 (9) | 11 | 337 and 344 (-2.0%) |
| autumn | 150 | 3 | 1% | 7 | 67% | 4 | 8 (9) | 10 | 359 and 350 (2.6%) |
| autumn | 300 | 1 | 2% | 6 | 69% | 4 | 8 (8) | 10 | 280 and 276 (1.4%) |
| autumn | 300 | 2 | 2% | 5 | 74% | 4 | 9 (9) | 11 | 263 and 266 (-1.1%) |
| autumn | 300 | 3 | 0% | 6 | 77% | 4 | 8 (8) | 11 | 274 and 265 (3.4%) |
| autumn | 600 | 1 | 1% | 6 | 72% | 4 | 8 (9) | 10 | 221 and 220 (0.5%) |
| autumn | 600 | 2 | 1% | 6 | 73% | 4 | 8 (8) | 11 | 218 and 216 (0.9%) |
| autumn | 600 | 3 | 2% | 6 | 78% | 4 | 8 (8) | 11 | 239 and 239 (0.0%) |
| winter | 150 | 1 | 2% | 5 | 85% | 4 | 8 (9) | 10 | 374 and 366 (2.2%) |
| winter | 150 | 2 | 1% | 6 | 71% | 4 | 9 (9) | 10 | 369 and 370 (-0.3%) |
| winter | 150 | 3 | 0% | 6 | 57% | 4 | 7 (8) | 10 | 380 and 381 (-0.3%) |
| winter | 300 | 1 | 1% | 6 | 75% | 4 | 8 (8) | 10 | 295 and 297 (-0.7%) |
| winter | 300 | 2 | 1% | 6 | 72% | 4 | 9 (9) | 11 | 286 and 288 (-0.7%) |
| winter | 300 | 3 | 1% | 7 | 62% | 4 | 8 (8) | 11 | 290 and 295 (-1.7%) |
| winter | 600 | 1 | 1% | 6 | 71% | 4 | 7 (8) | 10 | 239 and 237 (0.8%) |
| winter | 600 | 2 | 1% | 6 | 69% | 4 | 8 (8) | 11 | 239 and 229 (4.4%) |
| winter | 600 | 3 | 1% | 6 | 76% | 4 | 8 (8) | 11 | 257 and 260 (-1.2%) |

The fourth check: days to level 5 in a skill at the median pace of the regulars who play it in earnest, with how many of them the run had.

| Month | Residents | Seed | Growing | Making | Foraging | Hosting | Playing |
|---|---|---|---|---|---|---|---|
| autumn | 150 | 1 | 21 (n=2) | 29 (n=1) | 14 (n=1) | 30 (n=1) | 14 (n=1) |
| autumn | 150 | 2 | 21 (n=1) | 19 (n=1) | 11 (n=2) | 24 (n=6) | 14 (n=3) |
| autumn | 150 | 3 | none | 16 (n=2) | 16 (n=1) | 22 (n=1) | 18 (n=1) |
| autumn | 300 | 1 | 19 (n=2) | 25 (n=5) | 14 (n=4) | 25 (n=4) | 17 (n=3) |
| autumn | 300 | 2 | 22 (n=4) | 16 (n=1) | 14 (n=2) | 25 (n=6) | 14 (n=4) |
| autumn | 300 | 3 | 21 (n=1) | 23 (n=3) | 14 (n=2) | 19 (n=3) | 15 (n=1) |
| autumn | 600 | 1 | 22 (n=5) | 24 (n=9) | 18 (n=9) | 20 (n=7) | 15 (n=5) |
| autumn | 600 | 2 | 24 (n=7) | 23 (n=6) | 13 (n=6) | 24 (n=7) | 16 (n=4) |
| autumn | 600 | 3 | 17 (n=4) | 18 (n=6) | 15 (n=3) | 21 (n=7) | 14 (n=4) |
| winter | 150 | 1 | 20 (n=2) | 30 (n=1) | 14 (n=1) | 29 (n=1) | 14 (n=1) |
| winter | 150 | 2 | 20 (n=1) | 17 (n=1) | 14 (n=2) | 24 (n=6) | 13 (n=3) |
| winter | 150 | 3 | none | 19 (n=2) | 13 (n=1) | 21 (n=1) | 18 (n=1) |
| winter | 300 | 1 | 21 (n=2) | 30 (n=5) | 16 (n=4) | 23 (n=4) | 18 (n=3) |
| winter | 300 | 2 | 21 (n=4) | 17 (n=1) | 14 (n=2) | 24 (n=6) | 13 (n=4) |
| winter | 300 | 3 | 21 (n=1) | 21 (n=3) | 15 (n=2) | 19 (n=3) | 16 (n=1) |
| winter | 600 | 1 | 21 (n=5) | 25 (n=9) | 20 (n=9) | 24 (n=7) | 15 (n=5) |
| winter | 600 | 2 | 24 (n=7) | 27 (n=6) | 15 (n=6) | 23 (n=7) | 15 (n=4) |
| winter | 600 | 3 | 22 (n=4) | 21 (n=6) | 15 (n=3) | 20 (n=7) | 15 (n=4) |

Over the 18 months the median is 21 days for Growing (17 to 24), 22 for Making (16 to 30), 14 for Foraging (11 to 20), 23.5 for Hosting (19 to 30), and 15 for Playing (13 to 18). The other regulars who play a skill, without playing it in earnest, take about 19 days for Growing, 28 for Making, 25 for Foraging, 16 for Playing, and most of a year for Hosting.

In every one of the 18, the household earned 0 Hosting and 0 Playing points from each other, and the ring's most in a day was 20 Hosting points an account, 16 on an average day. The newcomer who made and fished ended day one with 50 to 80 points, level 2 or 3. The ring's idle tables were added after those 18 months were run. They draw nothing from the script's random streams, so the default month, run again, matches its earlier output line for line but for the fifth check's last sentence.

### The six checks

Four of the six miss as written with these numbers, and two hold. The first misses: about 2% of newcomers reach level 2 on day one. The third misses: every cap every day is 2.38 times the median regular's level, against at most 2. The fourth misses its range: Growing takes 21 days, Making 22, and Hosting 23.5, against 10 to 20. The sixth misses in 5 of the 18 months, by up to 4.4% against under 2%. The second and the fifth hold. The numbers stand anyway, for the reasons under each check, and each miss is something to look at again before `open_levels` is logged.

1. **A newcomer's first day: misses. It holds only for one who makes and fishes, and no number fixes that.** SKILL.md's first visit is a plot, a home, a name, a look, a seed in the ground, a post, and a few follows. None is a deed: a crop's first is its harvest, days later. So the median newcomer ends day one with 0 points, and about 2% reach level 2. The newcomer who also walks for five branches and two stones, makes a chair and a rod, digs a pond, and casts ends the day at level 3. Level 2 is 20 points, and a first craft is 12, so a chair alone isn't level 2: it takes a chair and a rod, a chair and a fish, or a rod and a fish. Wood within reach of a hearth comes at about half a branch a day (decision 0242), so the newcomer has to walk for it. This is for PR 4 to fix, not `PROGRESS`: a first-visit step or a `tryToday` suggestion that leads to a first deed.
2. **A regular's first weeks: holds with a step of 20.** At 25 the median regular reached level 5 on day 8, and 40% of them inside a week. At 20 the median is day 6 (5 to 7 over the 18 months), and 57% to 85% are there inside a week. A skill at level 3 comes on day 4 at the median either way, well inside two weeks.
3. **Every cap every day against a regular: misses, at 2.38 times against at most 2, and the cap stays.** A resident at every cap every day with every first would be level 19, and the median regular is level 8 (7 to 10 over the 18 months, so the check held in one of them). The step doesn't move this ratio, since a level grows with the square root of points, and only a lower cap would. The RFC expected a regular to earn 30 to 40 points a day. In the run a regular earns about 20, because not every regular gardens, fishes, hosts, and plays. Nobody in any run came near the ceiling: the highest level anyone reached was one or two above the median regular, because Hosting's and Playing's caps take other people and most days nobody fills them. Lowering the cap to close a gap nobody opened would slow the keen players the fourth check is about, so it stays at 20. If a bot ever does fill every cap, this is the check to run again.
4. **Each skill on its own: misses the 10 to 20 day range for three skills of five (Growing 21, Making 22, Hosting 23.5), though no skill is twice as slow as another now.** With the RFC's numbers Foraging took 18 days for someone playing it in earnest, Growing 24, Making 32, Playing 49, and Hosting 54. Playing and Hosting were three times as slow as Foraging, because their deeds are scarce: a slow table finishes about a game a day a seat, a lesson is one a day, and an event needs a host nearby. With a step of 20, a lesson and a counted guest at 8, and a rated game at 6, the same residents take 14 days (Foraging), 17 (Playing), 19 (Growing), 25 (Making), and 25 (Hosting) in the default month, and 14, 15, 21, 22, and 23.5 at the median over the 18. The RFC asked for 10 to 20 days. A smaller step would bring Growing, Making, and Hosting inside it and put Foraging under 10, so the step stays at 20 and the range is a little wide at the top. Making is bound by what a garden yields after the town's buying, and by wood. Hosting still depends on neighbors: the regulars who host an event a week and nothing more earn about a point a day.
5. **A household and a ring: holds.** A person and two AIs earned no Hosting or Playing points from a month of teaching, paying, hosting, and playing each other, and the sim refused every `credit_event` that named them as guests. The ring also sat down to 300 rated games in the month where nobody ever chose, 540 of the 600 seats rated, and earned 0 Playing points: a seat earns only from a game it chose in. A ring of ten fresh accounts never earned more than the cap, 20 Hosting points an account a day, which is the RFC's stated bound. At 8 a lesson and 8 a visit the ring reaches the Host title on day 4 and the party sash on day 11 to 13, a week sooner than at the RFC's numbers. That is the price of making Hosting playable in earnest, and it buys a ring a title and a garment, as the RFC accepts.
6. **Supply: misses in 5 of the 18 months, by up to 4.4% against under 2%, and holds on average.** Per active resident at month end moved by 1.4% in the default month. Over the 18 months it moved by 0.5% on average, from 2.0% down to 4.4% up, and by under 2% in 13 of them. Levels mint nothing. What moves is that some anglers cast more, a few regulars garden who didn't, and bounties pass coins between neighbors. A single month also moves a couple of percent either way for a reason that has nothing to do with levels: once anyone's purse differs, the script's later draws for shopping fall differently, so the average over the months is the number to read, not any one of them.

### What else was tried

- A step of 20 alone: the second check holds, but Hosting takes 44 days in earnest and Playing 39, three times Foraging's 14.
- The three deed values alone, with a step of 25: the skills are in balance (17 to 32 days), but the median regular still reaches level 5 on day 8.
- A lower cap: it narrows the third check's gap only by slowing everyone who plays a skill in earnest, and nobody in the run fills every cap.

### Choices made in the sim along the way

These are in PRs 1 and 2, where the RFC left something open or the code said otherwise.

- A `progress` event carries `firsts`, a list, not `first`: one `gather` with no tile can pick up two kinds.
- One `level_reached` per skill and one for the resident in an input, naming the level they're at now, however many they passed. The one-time credit would otherwise emit several per resident.
- A deed that straddles the cap adds what room is left.
- A recipe page earns a find's 4 points and is no first, since a page isn't a kind anyone holds.
- The bounty week's pairs and who an event counted today are written only when points were added, so levels never change state without a `progress` event.
- There is no `guestsMax`. The RFC's "up to 10 an event" is what the daily cap already does at 2 a guest, and a second guard could have no test that fails without it.
- `credit_event` has no check of its own for the host: the event's own attendance never holds them, and the household check refuses them too.
- A town bounty or a released grant counts every time, whatever it pays and whoever proposed it.
- A rated seat earns from a game only if it chose in at least one round, and nobody earns the first-place points when the game ended because every seat was away. The RFC paid every seat rated at the start, which paid two accounts that sit, start, and never choose, first-place points included.
- `credit_event` refuses an event that ended before the day levels opened (`state.progress.opened`), so the server can't credit old events by mistake. An event that ended earlier on the opening day itself still counts.
- Season points (decision 7 in the RFC) are kept by the season's first world day. The one-time credit counts in the total and in no season.
- The five earned garments are `EARNED_WEAR`, a list beside `WEAR_ITEMS`, not on its end. Everything that lists, draws, or collects wear walks `WEAR_ITEMS`, and the garments have no pictures until PR 5. The sim's wear checks take both lists, an earned garment takes no style yet, and the protocol's wear enum keeps them out of every action. They join `WEAR_ITEMS` when they can be drawn.
- The title a resident shows is in `state.progress.titles`, with its own public `title_changed`, and a `profile` that changes only the title emits no `profile_changed`.
- `open_levels` takes `firsts` as a list of `{resident, kinds}` and is refused whole when any entry is wrong.

## Consequences

- The numbers can still change before the server logs `open_levels`, since no live log holds a deed that earned. After that, any of them changes only behind a logged switch. Rerun `node scripts/economy-sim.ts` first; `--set progress.step=25` tries one without editing it, and the sixth check runs the same month again with `--no-levels` by itself.
- PR 4 has to give a newcomer a deed on day one, or the first check stays a promise the first visit doesn't keep. PR 5's journey test can't expect a level 2 toast from a chair alone.
- The shares of residents who forage, make, host, and play are guesses. Once levels are live, the real ones can replace them, and Hosting's and Playing's values are the first to look at again.
- A ring can farm a Host title in four days. Staff already look for clusters feeding each other (RFC 0006), and a ring's lessons, bounties, and `credit_event` lists are in the log.
- Code: [`packages/sim/src/levels.ts`](../../../packages/sim/src/levels.ts), [`packages/sim/src/levels.test.ts`](../../../packages/sim/src/levels.test.ts), [`scripts/economy-sim.ts`](../../../scripts/economy-sim.ts).
