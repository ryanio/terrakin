---
title: "Halloween's numbers: costumes, candy, decor, and the night's caps"
date: 2026-10-06
status: accepted
tags: [sim, economy, numbers, holidays]
---

# Halloween's numbers: costumes, candy, decor, and the night's caps

## Context

[RFC 0022](../../rfcs/0022-holidays.md) builds Halloween ([decision 0106](0106-holidays-are-dated-windows-read-from-the-world-s-day-candy-i.md)): costumes, candy, decor, and trick-or-treating on October 31. The prices had to sit with the shop's ([decision 0052](0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md), [decision 0079](0079-autumn-s-numbers-pumpkins-pumpkin-pie-and-soup-hay-bales-and.md)), against a regular's 10 to 15 coins a day from the allowance and a newcomer's 50-coin welcome gift ([decision 0039](0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md)). The night's caps had to keep a ring of accounts from emptying the town's candy.

## Decision

| Thing | Number |
|---|---|
| Witch hat | 60 coins |
| Cat ears | 40 coins |
| Pumpkin head | 70 coins |
| Ghost sheet | 50 coins |
| Bat wings | 70 coins |
| Candy at the shop | 2 coins each |
| Candy at a kitchen | 5 from a pumpkin and a bag of sugar |
| Bat bunting | 12 coins |
| Cauldron | 30 coins |
| Candy bowl | 15 coins |
| Doors a resident can knock on a night | 10, each once |
| The town's candy at one door a night | 5 |
| The town's candy a night, across town | 250 |

All of it is sold only from October 24 to November 1, and trick-or-treating is on October 31 (UTC).

Why these values:

- **Costumes sit at and under the cheapest shop wear.** The umbrella is 60, the top hat 80, the raincoat 90. A costume is for one week a year (though it's yours to wear any day), so it costs less. Across Halloween's nine days a regular earns 90 to 135 coins: one costume in three to six days, or two across the week. Cat ears, the smallest, cost 40, so a newcomer's welcome gift buys them on their first day. The pumpkin head and bat wings take the most drawing and cover the most of a figure, so they cost the most.
- **Candy is cheap to make and a little dearer to buy.** A pumpkin sells to the town for 2 coins in autumn and sugar costs 3 at the shop (the pantry gives one a day free), so five candies from the kitchen cost at most 5 coins, a coin each, against 2 each at the shop. Twenty candies for a night at the door are 20 coins of shopping or four crafts. The town buys no candy, so it never mints coins.
- **Decor is priced against the autumn decor.** Bat bunting is a step up from a hay bale (8), cheap enough to string a few along a fence. A cauldron is a centerpiece, priced like a picture frame (30), under a lantern (40). A candy bowl is cheap enough that anyone with candy puts one out: under two days' allowance.
- **Ten doors a night.** Enough for a person and their AI to each make a generous round of the neighborhood, few enough that knocking never becomes the way to get candy.
- **Five from the town at a door.** The first trick-or-treaters at a door with nobody home still get a candy. After that a door needs someone home with candy or a bowl, which is what makes putting one out worth doing.
- **250 from the town a night.** Enough for 25 residents to find ten empty doors each. It bounds what a ring of accounts can take to what the town would give 25 honest knockers, on one night a year, and the prize is candy, not coins.

## Consequences

- These numbers replay. `halloween.test.ts` pins them and the Halloween log's hash, so changing a price, the recipe, or a cap needs a decision that says how old logs replay. Raising a cap only accepts what was refused, so it changes no logged knock; lowering one does.
- If the town grows enough that 250 runs out early on the night, raise `townPerDay` before the next October 31.
- Code: `WEAR_PRICES` and `HOLIDAY_STOCK` in `sim/src/shop.ts`, the `candy`, `bat_bunting`, `cauldron`, and `candy_bowl` entries in `sim/src/catalog.ts`, and `TRICK_OR_TREAT` in `sim/src/halloween.ts`.
