---
title: Items open with a logged input, grow by the world's day, and stack or sign
date: 2026-10-05
status: accepted
tags: [sim, protocol, server, client, economy, agents]
---

# Items open with a logged input, grow by the world's day, and stack or sign

## Context

[RFC 0005](../../rfcs/0005-make-show-and-give.md) step 2 brings seeds, planters, growth, crafting, inventories, and `give`. The coin shop and the market ([RFC 0008](../../rfcs/0008-coins-karma-and-the-market.md) phases 2 and 4) will price and trade these items, so the data has to be shaped for that now. The sim can't read a clock ([decision 0026](0026-time-enters-the-sim-as-logged-day-and-close-inputs.md)), old logs must replay to the same hash, and the server skips days it missed instead of replaying them one by one. RFC 0005 left open how many recipes to launch with and whether made things carry their maker forever. Two other questions came up while building: whether stations and planters cost materials to build (a ghost block you fill in) or appear at once, and whether item kinds are curated or free-form.

## Decision

- **A logged input opens items.** The server appends `open_items` (from `TOWN_ACTOR`) once the world counts days, the same way it opens coins. Until then nothing about items runs, so a log without it hashes as it always did. The starter seeds and the daily pantry are bookkeeping on residents' own inputs, and they could not be added to old logs without changing how they replay.
- **Growth is a function of the world's day.** A crop stores `plantedDay` and `readyDay` (planted day plus the crop's days) and is ready once `state.day` reaches `readyDay`. `new_day` touches no crop, so a skipped day counts like any other and a day's input stays small however many gardens there are. The `planted` event and the snapshot carry `readyDay`, so clients draw growth without running a rule.
- **Seeds, produce, and staples stack; made things are signed.** Stackable kinds are counts per resident. A made thing is its own item with an id from a world counter (`i_1`, `i_2`, ...), its maker, the day it was made, and an optional label (40 characters, untrusted, filtered as `item_label`). It keeps its maker wherever it goes, which answers RFC 0005's third question: yes, like a signed jar. Unique items give the market a clean thing to hold in escrow; stacks keep 200-item inventories small in state.
- **A curated catalog, as data.** `packages/sim/src/items.ts` holds every kind, crop, and recipe, like the looks catalog ([decision 0029](0029-looks-are-curated-themes-plus-your-own-uploaded-art.md)). The only free text is the label. The shop and the market will key prices and buy orders by these kind names.
- **Eight recipes at launch, not twelve.** Five kitchen recipes (two jams, lemonade, tomato sauce, herb tea) and three workbench ones (bouquet, herb sachet, flower wreath). Pies need flour, which needs a grain crop, and paintings need pieces, which are step 3. Adding a recipe later is additive.
- **Planters and stations are instant, free blocks.** `planter`, `kitchen`, and `workbench` join `BLOCK_KINDS` and are placed like wood. No ghost blocks: there are no building materials yet, and a blueprint that fills in over days would be a second growth system. If the shop sells styled stations later, the plain ones stay free, so old `place` inputs replay the same. Crafting works at anyone's station within reach; a planter can only be planted and picked by someone who can build on its plot, and can't be removed while something grows in it. A Town Hall `commons_build` still places only the four building blocks (`BUILDING_BLOCKS`): nobody could plant in a Commons planter, and a public kitchen is a choice for its own proposal kind later.
- **Sugar and jars come from a daily pantry.** The first time each UTC day you stand on your hearth (the same moment as the coin allowance), you get 2 sugar and 2 jars, never past 10 of each. The very first time also brings 2 of every seed. The pantry is due only when it would add something, so it never changes state without an event, and `home` at a full shelf is `already_home`. Townsfolk get no pantry, as they get no allowance. Each harvest gives a seed back, so a garden keeps going; growing it bigger means friends' gifts now and the shop later.
- **Gifts work like coin gifts.** `give {item, to, count?, note?}`: up to 20 things given and 50 received a day (the receive cap refuses only once reached, as with coins), owner pairs skip the caps from the day after they link, and blocks stop gifts (checked by the server). There's no first-day rule as with coins: the starter kit needs a plot and a hearth, plots are scarce, and the caps bound what a crowd of new accounts could funnel. Inventories are private: `inventory` events go only to their resident, and `item_given` tells everyone who gave whom what kind of thing, without the count or the note.

## Consequences

- `ITEMS` in `packages/sim/src/items.ts` holds every number. `src/fixtures/items-log.ts` pins a log with items, so a change to the catalog or a rule that would replay the live log differently fails a test. Once items are live, changing a recipe or a crop's days changes how old logs replay and needs an RFC, the same as coins.
- Not built yet: gift gestures that carry an item, declining a gift, display and galleries (step 3), and the shop. A shop that sells seeds, sugar, and jars should come with a retune of the pantry.
- The palette in the world now holds eight tools in one row that scrolls on narrow phones.
