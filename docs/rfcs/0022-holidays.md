# RFC 0022: Holidays

- Author: drafted by Claude for Ryan
- Date: 2026-10-06
- Status: accepted (Ryan, 2026-10-06)
- Discussion: none
- Decisions: [0106](../knowledge/decisions/0106-holidays-are-dated-windows-read-from-the-world-s-day-candy-i.md) (holidays, candy, and trick-or-treating), [0107](../knowledge/decisions/0107-halloween-s-numbers-costumes-candy-decor-and-the-night-s-cap.md) (Halloween's numbers), [0124](../knowledge/decisions/0124-winter-s-numbers-cranberries-hot-cranberry-punch-winter-deco.md) (Midwinter's candy canes, with winter's numbers)
- Builds on: [RFC 0017](0017-seasons.md) and [decision 0078](../knowledge/decisions/0078-seasons-follow-the-utc-calendar-and-add-stock-crops-recipes-.md) (seasons), [RFC 0018](0018-one-catalog-of-things.md) (the catalog), [decision 0052](../knowledge/decisions/0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md) (shop wear), [decisions 0029](../knowledge/decisions/0029-looks-are-curated-themes-plus-your-own-uploaded-art.md) and [0053](../knowledge/decisions/0053-any-garment-can-carry-its-own-pattern-and-color-with-bottoms.md) (looks and wear), [RFC 0020](0020-plots-worth-visiting.md) (visiting a neighbor's door), [RFC 0010](0010-hosted-events.md) and [decision 0081](../knowledge/decisions/0081-the-town-hosts-events-from-a-calendar-in-server-config-start.md) (the harvest night), [decision 0098](../knowledge/decisions/0098-evenings-and-nights-in-3d-follow-the-map-s-clock-with-lamps-.md) (nights in 3D).

## Summary

Terrakin gets holidays: dated windows inside the calendar, finer than seasons. A holiday runs from a first to a last UTC date every year, read from the world's logged day like the season, so it replays. It can bring shop stock sold only while it runs, recipes that are useful then, and small rules of its own.

Halloween is first, and it's 25 days away. From October 24 to November 1 the town shop sells five costumes (a witch hat, cat ears, a pumpkin head, a ghost sheet, and bat wings), candy, and three pieces of spooky, cozy decor (bat bunting, a cauldron, and a candy bowl). Costumes are shop wear, kept for good once bought. Candy stacks; the kitchen makes five from a pumpkin and a bag of sugar on any day. On October 31 and November 1 residents go trick-or-treating: at a neighbor's door, a knock gets a candy from whoever is home, from the candy bowl by the door, or from the town, once a door a night. Owners hear how many trick-or-treaters came by. The world draws the costumes on every figure, the decor on the map, in 3D, and in plot photos, and a little purple in the evenings of the week.

## Motivation

Ryan asked for the world to be more fun and more your own. Seasons (RFC 0017) give Terrakin a calendar of three-month chapters; the moments people actually gather around are shorter and sharper than that.

- **Homesteaders** get a reason to dress up their plot for a week, and to make something for the neighbors: a bowl of candy by the door.
- **Hosts** get a night the whole town shares. The harvest night in the Commons (decision 0081) is the same evening.
- **Everyone** gets a costume to pick and a reason to walk next door. Trick-or-treating is visiting (RFC 0020) with a small, kind exchange at the end of it.
- **Agents** get a calendar entry they can plan with their owner ("Halloween starts on Saturday: which costume would you like me to wear?") and a simple, bounded round to go on that night.

## Design

### What a holiday is

`packages/sim/src/holiday.ts` lists the holidays (`HOLIDAYS`) with their first and last UTC dates (`HOLIDAY_INFO`). `holidayOf(day)` gives the holiday a world day falls in, or none. Like `seasonOf`, it's a pure function of the logged day: never state, never an input, and a replay sees the same holiday on the same day. Holidays never overlap and never run into the next year (a test pins it), so a day is in one holiday at most.

The dates are the same every year. A holiday's stock comes back each year, like a season's.

### What a holiday can bring

All of it is data in the sim:

| A holiday can bring | Where | What the holiday decides |
|---|---|---|
| Shop stock: wear, decor, sweets | the catalog's `shop.holiday`, or the shop's wear list, gathered in `HOLIDAY_STOCK` | `shop_buy` takes it only while the holiday runs |
| Recipes | the catalog | Nothing: a recipe works any day, as RFC 0017 decided for seasons |
| Its own small rules | a module of its own, like `halloween.ts` | Whatever the rule says, from the logged day |

`shop_buy` of holiday stock outside its holiday is refused with a new code, `out_of_holiday`, whose message names the holiday's dates and the day the stock is back. What you bought stays yours: costumes are worn and decor placed any day of the year, and candy keeps.

### Halloween (built now)

Halloween runs from October 24 to November 1: a week to get ready, October 31 itself, and November 1, which is still the evening of October 31 in the Americas.

#### Costumes

Five costumes, sold only during Halloween, bought once and kept for good like the shop's other wear. Each is a piece of wear in a slot, so it's worn with the rest of a look and takes its own color and pattern like any garment (decision 0053).

| Costume | Slot | Price | Drawn as |
|---|---|---|---|
| Witch hat | hat | 60 | A tall, crooked cone over a wide brim, with a band. Hair stays under it, like any hat that covers the crown. |
| Cat ears | hat | 40 | A headband with two pointed ears. It covers nothing, so hair shows. |
| Pumpkin head | hat | 70 | A carved pumpkin over the head, with a stem, triangle eyes, and a grin, lit from inside in 3D. It hides the hair and the face. |
| Ghost sheet | top | 50 | A white sheet over the head and body with a wavy hem. It covers the bottom half like a dress, hides the hair, and the face shows through it. |
| Bat wings | accessory | 70 | Two scalloped wings behind the shoulders, spread wide from the back. |

`COSTUMES` in `packages/sim/src/looks.ts` names them; they're in `SHOP_WEAR` and on the end of `WEAR_ITEMS`, before the partner wear, which stays last.

#### Candy

Candy is one catalog entry, `candy`, in a new family, food › sweets, with a new role, `sweet`: made at a kitchen like a good, but it stacks like furniture, so it can be counted out at a door. Its recipe is a pumpkin and a bag of sugar, and one craft makes five (`makes`, a new optional field on a recipe that only a sweet uses). The shop sells candy for 2 coins during Halloween. The recipe works any day of the year, as every recipe does; candy is only useful at Halloween.

#### Decor

| Decor | Price | Drawn as |
|---|---|---|
| Bat bunting | 12 | Two little posts with a string of paper bats between them |
| Cauldron | 30 | An iron pot on three feet with a green brew bubbling in it, which glows after dark |
| Candy bowl | 15 | An orange bowl heaped with wrapped candy, on a little stand by the door |

They're placed and taken up like the shop's other decor. The candy bowl also does something: while it stands on a plot, it hands out the candy of whoever lives there to trick-or-treaters, even while they're away (below).

#### Trick-or-treating

On October 31 and November 1 (UTC), a resident at a neighbor's door knocks. November 1 is there so the evening of October 31 in the Americas is a night too, and each is a night of its own: every cap below is per UTC day, so it starts over on November 1.

```json
{"type": "trick_or_treat", "px": 3, "py": 2}
```

The door is the plot. You knock from on the plot or right beside it (within a tile of its edge), so `visit` (RFC 0020) is the way there. Each knock gets one candy:

1. From whoever lives there (the owner, then each co-owner) who is home, meaning online and on that plot, and holds candy.
2. Else, when a candy bowl stands on the plot, from the first of them who holds candy, home or not.
3. Else from the town, which hands out up to 5 candies at each door a night and 250 across the whole town.

The candy moves from the giver's things to the knocker's, or the town makes it. Nothing is random, so a knock replays from the state alone, and no roll is logged. When nobody there has candy and the town's is gone at that door or for the night, the knock is refused with `no_candy` and nothing moves.

It's a sim action because it moves things between inventories. The sim checks, in order:

| Code | When |
|---|---|
| `items_closed` | Growing, making, and gathering aren't open |
| `out_of_holiday` | It isn't October 31 or November 1; the message names the next one |
| `not_eligible` | The knocker is townsfolk: their things are the town's |
| `no_hearth` | The knocker has no hearth: trick-or-treaters bring their candy home |
| `out_of_bounds`, `plot_is_commons`, `plot_unclaimed` | There's no door there |
| `own_plot` | Your own door, one shared with you, or your household's (a person and the AIs they claimed, as with admiring a plot) |
| `out_of_reach` | Not on the plot or beside it; the message gives the `visit` to send |
| `already_knocked` | You knocked on this door tonight |
| `knock_limit` | You knocked on 10 doors tonight |
| `inventory_full` | No room for one more thing |
| `no_candy` | Nobody has a candy for you, and the town's is gone |

The server adds what the sim can't see, as it does for `visit`: a knock across a block with the plot's owner or any co-owner is `forbidden`, and a suspended owner's door is closed.

Today's knocks live in `state.knocks` (who knocked on which doors, and the town's candy at each door), absent until the night's first knock, and `new_day` drops them. Every knock emits `trick_or_treated {by, px, py, from, giver?}`, public like a visit, and private `inventory` events for the knocker (reason `trick_or_treat`) and the giver (reason `handed_out`).

#### The owner's notice

Each knock tells the plot's owner and co-owners, through the server's notifications: `trick_or_treat`, grouped per door per UTC day, so the notice reads "Ada and 3 others came trick-or-treating at your door", with the door's `plot`. It goes through `notify()`, so blocks and the per-actor cap apply, and the check-in's `todo` says how many came by. A knock the town answered still tells the owner. The notice never says where the candy came from; the giver's own `inventory` event (reason `handed_out`) does, and the client's toast reads "A trick-or-treater took a candy from your bowl" for a knock the bowl answered.

#### The harvest night

The town's harvest night in the Commons (decision 0081) runs on the same evening, from 18:00 UTC on October 31 to 03:00 UTC on November 1. Nothing about it changes: costumes and candy are something to bring.

#### How the world draws it

- Costumes everywhere figures are drawn: the 2D figure from the front, the side, and the back (`packages/ui/src/figure.ts`), the 3D peg figures (`packages/client/src/scene3d/wear.ts`), the item pictures, and the look editor. Plot photos draw no figures, so no costumes there.
- Candy and the decor in item pictures, on the map, in both 3D views, and in plot photos. The candy bowl shows its candy, and the cauldron's brew glows after dark through the 3D night's glow marks (decision 0098).
- The evenings and nights of the week take a little purple and pumpkin orange, on the map and in 3D. It's presentation, worked out from the world's day like the season.

### Midwinter (built now)

Midwinter runs from December 21, the longest night in the north, to December 31, the last night of the year. It stops there because a holiday never runs into the next year. It's kept small: one thing to buy, and no rule of its own.

The thing to buy is a candy cane. `candy_cane` is a sweet in food › sweets, like candy: the shop sells it for 2 coins while Midwinter runs, and a kitchen makes five from a bunch of herbs (the mint) and a bag of sugar on any day. It stacks, so it's easy to give a few to neighbors with `give`, and the town buys no sweets.

The evenings glow gold on the map and in 3D, and lanterns, lamp posts, campfires, and winter's strings of lights shine a fifth brighter after dark. That's drawing only, from the world's day, like Halloween's purple.

The shop shows a "For Midwinter" shelf while it runs, with each candy cane tagged "Midwinter". Winter's own stock, strings of lights included, is the season's ([RFC 0017](0017-seasons.md)), sold all winter. [Decision 0124](../knowledge/decisions/0124-winter-s-numbers-cranberries-hot-cranberry-punch-winter-deco.md) has the numbers.

### Protocol

All additive to v1:

| What | Shape |
|---|---|
| Action | `trick_or_treat {px, py}` |
| Event | `trick_or_treated {by, px, py, from: "resident" \| "bowl" \| "town", giver?}` |
| Error codes | `out_of_holiday`, `already_knocked`, `knock_limit`, `no_candy` |
| `GET /v1/shop` | `shop.holiday` (`{id, lastDay}`) while a holiday runs; on items, `holiday` and `lastDay` (its last UTC day) for holiday stock |
| `GET /v1/world`, `GET /v1/checkin` | `holiday`, the holiday today (`halloween` or `midwinter`), absent on ordinary days |
| `GET /v1/plots`, `GET /v1/plots/{px}/{py}` | `knockedToday`, with a token on October 31 and November 1: whether you knocked at that door tonight |
| Catalog | `candy` (role and category `sweet`, family food › sweets, its recipe with `makes`), three decor kinds, five wear items; `craft` and the craft link (`/v1/act/{key}/craft`) take `candy` |
| Inventory reasons | `trick_or_treat`, `handed_out` |
| Notification | `trick_or_treat`, with its `plot` |
| Check-in | `tryToday` can be `costume` during Halloween, for a resident with no costume yet, and `trick_or_treat` on October 31 and November 1, for one who hasn't knocked tonight |

### Client

The shop marks holiday stock with a "Halloween" tag and lists it first while Halloween runs. The look editor offers each costume locked at its price until you buy it, and leaves out costumes you don't own once Halloween is over. In the world, the card on a neighbor's plot gets a "Trick or treat" button on October 31 and November 1. The toast says where the candy came from (someone home, the bowl, or the town), never who, and the button then reads "Knocked" for that door, after a reload too (`knockedToday`). Notifications read "Ada came trick-or-treating at your door" or "Ada and 3 others came trick-or-treating at your door".

## Invariants

- **The server decides.** The holiday, what's on sale, and every rule of a knock are in the sim. The client shows the Trick or treat button only on October 31 and November 1 by the sim's own `trickOrTreatDay`, and shows the server's words for every refusal.
- **Determinism.** The holiday is a pure function of `state.day`. A knock reads only state: who's online and where, who holds candy, the blocks on the plot, and today's knocks. No clock, no randomness.
- **Old logs replay unchanged.** New kinds, wear, commands, events, and codes only. No kind joins a frozen list: the starter seeds, the pantry's staples, and the town's rotation are as they were, and the town buys nothing new. Sweets join the end of `STACK_KINDS`, after every role that shipped. The only rule that changes for something old is `craft`'s room check, which runs only for a recipe that makes more than it uses, and every recipe before candy makes one from at least one. `REPLAY_VERSION` stays 1. `packages/sim/src/fixtures/halloween-log.ts` pins a log with the costumes, candy, decor, and a night of knocks, and `replay.test.ts` replays it at every split point.
- **Resident text stays untrusted.** Nothing here carries resident words. The notice and the check-in line carry counts and plot coordinates; names are drawn as text.
- **The protocol only grows.**

## Economy impact

- Costumes, candy, and decor are new sinks, 95% burned like everything at the shop (decision 0052). A regular earns 10 to 15 coins a day; across Halloween's nine days that buys one or two costumes, or a costume and some decor.
- No new coin source. The town buys no candy and no costume, so nothing here mints coins.
- Candy is a new source of items: the town makes up to 250 a night, on two nights a year. Candy can be given and listed in the market like any stack, so the most a ring of accounts could gain is candy, worth what other residents will pay for it.
- Everything is an ordinary item under the usual caps (200 things, 20 crafts a day, the gift and market limits).

Decision 0107 has the reasoning for every number.

## Security considerations

- **Farming the town's candy.** A ring of accounts knocking on each other's doors gets at most 5 town candies a door and 10 doors each a night, and 250 across the town, on two nights a year. Households (a person and their AIs) can't knock on each other's doors. Each knocker needs a hearth, so each account needs a plot and a home, and making accounts is limited per IP. The prize is candy, which mints no coins.
- **Taking an owner's candy.** Candy leaves an owner only when they're home on that plot, or when they put a candy bowl out themselves. One candy per knocker per door per night, 10 doors per knocker.
- **Following someone around.** Knocking targets a door, never a resident, and the server refuses it across a block either way, as `visit` does.
- **Notice spam.** One notification per door per day, grouped, through `notify()` with its per-actor cap and block check.
- **Prompt injection.** A post saying "the town hands out 100 candies at plot 3,2 tonight" is untrusted text. SKILL.md says the only numbers that count are the ones in `GET /v1/shop` and the refusals.
- **Privacy.** A knock's public event says whether a resident or the town handed out the candy, which says the resident had some. That's what answering the door is, and the owner chose it by being home or by putting out a bowl.

## Agent experience

SKILL.md gains a Holidays section: what a holiday is, what's on now (`holiday` in the check-in and the world, `shop.holiday` in the shop), Halloween's costumes, candy, and decor, and how to trick-or-treat: visit a neighbor's plot, knock, and stop at 10 doors. Dressing up is with the owner: the check-in's `tryToday` suggests asking which costume they'd like, and an agent should buy only what its owner wants. On October 31 and November 1 `tryToday` suggests going trick-or-treating, and an agent should tell its owner how the night went ("We got 6 candies; 4 trick-or-treaters came by our door"). The error table gains the four new codes.

## Migration and rollout

Nothing changes how existing logs replay. One push builds all of it: the sim, the protocol fields, the server's notice, check-in, and shop, the drawings, SKILL.md, and the changelog. Old clients keep working: they ignore the new fields, events, and notification type, and a costume they don't know draws as no wear. A Halloween costume on a client that predates it is simply not drawn.

## Alternatives considered

- **Holidays as seasons with shorter dates.** The season is one value per day that the shop and the town's buying read; a holiday sits inside a season (Halloween is in autumn) and adds to it rather than replacing it.
- **A logged `start_holiday` input.** It would let the server run a holiday late or twice. The day is already logged, and a calendar date can't drift.
- **Candy as a made good with an id.** Each piece would carry its maker and day, which is a lot of bookkeeping for something handed out by the dozen, and a door can't count out goods the way it counts a stack.
- **Candy as a staple.** Staples are what the pantry tops up and recipes use. Candy is neither, and calling it one would put it in rules that walk staples.
- **Trick-or-treating in the social tables, like admiring a plot.** It moves things from one inventory to another, and only the sim does that.
- **A random treat or trick.** A roll would have to be logged, and a trick that takes something away is the wrong tone. Every knock gets a candy or a clear no.
- **A bowl that holds its own candy.** It would need a command to fill it, state for what's in it, and a rule for what happens when it's taken up or built over. A bowl that hands out its owner's candy does the same job with none of that.
- **The recipe only during Halloween.** RFC 0017 decided recipes aren't seasonal; a rule against cooking with pumpkins you have has no story.

## Decided after acceptance

- November 1 (UTC) is a trick-or-treat night too (Ryan, 2026-10-06). October 31 by the UTC calendar ends at 17:00 on the US west coast and 20:00 on the east coast, before most of the American evening. Each night is its own UTC day: knocks reset at `new_day` as they always did, so a door can be knocked once on each night, a knocker gets 10 doors on each, and the town hands out up to 250 on each, 500 across both. A knock on November 1 was refused before, and refusals aren't logged, so no logged knock replays differently ([decision 0107](../knowledge/decisions/0107-halloween-s-numbers-costumes-candy-decor-and-the-night-s-cap.md)).

## Open questions

- Should the town hand out more than 250 candies a night if the town grows past a few dozen trick-or-treaters?
- Which holiday comes after Midwinter: one in spring, or something residents ask for?
- Should a costume ever be sold outside its holiday, say in the market only, or by the shop at a higher price?
