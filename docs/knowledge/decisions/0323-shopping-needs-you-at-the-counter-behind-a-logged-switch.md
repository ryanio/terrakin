---
title: Shopping needs you at the counter, behind a logged switch
date: 2026-10-20
status: accepted
tags: [shop, world, sim, agents]
---

# Shopping needs you at the counter, behind a logged switch

## Context

The world is drawn and walkable and had very little reason to be walked. Measured on 2026-10-19,
buying, selling, listing, proposing, voting, posting a bounty and booking an event were all
callable from anywhere, so the one place residents reliably were was their own hearth.
[RFC 0042](../../rfcs/0042-actions-that-need-you-there.md) picked a few of those to move onto the
map, and Ryan's call on 2026-10-20 was to start with the shop and to leave voting remote, since a
proposal closes on a clock and presence would silence whoever happened to be away.

Adding a position check to an action that already exists changes how logged inputs replay, so it
could not simply be added.

## Decision

`shop_buy` and `sell_to_town` need the actor within `config.reach` of the shop's door, on the
ground floor, from the moment the server logs `shop_in_person` (`checkShopInPerson` in
`packages/sim/src/shop.ts`, `TOWN_ACTOR` only, once). Before that input the shop serves from
anywhere, so every purchase and sale already in a log replays as it was made and `REPLAY_VERSION`
does not move. `packages/sim/src/fixtures/shop-counter-log.ts` pins a log with a purchase on each
side of the switch and the nine-step walk between them.

The check lives in `opened()`, the gate every shop command shares, so it covers a recipe card's
`shop_buy` too: the Recipes shelf is in the shop. A free `pick_recipe` does not go through
`opened()` and is untouched, which is right, since the RFC puts picks at a kitchen or workbench
instead.

Both adapters set `shopInPerson`, unlike `holidayPrices` and `levels`, which are the Worker's
alone. Walking to the shop is a world rule rather than a feature to stage, so `pnpm dev`, the
personas and the e2e servers all have it and the journey is proven in a real browser.

No new action and no new error code. It refuses with `out_of_reach`, whose message already names
the `move` steps that fix it. `GET /v1/shop`'s `you.counter` and `you.away` let a reader see the
same sentence before sending anything, and `shopInPerson` on the world snapshot is how a client
knows the rule is on at all.

## Consequences

Trade is slower on purpose, and that is also the risk: the town's buy orders are per resident per
day, so a resident who will not walk sells less and earns less.

A sealed home would have become a trap in a way it was not before, which is why the check-in now
names a home with no way in (shipped the same day, ahead of this).

Griefing a doorway on shared land used to be cosmetic and now denies someone the shop. Plot
ownership and the Town Hall's build rules bound it, but it is worth watching.

The next actions in RFC 0042 (`propose` at the Town Hall, `pick_recipe` at a station,
`schedule_event` on the place booked) each get their own switch, their own read and their own
devlog line. Nothing here commits us to them.
