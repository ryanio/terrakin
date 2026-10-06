---
title: Holidays are dated windows read from the world's day, candy is a sweet that stacks, and trick-or-treating is a sim action with its own caps
date: 2026-10-06
status: accepted
tags: [sim, protocol, economy, replay, holidays, items]
---

# Holidays are dated windows read from the world's day, candy is a sweet that stacks, and trick-or-treating is a sim action with its own caps

## Context

[RFC 0022](../../rfcs/0022-holidays.md) adds holidays and builds Halloween, 25 days out. Seasons ([decision 0078](0078-seasons-follow-the-utc-calendar-and-add-stock-crops-recipes-.md)) are three-month chapters the shop reads from the logged day. Halloween needed three things the sim didn't have: a window of days finer than a season, a thing to hand out by the dozen, and an exchange at a neighbor's door that moves it. The live log has to replay to the hash it has.

## Decision

- **A holiday is a dated window.** `HOLIDAY_INFO` in `packages/sim/src/holiday.ts` gives each holiday a first and last UTC date, both in it, the same every year. `holidayOf(day)` reads the logged day with `dateOfDay`, like `seasonOf`: no state, no input. Holidays never overlap and never cross a year end, so a day is in one at most (`holiday.test.ts`).
- **Holiday stock is sold only while it runs.** A catalog entry's `shop.holiday` and the shop's `COSTUMES` make up `HOLIDAY_STOCK`. `shop_buy` refuses it outside the window with `out_of_holiday`, naming the dates and the day it's back. Recipes are never held back by date, as RFC 0017 decided for seasons.
- **Candy is a sweet.** A new role, `sweet`, in a new family, food › sweets: made at a kitchen like a good, but it stacks like furniture and takes no label. A recipe can say how many one craft makes (`makes`, five for candy); everything before it makes one. Sweets join the end of `STACK_KINDS`, after every role that shipped. `craft` checks for room only when a recipe makes more than it uses.
- **Trick-or-treating is a sim action.** `trick_or_treat {px, py}` moves a candy between inventories, or makes one from the town, so it's an input the sim checks and replays. Nothing in it is random, so no roll is logged. The candy comes from whoever lives there and is home (online and on that plot) with some, else through a candy bowl on the plot from the first of them who holds any, else from the town. Today's knocks live in `state.knocks`, absent until the first and dropped at `new_day`.
- **The caps.** Once a door a night per knocker, 10 doors a night per knocker, and the town's candy at 5 a door and 250 a night. A knocker needs a hearth, isn't townsfolk, stands on the plot or beside it, and isn't knocking on their own, a shared, or their household's door. The server refuses a knock across a block and at a suspended owner's door, as for `visit`.
- **A candy bowl holds no candy of its own.** While it stands on a plot it hands out the candy of whoever lives there, even when they're away. It's decor with one rule, read by the knock.
- **The owner's notice is a social row.** The server turns each `trick_or_treated` into a `trick_or_treat` notification for the plot's owner and co-owners, grouped per door per UTC day, through `notify()`.

## Why

- A dated window read from the logged day can't drift from the calendar and needs nothing scheduled. Same reasoning as seasons.
- Candy is handed out one at a time and counted by the dozen. A made good carries an id, a maker, and a day each, which is bookkeeping nobody reads for a sweet, and a door can't count out goods the way it counts a stack. Furniture already stacks and is made, but it places as a block and sits under decor; candy is food. A staple is what the pantry tops up and recipes use. So candy gets its own role, and the role is the decision this record holds. Five a craft makes the kitchen the cheap way to be generous at your door.
- Admiring a plot is a social row because it changes nothing in the world. A knock moves things between inventories, and only the sim does that.
- A bowl that held its own candy would need a fill command, state for what's in it, and rules for taking it up or building over it. Handing out its owner's candy does the same job for someone away.
- The caps keep a ring of accounts from emptying the town's candy before honest knockers come by, and candy mints no coins (the town buys none), so the most a ring gains is candy.

## Consequences

- Old logs replay unchanged: new kinds, wear, a command, an event, and codes, and no frozen list grows. `REPLAY_VERSION` stays 1. `packages/sim/src/fixtures/halloween-log.ts` pins a log with costumes, candy, decor, and a night of knocks, and `replay.test.ts` replays it at every split point.
- A future holiday is an entry in `HOLIDAY_INFO`, its stock (`shop.holiday` on kinds, or a wear list in `shop.ts`), and a module for its own rules, with a decision on its numbers.
- Adding a trick-or-treat day, or raising a cap, only accepts what was refused, which changes no logged knock. Lowering a cap or taking a day away changes replay.
- A sweet that isn't candy would join `SWEET_KINDS` and `craft` with no new rule. A new role, family, or recipe field after this one is its own decision.
- Code: `packages/sim/src/holiday.ts`, `packages/sim/src/halloween.ts`, `HOLIDAY_STOCK` and `out_of_holiday` in `packages/sim/src/shop.ts`, `COSTUMES` in `packages/sim/src/looks.ts`, `SWEET_KINDS` and `makes` in `packages/sim/src/catalog.ts`, sweets in `checkCraft` (`packages/sim/src/items.ts`).
