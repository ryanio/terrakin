---
title: "Thanksgiving's numbers: decor, the feast's evening, and one dish a resident"
date: 2026-10-15
status: accepted
tags: [sim, economy, numbers, holidays, events]
---

# Thanksgiving's numbers: decor, the feast's evening, and one dish a resident

## Context

[RFC 0034](../../rfcs/0034-winter-holidays.md) adds Thanksgiving, on holidays that can move with the calendar ([decision 0287](0287-holidays-have-span-rules-may-overlap-and-cross-a-year-end-an.md)). It proposed a cornucopia at 20 coins and a leaf garland at 12, a feast in the Commons on the Thursday, and one dish a resident with no reward. Halloween's decor was halved after launch so newcomers could afford it in their first week ([decision 0210](0210-halloween-s-costumes-and-decor-cost-half-from-a-logged-lower.md)).

## Decision

- Thanksgiving runs from the Monday before the fourth Thursday of November to the Sunday after: `{weekday: {month: 11, weekday: 4, nth: 4}, from: -3, to: 3}`.
- `cornucopia` costs 12 and `leaf_garland` 6, the range Halloween's decor costs since decision 0210, sold only during Thanksgiving. No wear.
- The feast is a town event in the Commons on the Thursday from 18:00 UTC for 540 minutes, the harvest night's evening (decision 0081), with Clem and Otis as its faces. The server books each year's from the sim's dates (`HOLIDAY_TOWN_EVENTS` in `packages/server/src/town-events.ts`).
- `bring_dish` takes one thing a kitchen makes (a good or a sweet in the food families) from a resident in the feast's area, once a feast. It leaves the world, and nothing is paid for it.

An economy run of November 9 to December 8 (`node scripts/economy-sim.ts --start 2026-11-09`, the residents who keep a holiday buying a piece of its decor): 76 residents kept Thanksgiving and all 76 bought decor, newcomers who arrived from a week before it included (49 of 49). Holiday stock took 660 coins in the month, all burned. Supply never fell.

## Consequences

- The feast is the second event the town books on its own calendar each year, after the Sunday gathering; New Year's Eve will use the same `HOLIDAY_TOWN_EVENTS`.
- A dish brought is a sink of things, never of coins. A ring of accounts gains nothing by bringing dishes.
- Changing a price once Thanksgiving's stock has been bought in a live world needs a logged switch, as decision 0210's did.
- Code: `packages/sim/src/thanksgiving.ts`, the catalog's `cornucopia` and `leaf_garland`, `dishMove` and the `dishes` on the event view in `packages/server/src/events.ts`, and `dish-sheet.ts` on the web.
