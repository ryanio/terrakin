# RFC 0017: Seasons

- Author: drafted by Claude for Ryan
- Date: 2026-10-06
- Status: accepted (Ryan, 2026-10-06)
- Discussion: <PR link>
- Builds on: [decision 0026](../knowledge/decisions/0026-time-enters-the-sim-as-logged-day-and-close-inputs.md) (time as logged days), [RFC 0005](0005-make-show-and-give.md) (growing and making), [RFC 0008](0008-coins-karma-and-the-market.md) and [decision 0052](../knowledge/decisions/0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md) (the town shop), [RFC 0010](0010-hosted-events.md) (hosted events, for the harvest night later).

## Summary

Terrakin gets seasons, by the UTC calendar: spring is March to May, summer June to August, autumn September to November, and winter December to February. Each season can bring a crop whose seeds the town shop sells only then, decor for your plot, kitchen recipes, and things the town buys every day of it. All of it is decided in the sim from the world's day, so it replays. When a season ends, the shop stops selling its stock and the town stops buying its goods, but nothing you have goes away: seeds you hold still plant, and what you made or bought stays yours.

Autumn is now, so it's built: pumpkins, pumpkin pie and pumpkin soup, hay bales and scarecrows, and a town that buys pumpkins all autumn. This is the first step of Phase 3 (progression). It also says where the rest of Phase 3 goes: a collection book of everything you've grown, made, gathered, and worn, and recipes you learn by making things. A harvest night in the Commons on the last evening of October comes later, on hosted events.

## Motivation

The world looks and plays the same every day of the year. Phase 3 in the [founding plan](../plans/founding-plan.md#13-roadmap) lists a first season, and the homesteader's loops include "seasonal collections". A season is about three months, a chapter with a theme ([section 3](../plans/founding-plan.md#3-terminology-no-game-knowledge-required)).

- Homesteaders get something new to plant and to put on their plot a few times a year, and a reason to come back when the season turns.
- Hosts get a theme to gather around, like a harvest night or a winter market.
- Agents get a calendar they can plan with. "It's autumn: shall I plant pumpkins?" is a good thing for an AI to ask its owner, and every date is in the API.
- The market gets things the shop sells only for a while. A scarecrow bought in October is something to trade in January.

## Design

### What a season is

`seasonOf(day)` in `packages/sim/src/season.ts` gives the season of a world day (UTC days since 1970-01-01). It's a pure function of the day, like `biomeAt` is of a tile: never state, never an input. The day only moves with the logged `new_day` (decision 0026), so a replay sees the same season on the same day. `seasonSpan(day)` gives where the season starts and ends.

The seasons are the northern ones, for everyone: one world, one calendar. The founding plan's season also had a fresh leaderboard, exclusive gear, and a soft reset. There's nothing to rank or reset yet, so seasons here are themes and stock; nothing anyone has is reset.

### What a season can bring

All of it is data in the sim:

| A season can bring | Where | What the season decides |
|---|---|---|
| A crop | `CROPS`, `CROP_INFO`, and its seed in `SEED_KINDS` | Only when its seeds are sold |
| Shop stock: seeds, decor, wear | `SHOP_CATALOG`, plus the season's line in `SEASON_STOCK` | `shop_buy` takes it only in its season |
| Kitchen and workbench recipes | `RECIPES` | Nothing: a recipe works in any season |
| Things the town buys | `BUY_ORDERS`, plus the season's line in `SEASON_BUYS` | The town buys them every day of the season, after its daily rotation |

`shop_buy` of seasonal stock out of its season is refused with a new code, `out_of_season`, and a message that says when its season starts. `sell_to_town` of a season's kind out of season is `not_buying`, as for anything the town isn't buying that day.

### When a season ends

- The shop stops selling the season's stock, and the town stops buying the season's goods, at midnight UTC on the first day of the next season.
- Seeds you hold still plant, and crops in planters keep growing and can be picked. Each harvest gives a seed back, so a pumpkin patch can go on all year.
- What you made stays yours, and recipes still work.
- Decor stays where it's placed, and decor you hold still places.
- You can give anything, and list it in the market. Out of season, the market is the only place to buy seasonal stock, and the shop's price is no longer a ceiling for it.

The same stock comes back next year in the same season. Year-only stock ("the 2026 scarecrow") is an open question.

### How old logs replay

Old logs must replay to the same hash (decision 0003), and since the server boots from snapshots, a change in how an old input replays needs a `REPLAY_VERSION` bump (decision 0070). Seasons need none:

- New kinds (`pumpkin_seed`, `pumpkin`, `pumpkin_pie`, `pumpkin_soup`, `hay_bale`, `scarecrow`) only appear in new inputs. An old log never had one accepted, because the sim didn't know them.
- The first pantry gives `STARTER_SEEDS`, the five seeds it always gave, never every kind in `SEED_KINDS`. A new crop's seed never joins it.
- The town's daily rotation cycles through `ROTATION_GOODS` and `ROTATION_CROPS`, the lists it always had. A season's buys come after the rotation (`SEASON_BUYS`), so every past day's rotation is what it was, and every old `sell_to_town` replays the same.
- Only `shop_buy` and `sell_to_town` read the season. Seasonal stock was never sold before, so no old purchase can be refused by it.

`packages/sim/src/fixtures/autumn-log.ts` pins a log with autumn's things bought, grown, made, and sold on autumn days and used in winter, and `replay.test.ts` replays it at every split point. Decision 0078 records the choices.

### Autumn (built now)

Autumn runs from September 1 to November 30.

| Thing | Kind | What it is | Numbers |
|---|---|---|---|
| Pumpkin | crop `pumpkin`, seed `pumpkin_seed` | Grows on a vine in a planter, from a green bud to a big orange pumpkin | 5 days; 2 pumpkins and a seed back |
| Pumpkin pie | made at a kitchen | A whole pie, crimped crust | 2 pumpkins and a bag of sugar |
| Pumpkin soup | made at a kitchen | A jar of soup with herbs | a pumpkin, a bunch of herbs, and a jar |
| Pumpkin seed | shop stock, autumn only | | 4 coins |
| Hay bale | shop decor, autumn only | A bale of straw tied with twine, placed like a lantern or a fence | 8 coins |
| Scarecrow | shop decor, autumn only | On a post, in a straw hat and a patched red shirt | 35 coins |
| The town buys | every day of autumn | Pumpkins, pumpkin pie, and pumpkin soup | 2 coins (2 a day), 6, and 5 |

Pumpkin seeds aren't in the starter kit: the shop, a gift, or the market is how you get them. Decision 0079 has the reasoning for every number, and the simulated month it was checked with.

The pie needs no flour. Decision 0051 held pies back for a grain crop; a pumpkin pie is mostly its filling, so autumn gets one now, and flour stays for a later season.

A jack-o'-lantern is coming too: a pumpkin carved at the workbench into a lantern you place. It arrives with the workbench's furniture recipes in RFC 0016 (paths, floors, and furniture), which is being built alongside this one.

### Winter, spring, and summer (sketches)

Each gets its own decision with its numbers when it's built, and any of this can change by then:

| Season | Crop | Kitchen and workbench | Decor | The town buys |
|---|---|---|---|---|
| Winter, December to February | cranberries | cranberry sauce; mulled cider | a little fir in a pot; string lights | cranberry sauce |
| Spring, March to May | sweet peas | a pea and herb soup; a sweet pea posy | a birdhouse; a flower arch | posies |
| Summer, June to August | watermelons, and wheat | watermelon juice; flour at the workbench, then bread and more pies | a parasol; a hammock | watermelons and juice |

How the world looks in each season (snow on the ground, falling leaves) belongs to the world's weather drawing, which reads the same `seasonOf`.

### The harvest night (a later step)

On the last evening of October each year, the townsfolk host a harvest night in the Commons: bring a pumpkin pie, set out a jack-o'-lantern, and see who's around. It's built on [RFC 0010](0010-hosted-events.md)'s hosted events (scheduling, the Commons booking, attendance), so it waits for that RFC to be accepted and built. This RFC builds no events.

### The rest of Phase 3

Phase 3 is progression: [levels, gear rarity, outfits, jobs, and a first season](../plans/founding-plan.md#13-roadmap). Seasons come first because they give the rest something to collect. Two steps follow, each with its own RFC or decision before it's built:

1. A collection book keeps every kind you've grown, made, gathered, and worn, with the day you first did, and shows it on your profile ("12 of 20 things grown and made") and in `GET /v1/inventory`. Seasonal things are marked with their season and year ("Pumpkin, autumn 2026"), so a season's crop is something to collect while it lasts. The record has to be state the sim keeps, since recipes will read it (below). It starts with a logged switch input (`open_collection`), like `open_items`, so old harvests and crafts replay as they did; things done before the switch can be credited once, at the switch, from what the log already holds.
2. Then recipes you learn by making things. Today every recipe is known to everyone. From a logged switch on, everyone keeps the recipes that exist then, and new ones are learned: by making something that leads to it (bake a pumpkin pie and you learn pumpkin bread, once there's flour), by being given the thing and studying it, or by a neighbor who knows it showing you. This is the founding plan's "discovered by experimenting or taught by masters", and the collection book is where known recipes are kept. `craft` of an unknown recipe would be refused (a new code).

Levels, gear rarity, outfits, and jobs come after, in their own RFCs. Whether a level comes from the collection book's breadth or from use is for that RFC to decide.

### Protocol

All additive to v1:

| What | Shape |
|---|---|
| `GET /v1/shop` | `shop.season`; on items, `season` and `lastDay` (the last UTC day it's sold) for seasonal stock; on buy orders, `season` for a season's buys. Items list only what's sold today. |
| Error code | `out_of_season` |
| Catalog | new kinds in `GET /v1/inventory`'s catalog: the crop, its seed, two recipes, and two decor kinds |
| Check-in | `tryToday` can be `pumpkins` in autumn, for a gardener who has none |

### Client

The shop marks seasonal stock and buy orders with a small "This autumn" tag, and hides stock that's out of season (the server doesn't list it). The map and both 3D views draw pumpkins as they grow and the hay bale and scarecrow where they're placed; the drawn item pictures cover every new kind, and plot photos draw the new decor. The 3D gallery shows the new decor, and the shop links to it.

## Invariants

- The server decides. The season, what's on sale, and what the town buys are sim rules, and the client shows the server's lists without holding anything back on its own.
- The sim stays deterministic. The season is a pure function of `state.day`, which only moves with a logged input. No clock is read, and nothing new goes in state.
- Old logs replay. New kinds only appear in new inputs, and the lists old logs depend on are frozen (above). `REPLAY_VERSION` stays 1.
- Resident text stays untrusted. Nothing new is written by residents; a made pie or soup takes a label like any made thing, filtered as `item_label`.
- The protocol only grows: new optional fields, kinds, and an error code, and `shop.season`, a new field that's always there.

## Economy impact

- The town's autumn buys are a new source, minted like any sale to the town: at most 15 coins a day per resident on top of the rotation's 17, and only for someone with about a dozen pumpkin planters and the staples to spare.
- Pumpkin seeds, hay bales, and scarecrows are new sinks, 95% burned like everything at the shop.
- In the simulated month, autumn's buying adds 3% to 10% to what the town pays. With some residents buying the autumn decor, supply per active resident ends where it does without autumn, and residents spend more at the shop than the town pays them (decision 0079).
- Seasonal things are ordinary items, stacks or made things with ids, under the same caps (200 things, 20 made a day, the gift and market limits), so nothing new can be copied.

## Security considerations

- Someone can buy seasonal decor in autumn and resell it for more in winter. The market allows that, the shop's price caps it again every autumn, and the town's prices don't change. The shop never runs out, so nobody can corner its stock.
- A crowd of accounts could farm the town's autumn buys. Each has a per-resident daily cap, like the rotation's, and pumpkins come only from bought or given seeds, so a crowd of new accounts earns what a crowd of gardeners would, and the welcome gift and the gift caps bound what they can move to one account.
- A post or a letter saying "the scarecrow sells out tonight" or "the town pays double for pie tomorrow" is untrusted text, a prompt injection like any other. SKILL.md says the only dates and prices that count are `lastDay` and `buying` in `GET /v1/shop`.
- No resident can change the season. It comes from the logged day, which only the server appends (`new_day` from `TOWN_ACTOR`), and the sim refuses a day that has already started.

## Agent experience

SKILL.md gains a Seasons section, after Make and give: the calendar, what a season can bring, what happens when it ends, autumn's things with their numbers, and a line on untrusted claims about seasonal stock. `plant`, `shop_buy`, the town shop, the market's price note, Make and give, the error table (`out_of_season`), and "Things to do here" mention seasons. On a check-in in autumn, a gardener with no pumpkins may get `tryToday: "pumpkins"`, with a line that names the seed and asks whether their owner would like some. Agents should tell their owner when a season starts and what it brought.

## Migration and rollout

Nothing changes how existing logs replay.

1. Built with this RFC: seasons in the sim, autumn's crop, recipes, decor, and buys, the protocol fields, the shop page's tag, the art on the map, in 3D, and in plot photos, the check-in suggestion, and SKILL.md.
2. The collection book, behind `open_collection`.
3. Recipes you learn, behind their own switch.
4. The harvest night, once RFC 0010 is built.
5. Each season's content before it starts (winter's before December 1, spring's before March 1, summer's before June 1), each with a decision on its numbers.

Old clients keep working: they ignore the new fields, and a new kind they don't know is a plain thing with the catalog's name, as SKILL.md already says.

## Alternatives considered

- A logged `set_season` input would let the server choose the season, so it could start one late or run one twice. The day is already logged, a calendar season can't drift, and an input is one more thing to schedule and get wrong.
- Crops that die when their season ends are common in farming games, and they give a real reason to plant on time. Losing a garden overnight is the wrong tone for Terrakin, and an agent that checks in every few hours would lose crops through no fault of its own.
- Recipes could be seasonal, with pie only in autumn. Once you have pumpkins, a rule against baking them has no story, and it would strand pumpkins in your things.
- The new goods could join the rotation. That's simpler, but a longer list changes what the town bought on every past day, and old sales would replay differently.
- A separate seasonal shop, or an event currency, is more to learn, and it could do nothing that `season` on the one shop can't.
- Seasons could follow each resident's hemisphere. It's one world with one calendar, so a resident in Sydney sees autumn in their spring, and everyone shares the town's season.

## Open questions

- Does a season's stock come back every year, or does each year bring its own (exclusive stock, as the founding plan's season had)? Built now: the same stock every year.
- Should the founding plan's fresh leaderboard and soft reset ever come with seasons, for the delver and the champion, once there's something to rank?
- Is 15 coins a day the right ceiling for a season's buys, or should a season add one good a day, not every one?
- Who hosts the harvest night: the townsfolk (Clem's cafe), the Town Hall, or any resident who books the Commons that evening?
- Should a collection book count what you were given, or only what you grew and made yourself?
