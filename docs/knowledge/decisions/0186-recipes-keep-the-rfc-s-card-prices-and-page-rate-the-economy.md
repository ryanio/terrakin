---
title: Recipes keep the RFC's card prices and page rate: the economy run with picks, cards, lessons, and pages
date: 2026-10-07
status: accepted
tags: [economy, numbers, sim, scripts, recipes]
---

# Recipes keep the RFC's card prices and page rate: the economy run with picks, cards, lessons, and pages

## Context

[RFC 0024](../../rfcs/0024-recipes-you-learn.md) prices recipe cards by a rule (`recipeCardPrice`: 5 times the town's price for a rotation good, 8 times for a good the town buys every day of its season, else 10 coins plus 3 a thing, rounded to 5) and puts a recipe page in about 1 find in 20 (`RECIPES_RULES.pageOneIn`). Its Economy impact section asks for the coin simulation to play picks, card buying, and teaching on the seeds of [decision 0052](0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md) before `open_recipes` ships, and for those four numbers to change only if the run calls for it. Nothing is live yet, so a change now wouldn't touch replay.

## Decision

Nothing changes: the card rule keeps 5, 8, and 10 plus 3, and `pageOneIn` stays 20.

`scripts/economy-sim.ts` now plays recipes by default, through the real sim:

- The world logs `open_finds` and `open_recipes` after the shop opens, so everyone who arrives is a newcomer with three picks. Townsfolk know everything.
- A gardener picks the goods they'd sell from what they grow, best paid first, and buys the card for each other one once they can afford it with 10 coins to spare. Anyone else picks three cards off the shelf. `--picks shelf` has gardeners pick any three cards too, for someone who picks what they like.
- A gardener who'd sell a good they don't know asks a neighbor (hearths within two plots) about one active day in ten. The nearest neighbor around that day who knows it and hasn't taught visits, walks within reach, teaches, and goes home.
- About one active day in ten a townsfolk stands near a resident and teaches the first of their specialties the resident doesn't know, as the server's lessons run does. The run's eight townsfolk take the real eight lists (`SPECIALTIES`) in order. The sim checks the daily and weekly limits.
- Anyone at home picks up a recipe page lying within reach for a recipe they don't know.
- `--no-recipes` plays the month exactly as before, and `--set recipes.<key>=<n>` tries another value of a key of `RECIPES_RULES`.

Each run is 30 days from October 4, 2024 (autumn), before and after recipes. "Made sale" is the median days from arrival to a gardener's first sale of something they made, for gardeners with a week or more of the month left. "Knows" is the median and p90 days until they know all four year-round goods the town buys that need a card (tomato sauce, flower wreaths, lemonade, herb sachets). "Cards" is coins spent on cards in the last 7 days per active resident.

| Run | Minted | Burned | Per active resident | Treasury | Made sale | Knows | Cards a week |
|-----|--------|--------|---------------------|----------|-----------|-------|--------------|
| Seed 1, 300 residents | 61,194 → 61,136 | 18,171 → 21,803 | 356 → 326 | 3,392 → 3,471 | 2 → 2 | 0, p90 0 | 12.3 |
| Seed 2 | 62,038 → 61,877 | 16,741 → 20,348 | 347 → 318 | 3,679 → 3,774 | 2 → 2 | 0, p90 0 | 7.4 |
| Seed 3 | 55,970 → 55,933 | 16,129 → 19,940 | 355 → 321 | 3,261 → 3,365 | 2 → 2 | 0, p90 0 | 9.4 |
| 600 residents | 98,781 → 99,186 | 30,814 → 35,379 | 286 → 269 | 96 → 91 | 2 → 2 | 1, p90 4 | 7.5 |
| 150 residents | 39,017 → 39,004 | 9,256 → 11,254 | 415 → 380 | 9,802 → 9,853 | 2 → 2 | 0, p90 0 | 12.6 |
| Seed 1, winter (`--start 2024-12-04`) | 60,296 → 60,216 | 18,122 → 21,413 | 349 → 322 | 3,412 → 3,478 | 2 → 2 | 0, p90 0 | 4.1 |
| Seed 1, `--picks shelf` | 61,194 → 61,248 | 18,171 → 25,132 | 356 → 299 | 3,392 → 3,614 | 2 → 2 | 2, p90 8 | 17.2 |

How residents learned in seed 1's month: 795 picks, 181 cards (4,520 coins), 5 lessons from neighbors, 166 from townsfolk, and 9 pages. With `--picks shelf`: 388 cards (10,040 coins) and 26 lessons from neighbors. The phase 1 month of [decision 0039](0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md) (`--no-shop`) has no shop, so no recipes, and is unchanged.

Why nothing changed:

- Cards mint nothing, and the run agrees: what the town minted moved less than 0.5% either way, which is timing. The whole change in supply is the burn, 3,300 to 3,800 coins more a month at 300 residents (2,000 at 150, 4,600 at 600), so supply per active resident ends 6% to 10% lower. Decision 0052 wanted that number lower, not higher, and the treasury takes its 5% as before.
- A newcomer loses no early sales. Three picks cover three of the four year-round goods a gardener would sell, and the fourth card (herb sachets, 15 coins) is affordable on the first day. Even when picks go to furniture, the first sale of something made still comes on day 2 (jam and herb tea are known by all and on the rotation), and the goods are known within 2 days, p90 8.
- The spend is modest next to the allowance (about 70 to 100 coins a week): 4 to 13 coins a week per active resident, 17 when picks go elsewhere. Most of it in autumn is the pumpkin pie and soup cards (50 and 40) bought by residents who grow pumpkins, which pay back in 8 days of autumn and again every year. That is also why gardeners' month-end purses dip (seed 3's first-week gardeners: median 192 to 141): a card bought late in the month hasn't paid back by its end.
- Pages are rare in the run: 6 to 13 a month at 300 residents, and 29 at 600, because residents here only look within reach of their hearth. That's too few to move coins whatever `pageOneIn` is, so nothing in the run asks for a different rate; how often a page should turn up is a question of how it feels to find one, for after it's live.
- The payback test in `packages/sim/src/recipes.test.ts` still holds every card for a good the town buys to 5 to 30 days of selling.

## Consequences

- The default month now has recipes in it, so the numbers in decisions 0052, 0079, 0123, and 0124 come from `--no-recipes`. A later economy decision compares against the default month.
- How often residents ask for lessons and meet townsfolk (`TEACH_ASK`, `NEAR_TOWNSFOLK`) are guesses, not measurements. Lessons barely matter in the run because a sensible newcomer already knows what they sell; if real newcomers pick the way `--picks shelf` does, cards and lessons both matter more.
- If live card spending per active resident grows well past the run's (say 20 coins a week), lower `seasonTimes` first, since seasonal cards are most of it. Once recipes are open on terrakin.org, any change to `RECIPES_RULES` changes how logged inputs replay, so it needs a logged switch.
- Code: `learnAtHome`, `teachingDay`, `meet`, and `newcomerLines` in `scripts/economy-sim.ts`; `recipeCardPrice` and `RECIPES_RULES` in `packages/sim/src/recipes.ts`.
