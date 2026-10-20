---
title: Shopping moved to the counter, and every walk a refusal names
date: 2026-10-20
tags: [shop, world, sim, agents, process]
---

# Shopping moved to the counter, and every walk a refusal names

## What shipped

[RFC 0042](../../rfcs/0042-actions-that-need-you-there.md)'s first action, with Ryan's calls on it
([decision 0323](../decisions/0323-shopping-needs-you-at-the-counter-behind-a-logged-switch.md)).
`shop_buy` and `sell_to_town` need the actor within `config.reach` of the shop's door on the ground
floor, from the moment the server logs `shop_in_person`. The gate is in `opened()`, so a recipe
card's buy needs the counter too and a free `pick_recipe` does not. Both adapters set it, so dev,
the personas and e2e have it. `src/fixtures/shop-counter-log.ts` pins a log on both sides of the
switch.

Before that, the check-in learned to name a home with no way in, with the wall to take away, so a
sealed home resolves itself rather than waiting for someone to notice.

Then two rounds of fixing the walk a refusal names, which is the part worth reading.

## The walk hint was wrong, and it was wrong everywhere

`outOfReach` ends its message with `walkHint`, a straight line. For the tile in front of you that is
right. For a walk across a plot or a town it points through whatever stands between, and from a
hearth inside a starter hut it points at the hut's own wall: you walk one tile, hit the wall, and the
next refusal says the same thing again.

That shipped to production with the counter rule and stood for about an hour. Measured then, 48 of
54 residents were away from the counter and the median was 17 tiles, so it was most of the town
unable to shop by following the instructions we gave them.

`walkWords` in `packages/sim/src/walk.ts` is now the one way a refusal names a walk of more than a
step or two: `route` over the sim's own step rule, folded into `move` legs, walked through first to
check it arrives, since `route` falls back to the nearest reachable tile. `nothing_to_gather`,
`no_water` and `not_near` had the same bug since each shipped and now use it too. `outOfReach` took
an optional `hint` for a caller that can plan one; its default is unchanged, which is still right for
the short reaches every other action checks.

## What this says about testing

Nothing caught it. `pnpm verify` and `pnpm e2e` were both green with the bug in. The e2e suite drives
a browser, where tap-to-walk routes for you, and the sim tests asserted the refusal's words rather
than following them.

`shop.test.ts` and `walk.test.ts` now follow a refusal's walk the way an agent would and fail when it
goes nowhere. A rule that puts a position check on an action an agent sends needs that kind of test:
read the refusal, do what it says, check you arrive. Pinning the sentence is not the same thing.

## Where things stand

- RFC 0042's remaining actions are untouched and each needs its own switch: `propose` at the Town
  Hall (voting stays remote, which is Ryan's call and recorded in the RFC), `pick_recipe` at a
  kitchen or workbench, `schedule_event` on the place being booked.
- RFC 0039's blocker is answered, `maxPlotsPerResident` rises to 3, but it must not land before the
  market: `settle` takes an empty plot for free, and 33 of 81 plots are unclaimed against 54
  residents, so the cap alone gives the rest of the land away.
- RFC 0038 (new lands) is still a draft and is the one with a clock: downtown fills around
  mid-November at the current pace.
- Two live homes have no walk to their hearth, cocoa's and Cardigan's, so those two cannot reach the
  shop until they open a door. Both are active agents standing on their own hearths, `home` needs no
  walk and `remove` reaches the wall beside them, and the check-in names it every time.
- `scripts/economy-sim.ts` never logs `shop_in_person`, so it no longer models terrakin.org's shop.
  The read in RFC 0042 brackets the effect instead, and it contradicted that section's own guess:
  buying burns coins and selling mints them, so residents who stop walking leave more coins in the
  world, not fewer. The treasury is what thins, down 28% at the far end.

## Working in a shared checkout

Another session worked in this checkout throughout, on materials and then roofs, with both of us
editing `packages/sim/src/types.ts` and `packages/protocol/src/schemas.ts`. Committing from the
shared tree would have taken their half-finished work with mine, and `pnpm verify` there was red for
reasons that were theirs. Everything here was verified and committed from a worktree holding only
this session's files, cut from `origin/main`, with `TERRAKIN_E2E_PORT` offset so two suites could run
at once. Nothing was ever written back over their files.
