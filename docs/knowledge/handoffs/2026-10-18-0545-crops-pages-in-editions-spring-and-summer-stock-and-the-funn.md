---
title: "Crops, pages in editions, spring and summer stock, and the funnel reading"
date: 2026-10-18
tags: [items, recipes, seasons, onboarding, performance]
---

# Crops, pages in editions, spring and summer stock, and the funnel reading

## Done

- `0af010da`, [decision 0308](../decisions/0308-a-basket-of-fourteen-crops-sold-all-year-with-ten-recipes-an.md): fourteen crops (six fruits, six vegetables, two flowers) and ten recipes. Seeds all year, 3 or 4 coins; the town buys none of them, so the coin faucet is the number the simulated month was run with. Six new produce outlines and a fan of greens in `packages/ui/src/item-art.ts`.
- `286e2b74`, [decision 0310](../decisions/0310-recipe-pages-come-in-editions-and-edition-2-puts-every-card-.md): the recipe page list comes in numbered editions, like the jobs board's table. Edition 1 is the 16 cards pages shipped with, edition 2 adds the ten; the server-only `set_page_edition` moves a world forward right after a `new_day`. The Worker passes 2, so terrakin.org switched; dev and e2e stay on 1. The snapshot carries `pageEdition`, since clients draw pages themselves.
- `d728e1e6`, [decision 0311](../decisions/0311-spring-and-summer-get-a-crop-and-a-decor-piece-each-with-no-.md): spring sells pea seeds and a bird bath, summer chili seeds and a beehive. `SEASON_STOCK.spring` and `.summer` were empty arrays before this, so half the year the shop had no seasonal shelf.
- `ca545463`: merged [PR #83](https://github.com/ryanio/terrakin/pull/83), musefelipe's 2026-10-16 devlog. It had gone `CONFLICTING` on its generated files when main's own 2026-10-18 devlog landed; the fix was merging main into the branch and running `pnpm gen`.
- `97e96253`, [a learning](../learnings/2026-10-18-splitting-the-cards-worker-out-took-the-cold-start-from-535m.md): the cards Worker split took the main Worker from 535 ms on 7.6 MB to 202 to 239 ms on 4.1 MB, over four deploys. That was the 2026-10-16 handoff's open measurement.

## The newcomer funnel, read 2026-10-18

From `GET /v1/admin/newcomers`, as counts:

| | joined | claimed | hearth | a thing |
|---|---|---|---|---|
| People, all time | 24 | 13 (54%) | 10 (42%) | 5 (21%) |
| Agents, all time | 28 | 27 (96%) | 24 (86%) | 20 (71%) |
| People, week of 10-12 | 7 | 3 (43%) | 1 (14%) | 2 (29%) |
| Agents, week of 10-12 | 7 | 7 (100%) | 7 (100%) | 6 (86%) |

Two things stand out. The door works now: all 7 people who joined in the week of 10-12 have a look, against 4 of 14 the week before, which is what the character picker at the world's door was for. And the floor is the same place it was: a person who settles mostly never ends up holding anything. 10 people have set a hearth all time and 5 have ever held a thing, where agents go 24 to 20. The pantry comes with standing on your hearth, so the step that leaks is between claiming a plot and coming home to it.

Agents are not the problem and never were. Every number for them is above 85%.

## Next

1. The thing-holding step for people. A person who claims a plot and never holds anything has nothing to cook, give, or show, and the first session is the only lever for them (the 2026-10-16 handoff). Worth reading what the world looks like to someone who has just claimed: does anything on screen say the pantry is waiting at the hearth?
2. Spring and summer crops earn no coins, while pumpkins and cranberries do. A buy order for peas or chilis is its own decision with `scripts/economy-sim.ts` run first, and it would want recipes to go with it.
3. Sentry's 2.24 MB in the main Worker is the next size item, but the case is thinner at 210 ms than it was at 535 ms. Measure the cold TTFB on terrakin.org before spending a session there.
4. The jam family recipe now makes ten jams. A second family recipe (a pie or a juice from any fruit) would spread the fruit further, and RFC 0018 says a new family recipe needs a decision of its own.

## Watch out

- `pnpm dev:test` holds port 8797, which the e2e suite also uses (ten ports from `TERRAKIN_E2E_PORT`). Running both at once kills the dev world mid-session; it cost two confusing debugging stops here.
- A kind's place in `SEASON_STOCK` is replay, not presentation: `shop_buy` refuses seasonal stock out of season and replay re-checks every logged input, so a kind anyone has bought can never be moved into a season afterwards. New seasonal stock has to be a new kind.
