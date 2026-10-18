---
title: A basket of fourteen crops, sold all year, with ten recipes and no new town buy orders
date: 2026-10-18
status: accepted
tags: [sim, economy, numbers, items, catalog]
---

# A basket of fourteen crops, sold all year, with ten recipes and no new town buy orders

## Context

A garden had seven crops: lemons, strawberries, tomatoes, herbs, flowers, and the two seasonal ones (pumpkins in autumn, cranberries in winter), plus pomegranates ([decision 0085](0085-furniture-keeps-its-own-role-in-decor-furniture-and-pomegran.md)). That is thin for something people check in on every day, and the kitchen had little to make past jam, a sauce, a tea and two pies.

[RFC 0018](../../rfcs/0018-one-catalog-of-things.md)'s catalog makes a crop a few lines of data, so the cost of a batch is in the numbers, not the plumbing. Three things bounded the choice. The coin faucet is tuned in a simulated month ([decision 0039](0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md), [decision 0052](0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md)): what the town pays per resident per day is a number that holds the economy together. Seasonal stock has its own pinned numbers per season ([decision 0079](0079-autumn-s-numbers-pumpkins-pumpkin-pie-and-soup-hay-bales-and.md), [decision 0124](0124-winter-s-numbers-cranberries-hot-cranberry-punch-winter-deco.md)). And every recipe card is meant to be learnable from a neighbor, so the eight townsfolk between them teach every card.

## Decision

Fourteen crops, each one `fruit(...)` or `crop(...)` entry, with seeds the shop sells all year like pomegranates':

| Crop | Family | Days | A harvest | Seeds |
|---|---|---|---|---|
| Cherry | fruit | 4 | 4 and a seed | 4 coins |
| Apple | fruit | 5 | 3 and a seed | 4 coins |
| Blackberry | fruit | 3 | 4 and a seed | 4 coins |
| Blueberry | fruit | 3 | 4 and a seed | 4 coins |
| Grape | fruit | 5 | 4 and a seed | 4 coins |
| Peach | fruit | 5 | 3 and a seed | 4 coins |
| Carrot | vegetable | 3 | 3 and a seed | 3 coins |
| Potato | vegetable | 4 | 4 and a seed | 3 coins |
| Ear of corn | vegetable | 4 | 2 and a seed | 4 coins |
| Cucumber | vegetable | 3 | 3 and a seed | 3 coins |
| Cabbage | vegetable | 4 | 2 and a seed | 3 coins |
| Melon | vegetable | 5 | 2 and a seed | 4 coins |
| Sunflower | flower | 3 | 3 and a seed | 3 coins |
| Tulip | flower | 2 | 3 and a seed | 3 coins |

Every number is inside the range the crops that shipped already sit in: 2 to 5 days, 2 to 4 a harvest, one seed back, and 3 or 4 coins a packet, the slower and fruiting ones at 4. A melon is in the vegetable family like a pumpkin, so the jam family recipe leaves it out; the six fruits each get their jam from it, known by everyone.

Ten new recipes, all cards on the Recipes shelf: `apple_pie` (2 apples, sugar), `apple_cider` (3 apples, a jar), `berry_crumble` (2 blackberries, a blueberry, sugar), `fruit_salad` (a cherry, a peach, a melon), `grape_juice` (3 grapes, a jar), `pickles` (3 cucumbers, herbs, a jar), `corn_bread` (2 ears of corn, sugar), `harvest_soup` (2 potatoes, a carrot, a jar), `garden_salad` (a cabbage, a carrot, a tomato) at a kitchen, and `posy` (2 tulips, a sunflower) at a workbench. Every new crop is used by at least one of them or by its jam.

**The town buys none of them.** No new buy order, nothing added to a season's buys, and the frozen rotation is untouched, so what the town paid on every past day is what it pays now and the faucet is the number the simulated month was run with. The new crops and dishes are for the kitchen, the workbench, gifts, the Thanksgiving feast, pet treats, the collection book, and the market between residents.

Three smaller calls fell out of it:

- Seeds sell all year rather than by season. A seasonal window would have changed `SEASON_STOCK`'s pinned numbers for seasons whose stock those decisions fixed, and it would mean most of the basket is out of reach on the day it ships. Autumn and winter keep pumpkins and cranberries as their own.
- The recipe pages that lie on the ground stay the sixteen cards they were. `PAGE_RECIPES` is frozen: a logged `gather` of a page replays only while that list is exactly as it was, so a new card is no page until a new list starts behind a logged switch.
- A townsfolk may teach up to four recipes, not three. Twenty-six cards over eight townsfolk needs it, and "every card is somebody's specialty" is the promise worth keeping: every recipe can be learned for nothing from a neighbor.

## Consequences

- No coin moves that didn't move before, so `scripts/economy-sim.ts` needs no rerun: its gardeners buy seeds only for crops the town buys. If one of these should earn coins, that is a buy order and a place in a season's buys, by a decision of its own, run through the month first.
- Each crop has the same chance of being somebody's favorite and no edge over another, since none of them sells. Growing a garden is now mostly about what you want to cook, give, and show.
- **Points move, and that is meant.** A first is 10 points outside the daily cap ([RFC 0029](../../rfcs/0029-levels-and-skills.md)), so one of every crop is worth 220 in Growing rather than 80: harvesting the whole catalog once now reaches level 5, the sun hat, where it used to reach level 3, the title. Making goes from level 6 to 7 the same way. Growing one of everything is a season's work and a fair thing for the gardener's hat to ask, so the numbers in `PROGRESS` stay as decision 0246 tuned them (changing one now needs a logged switch anyway). `levels.test.ts` in the sim pins what firsts alone reach for each skill, so the next batch of kinds has to look at it rather than find out later.
- **A family badge in the collection book re-opens.** The badges are worked out from the book each time it's read, never stored, so a resident who had "Every fruit" with four kinds has six more to find. The same goes for vegetables, preserves, drinks, dishes, keepsakes, and seeds. Nothing is taken away that was earned in coins or points, but a badge on a profile can disappear, which is why the changelog says so.
- A newcomer's three free picks now choose from 26 cards rather than 16, and a kitchen's sheet says "16 more recipes to learn" before her first pick. The shelf is longer; nothing holds back a card.
- The pictures: six new produce outlines (a pair on a stem, a bunch, a root, a cob, a long one, a leafy head) and a fan of greens on top, in `packages/ui/src/item-art.ts`, so a new fruit of a shape that exists stays a few colors. Six goods are drawn by hand there; the four in jars come from the jar template.
- Code: the entries in `packages/sim/src/catalog.ts`, the shapes and drawings in `packages/ui/src/item-art.ts`, the specialties in `packages/server/src/lesson-plan.ts`. `MEANT_MAX` in `packages/protocol/src/suggest.ts` went from 5 to 12, so `craft` with `jam` still names every jam rather than falling back to the whole recipe list.
