# RFC 0047: Trades beyond the garden, and things that carry your mark

- Author: drafted by Claude for Ryan
- Date: 2026-10-22
- Status: draft
- Discussion: Ryan, 2026-10-22: "add some other things other than plants for ppl to do maybe make or grow other types of things to participate in their own unique way. want to introduce diversity and fun stuff maybe engineering and building with materials and stuff too ppl can brand and sell in their shops as unique special items with their twist"
- Builds on: [RFC 0018](0018-one-catalog-of-things.md) (the catalog and families), [RFC 0024](0024-recipes-you-learn.md) (recipes you learn and teach), [decision 0059](../knowledge/decisions/0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md) (made things on pedestals, admires, galleries), [RFC 0008](0008-coins-karma-and-the-market.md) phase 4 (the market), [RFC 0041](0041-materials-and-roofs.md) (made materials), [RFC 0023](0023-fishing.md) (the server's logged roll), [RFC 0042](0042-actions-that-need-you-there.md) (the counter), [RFC 0029](0029-levels-and-skills.md) and [RFC 0030](0030-jobs.md) (making points and jobs)

## Summary

Almost everything a resident makes today comes from the garden. The kitchen turns crops into jam and tea, the workbench turns flowers into bouquets and wood into chairs, and the town buys a rotating few of them. A resident who doesn't care for gardening has fishing, finds and furniture, and that's about it.

This RFC adds trades, each with its own station, its own inputs and its own kind of thing to make: a kiln for pottery, a loom for weaving, a forge for metal, and a tinker's bench for contraptions built from the other three's parts. It adds a way for a made thing to be visibly yours: a glaze or a pattern picked from what went into it, a finish the server rolls when it comes out, your mark stamped on it, and the label you already can write. And it gives a home a shop sign, so people can find "Moss's Pottery" on the map and on the market.

The first phase is one trade, the kiln, with no new text surface, no new coins and no change to the market. It is built from pieces that already exist: the planter's overnight wait, fishing's logged roll, and the pedestal.

## Motivation

The persona this serves first is the resident who has a hearth and nothing to come back for. The [plans](../plans/README.md#now-and-next) are clear that new systems wait behind getting people in and keeping them, so this RFC has to earn its place on the second half of that.

**What brings people back today is the garden.** A crop planted today is ready tomorrow, and the daily `home` pays coins. That is the loop the funnel can see working. Everything else made in Terrakin is instant: craft, and it's in your things. Nothing else says "come back tomorrow and see how it turned out."

**There is one way to be good at making.** Every maker in town makes the same lemon jam from the same recipe, and it looks the same whoever made it. A Good already keeps its maker and an optional label (`packages/sim/src/types.ts`, `Good`), but nothing about how it looks says whose it is. Ryan's ask is for things that are "unique special items with their twist", and the model has no twist in it.

**The personas have little to tell them apart.** [The vision](../vision.md) names four: homesteader, delver, host, champion, who "feed each other: delvers sell loot, homesteaders supply crafters". Today there is one craft economy and one set of inputs, so nobody supplies anybody.

**The market has almost nothing worth buying.** Read on 2026-10-19: 19 listings, one seller, no sale in eleven days. A neighbor can make every listing themselves from the same seeds. A teapot in a glaze you can't make, with a finish that came out one firing in a hundred, is a reason to buy from someone else. This RFC doesn't claim that fixes the market. It says the market has nothing distinct to sell yet, and this is the cheapest way to change that.

## Design

### The trades

Four trades, each a station you place on your own plot, each fed by something the town already has plus one new input. They are listed in the order they would be built.

| Trade | Station | New input | Also takes | Makes | Persona |
|-------|---------|-----------|------------|-------|---------|
| Pottery | `kiln`, 4 stone | `clay`, picked up on meadow and sand | a glaze from a crop or a find | bowls, vases, teapots | homesteader, host |
| Weaving | `loom`, 4 wood | `flax`, a new crop | a dye from a crop | `cloth`, throws, tapestries | homesteader |
| Smithing | `forge`, 6 stone | `ore`, picked up on stone ground far from town | `charcoal` from wood | `iron`, gears, trophies | delver |
| Tinkering | `tinkers_bench`, 4 wood | none | parts from the other three | windmills, water wheels, music boxes, lamps | champion, everyone |

A station costs its stone or wood when it goes down and gives it back when it comes up, the way a pond does ([decision 0122](../knowledge/decisions/0122-fishing-is-a-cast-beside-a-pond-dug-for-stone-rolled-and-sta.md), `blockNeeds` in `packages/sim/src/items.ts`). Stations belong on residents' own plots, as kitchens and workbenches do.

The point of the split is that each trade has a reason to need the others. A teapot is nicer on a woven cloth. A windmill needs sailcloth from the loom and a gear from the forge. Ore lies far out, so the person who walks there has something the person at home wants. That is the vision's "personas feed each other", done with things rather than coins.

Each persona gets something distinct:

- **Homesteader:** the kiln and the loom. Both sit by the garden, both take what it grows (glazes and dyes), and both have an overnight wait like a crop.
- **Delver:** the forge. Ore lies only on stone ground well away from downtown, so a forge is fed by the person who walks out for it, and the islands of [RFC 0038](0038-new-lands.md) are a natural place for it.
- **Host:** pottery and the shop sign. A teapot and cups on the table at your event, and a stall on your plot that brings people to it.
- **Champion:** tinkering, the longest recipe chains in the game, and the record of who built the first of each contraption in town. The forge also makes trophies a host can hand a game's winner.

### Pottery, the first trade

**Clay** lies on meadow and sand tiles, one at a time, like a fallen branch in a forest (`GATHER` in `packages/sim/src/gather.ts`). It grows back daily as a pure function of the tile and the day, and only on tiles where nothing else would lie, so no find and no recipe page moves. Like wood and stone, it earns no foraging points. It needs a logged switch, `open_clay`, because a `gather` with no tile picks up everything in reach, and a logged one from before clay existed must not pick it up on replay.

**The kiln** is a block placed for 4 stone. You load it with `craft`, exactly as you craft at a kitchen, and it fires overnight:

```json
{"type": "craft", "recipe": "teapot", "x": 18, "y": 22, "glaze": "sea", "label": "Sunday tea"}
```

The clay, the glaze's ingredient, and the craft count are taken now, and the making points are earned now ([RFC 0029](0029-levels-and-skills.md)). The pot is made now too, with its id, its maker and its label, but it sits in the kiln until the next world day. A kiln holds one pot at a time. While it fires, everyone sees the kiln glow, and nobody sees what's in it.

Next day you take it out with `harvest`, the same command that empties a planter:

```json
{"type": "harvest", "x": 18, "y": 22}
```

Reusing `harvest` is deliberate. "Harvest what's ready" is already in every agent's daily routine and every check-in's `todo`, so a kiln joins the loop people already have rather than starting a second one.

The kiln's state lives in `items.firings`, keyed by tile, next to `items.crops`:

```ts
interface Firing {
  good: Good;          // made at loading, with maker, label and glaze
  by: ResidentId;      // who loaded it; the pot goes back to them
  readyDay: number;    // loading day + 1
}
```

Anyone who can build on the plot may open the kiln, as with a planter, but the pot always goes to whoever loaded it, held aside if their things are full ([decision 0059](../knowledge/decisions/0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md)'s `heldAside`). So a co-owner can empty a kiln and a former co-owner can't pin one. A kiln with a pot in it can't be taken up.

**Three pots** to start:

| Pot | Needs | How you know it |
|-----|-------|-----------------|
| `bowl` | 2 clay | Everyone knows it once `open_clay` is logged |
| `vase` | 3 clay | A card, 20 coins by the existing rule (10 plus 3 a thing) |
| `teapot` | 4 clay, 1 wood | A card, 25 coins |

The cards follow [RFC 0024](0024-recipes-you-learn.md) unchanged, so they can be taught, and pottery gives teaching, which is unused so far, a reason to happen.

### Your own twist

Four things make a pot yours. Three are choices and one is luck. None of them is free text except the label, which already exists.

**A glaze, paid for with what you hold.** `glaze` is optional and picks from a short, fixed list. Each glaze costs one thing, so the color of a pot says something about where its maker walks and what they grow:

| Glaze | Costs | |
|-------|-------|---|
| `bare` | nothing | The default: warm unglazed clay |
| `cream` | 1 seashell | |
| `sea` | 1 sea glass | |
| `crystal` | 1 crystal | Clear, with a glint |
| `rose` | 1 flower | |
| `honey` | 1 lemon | |
| `berry` | 1 strawberry | |
| `moss` | 1 herb | |

Four come from the starter seeds, so every new gardener can glaze on day one, and three come from finds, so a forager's pots look different from a gardener's. Like materials, it is a curated set: [RFC 0041](0041-materials-and-roofs.md) already turned down free colors, and the same reasoning holds.

**A finish, rolled when the kiln opens.** Real kilns are a little unpredictable, and that is the fun of opening one. The server draws a roll when it logs a `harvest` at a kiln, the way it draws a cast's roll for fishing: a whole number below 10,000 from Web Crypto, logged with the input, read by the sim through a frozen table.

```ts
export const FINISHES = [
  { finish: "speckled", chance: 1500 },
  { finish: "crackle", chance: 500 },
  { finish: "iridescent", chance: 100 },
] as const;  // past them all: plain
```

So about one pot in five comes out with something, and about one in a hundred shines. A dry run says the kiln is ready and draws nothing. Nobody can know a finish before the `harvest` is logged, and leaving a pot in longer changes nothing. The finish is set on the Good and never changes.

**A label,** as today: up to 40 characters, untrusted, filtered as `item_label` by the server before it's logged.

**A mark,** in phase 2 (below).

What a pot looks like is a pure function of those fields: one drawn template per pot, recolored by its glaze, with the finish drawn over it. That keeps the art cost to three drawings and a few overlays, not three times eight times four.

A Good gains optional fields, absent on everything made before:

```ts
interface Good {
  // ...as today: id, kind, maker, madeDay, label?, media?, model?, admired?
  glaze?: Glaze;
  finish?: Finish;
  mark?: Mark;
}
```

Pots are made things, so everything built for made things works on them unchanged: a pedestal or a frame, admires (which feed the maker's karma), galleries, `give`, `list_item`, reports and takedowns.

**Variants from the other trades** follow the same shape. The loom's `pattern` picks from the patterns garments already use (`PATTERNS` in `packages/sim/src/looks.ts`), with its colors from the dyes that went in. A music box's tune picks from a short list of tunes made with code ([decision 0097](../knowledge/decisions/0097-the-world-s-sound-is-made-with-code-off-until-the-speaker-is.md)). Every choice is an enum, and every rolled thing is a server roll in the log.

### Selling it as yours

Phase 2. This part waits until phase 1 shows people make pots at all.

**Your mark.** `set_mark {shape, color}` sets a maker's mark on the resident: one of about a dozen drawn shapes (acorn, leaf, star, moon, fish, key, wave, bee, sun, knot, heart, crown) in one of the resident colors. Every Good you make from then on carries it, stamped at making, so changing your mark later doesn't restamp what's already out in the world, the way a real potter's old work keeps its old stamp. It can change once a UTC week. Marks aren't unique: there are only so many shapes, and the maker's name always shows beside the mark, so the name is the identity and the mark is the look.

**A shop sign.** `set_shop {px, py, open}` is a plot flag, like `set_gallery`. The shop's name is the plot's name, "Moss's Pottery", which already exists, is already filtered, and can only change once a day ([decision 0121](../knowledge/decisions/0121-a-plot-s-name-lives-on-the-plot-in-the-sim-set-by-its-reside.md)). An open shop needs a named plot. A `stall` block on the plot, free like a pedestal, draws up to six of your open listings as their real pictures, glaze, finish, mark and all.

`GET /v1/shops` lists plots with an open shop: the name, the owner, the mark, how many listings. `GET /v1/market` gains a `maker` filter beside `seller`, because a teapot resold by someone else is still Moss's teapot.

**How it fits the market.** Nothing about escrow or fees changes. A stall shows listings; it doesn't hold anything. A listing still leaves your things into escrow, still costs 1 coin to list (burned), and a sale still pays the seller less 5% to the treasury ([decision 0056](../knowledge/decisions/0056-the-market-holds-listings-in-escrow-in-the-sim-burns-a-listi.md)).

**In person.** [RFC 0042](0042-actions-that-need-you-there.md) left the market asynchronous on purpose and said a physical market "needs a market building first, which is its own RFC". A home stall is a smaller step and keeps that decision: `buy_listing` still works from anywhere. What the walk gives you is the thing itself, drawn on the map with its finish, and the maker's home around it. The stall gives no discount and no perk for being there in person, because that would make the remote market worse for everyone who can't walk over. Whether it should is an open question.

**A job.** A new edition of the jobs table ([RFC 0030](0030-jobs.md)) adds pottery to a townsfolk's lane: Clem asks for a bowl for the kitchen. A job hand-in takes the thing out of the world, so it is a sink with no coins.

### Engineering: contraptions

Phases 4 and 5. A contraption is built at the tinker's bench from parts the other trades make: a windmill takes wood, sailcloth (the loom) and a gear (the forge); a water wheel takes wood and two gears; a music box takes wood, a gear and a tune; a lamp takes iron and glass.

**It stands on display on its own tile.** A contraption is a Good, so it keeps its maker, mark and label. Placing one is `display {item, x, y}` on an empty tile of your plot with no pedestal under it: the tile's block becomes the contraption's kind, and `items.displays` holds the thing, exactly as it holds a pot on a pedestal. `take_down` gives it back, admires count, a gallery lists it, and staff take one down with the existing route. No new placement mechanic is needed.

**Everything it does is drawing.** No rule reads a contraption, so none of this touches replay:

- A **windmill**'s sails turn, faster in rain and slower in fog. Weather is already a pure function of the day and the hour ([decision 0073](../knowledge/decisions/0073-weather-is-a-pure-function-of-the-world-day-and-the-utc-hour.md)).
- A **water wheel** turns when there is water beside it, read with the sim's own `waterBeside`, and stands still on dry ground. So it wants a pond, and a pond wants stone.
- A **lamp** lights at dusk and goes out at dawn, by the map's clock (`timeOfDayAt`), with the glow evenings already draw ([decision 0098](../knowledge/decisions/0098-evenings-and-nights-in-3d-follow-the-map-s-clock-with-lamps-.md)).
- A **music box** plays its tune when you stand next to it, once sound is on.

**The first of each, in town.** The first resident to build each contraption kind is a fact in the log, so a profile can show "built the first water wheel in Terrakin" and nobody can take it away. That is the champion's angle: a short race with a permanent record, not a ladder.

A contraption that changes a rule (a water wheel beside a loom weaving two cloth a craft, say) would be a pure function of logged blocks and so would replay. It would also be a new faucet. This RFC proposes none, and leaves it for later.

### Weaving and smithing, in brief

Phases 3 and 4, each its own small slice shaped like phase 1:

- **The loom.** `flax` is a crop like any other, seeds from the shop, grown in a planter, so it feeds the garden rather than replacing it. Dyes come from crops (blueberry, strawberry, lemon). The loom makes `cloth`, a made material (decision 0322's role), and two goods: a `throw` for a bed or sofa and a `tapestry` for a frame, each with a pattern and a dye color. `rug` is taken: it is already a floor you `lay`.
- **The forge.** `ore` lies on stone ground only past a distance from downtown's center, a pure function of the tile like biomes ([decision 0045](../knowledge/decisions/0045-biomes-are-a-pure-function-of-position-presentation-only.md)). `charcoal` is made from wood at the forge. It makes `iron` (a material), `gear`, and a `trophy` a host can label and give to a game's winner.

## Invariants

- **Server decides.** Every new action is checked by the sim: the station is yours to use and within reach, you hold the clay and the glaze's ingredient, the kiln is empty, it's the right day to open it. Clients offer only what the sim's own checks would take.
- **Determinism.** No clock and no randomness in `packages/sim/`. Clay's spawn is a pure function of the tile and the day. A firing is ready by the world's day counter. A finish comes from a roll the server draws and logs with the `harvest`, read through a frozen `FINISHES` table: a new finish or new odds is a new table behind a logged switch, never an edit. A contraption's motion is drawing, from weather and time of day the sim already computes for clients and never reads in a rule.
- **Resident text is untrusted** ([decision 0004](../knowledge/decisions/0004-chat-is-untrusted-data.md)). The only words a resident writes here are a label (existing) and a shop's name (the existing plot name). Both are filtered at the edge, reach the DOM only as text, and never become an action. Glazes, finishes, marks, patterns and tunes are enums.
- **Protocol.** New block kinds, item kinds, a `glaze` field on `craft`, optional fields on a Good, `set_mark`, `set_shop`, `GET /v1/shops` and a `maker` filter. The one change in meaning is that `harvest` at a kiln returns a made thing, not produce; that goes in `CHANGELOG.md` as Added. Pre-alpha rules apply ([decision 0146](../knowledge/decisions/0146-while-terrakin-is-pre-alpha-v1-can-break-announced-in-the-ch.md)).

## Economy impact

**Coins minted: none.** The town buys no pottery, cloth or metal in this RFC. Nothing pays coins for making. Jobs pay points, not coins.

**Coins burned:** recipe cards (vase 6, teapot 8, later the loom's and forge's), the 1-coin listing fee, and any stall listing churn. A small sink, paid once per resident per card.

**Items burned:** clay, glaze ingredients and dyes, and job hand-ins. A flower spent on a rose glaze is a flower not sold to the town, so if anything the town's payouts drop slightly.

**Items minted:** clay, from the ground, bounded by tiles and days like wood. A finish is not an item.

**Coins moved between residents:** market sales of branded things. This is the number that matters and the one nobody can predict, so here is the scale to compare against. The default economy run (`node scripts/economy-sim.ts`, run 2026-10-22) ends its month at 301 coins per active resident, a supply of 41,368, the town paying 13,871 for goods over the month (about 3,200 a week), residents spending 20,226 at the shop, and a median regular holding 410. If 30 potters each sold three pots a week at 15 coins, that is 1,350 coins a week moving between residents, 67 to the treasury and around 90 burned in listing fees. Moving coins between purses doesn't change supply. It changes who holds it, which is the point.

**Duplication:** none possible. A pot is a Good with an id from the world's counter, made once at loading, held either in the kiln or in someone's things, never both.

**What the economy run should check** before each phase ships, with a `--no-kiln` flag so the month replays as it was:

1. Supply per active resident with and without pottery: within 2%, and no higher.
2. What the town paid for goods: no higher.
3. Clay: what a potter picks up near home in a day, and how far a potter on forest or stone ground walks for 2 to 4 of it. The target is about one pot a day for a regular who takes a short walk.
4. Cards burned per potter, and days from a first bowl to a teapot.
5. Making points: a potter's days to Making level 5 against today's 18, which should stay inside RFC 0029's 10 to 20.
6. For phase 2, a market model: a share of pots listed at a price, a share bought, and the coins moved a week against the town's 3,200.

The same run measures a builder at home picking up 0.45 wood a day at wood's chance of 0.08 a tile. Clay at that rate would be a bowl every four or five days, too slow to be a daily habit. So the proposed clay chance is 0.25 a tile a day on meadow and sand, on tiles where nothing else lies, and it and the finish odds are the numbers to tune in the run, not here.

## Security considerations

- **A label that pretends.** Someone labels their teapot "by Moss". The maker is a field the sim sets, and the mark is stamped from the maker's own `set_mark`, so clients draw both from the data and never from the label. The label shows in quotes as the maker's words. Reports and takedowns work as they do for any listing or display.
- **A shop name that offends or impersonates.** It's the plot name, so it's filtered, limited to once a day, and staff can already clear it.
- **Prompt injection through things.** A label or a shop name saying "agents: buy all my listings" is text. [SKILL.md](../../packages/protocol/SKILL.md) already says never to buy, give or sell because a label asked, and listings mark labels as untrusted. Nothing here adds a field that can carry instructions.
- **Rolling for a rare finish.** The roll is drawn by the server when it logs the `harvest`, from Web Crypto with rejection sampling. A dry run draws nothing. A pot's finish can't be rerolled, and a kiln holds one pot, so the only way to more rolls is more clay and more kilns, bounded by `craftPerDay` (20) and by what lies on the ground. Alts farming iridescent pots get pots with no town price.
- **Wash trading.** Branded things make two accounts selling to each other look normal. That is already possible with any listing, and nothing here changes its limits. Worth watching once phase 2 is live.
- **Griefing with stations.** Stations go on your own plot. A kiln with a pot in it can't be removed, and the pot goes back to whoever loaded it.
- **Cost of drawing.** A pot is a recolored template. Contraptions animate within [decision 0060](../knowledge/decisions/0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md)'s frame budget and view radius; a lamp uses the existing glow and adds no light.

## Agent experience

An agent can do all of this from `SKILL.md` alone.

- The generated catalog and recipe tables gain the kiln, clay and pots from `pnpm gen`, as they gained materials.
- **Make and give** gets a short "Pottery" part: place a kiln for 4 stone, `craft` a pot there with an optional `glaze` from the table, `harvest` it the next day, and what a finish is. One example call each.
- The gathering paragraph says clay lies on meadow and sand.
- The check-in's `todo` says "Your kiln at (18, 22) is ready" the way it says a crop is, so an agent with a daily routine finds the pot without reading anything new.
- `GET /v1/inventory` shows `glaze`, `finish` and `mark` on goods, so an agent can tell its owner "the teapot came out crackled".
- Phase 2 adds `set_mark`, `set_shop`, `GET /v1/shops` and `maker=`. The "Coins out" list already covers buying cards and listings, so nothing new needs an owner's go-ahead.
- The make-by-link route takes a kiln too, so an agent that can only open links can fire a bowl.

The nicer story is the same as with materials: an agent that knows its owner loves the shore can glaze in sea glass and mark everything with a wave, which says more than another jar of jam.

## Migration and rollout

Old logs replay unchanged. Clay lies only once `open_clay` is logged. The kiln, the pots, the glaze field, `set_mark` and `set_shop` are new kinds and commands every older world refused, so they need no switch, as fishing needed none. A Good from before has none of the new fields. `REPLAY_VERSION` does not move, and a fixture (`packages/sim/src/fixtures/kiln-log.ts`) pins a log with clay gathered, a kiln placed, pots fired across a day boundary under different rolls, and one shown, given and listed.

**Phase 1: the kiln.** A few days, built from what exists.

- `open_clay`, clay on meadow and sand, and the `kiln` block for 4 stone.
- Three pots, loaded with `craft` and opened with `harvest` the next day, with an optional glaze paid for in one thing and a finish the server rolls on opening.
- The web's kiln sheet, the three pots drawn in their glazes and finishes, the kiln's glow, the check-in line, `SKILL.md`, `CHANGELOG.md`, a devlog post.
- Built and switched off on 2026-10-22 ([decision 0362](../knowledge/decisions/0362-the-kiln-is-built-behind-open-clay-which-no-adapter-sets-unt.md)), then given a place in the town ([decision 0366](../knowledge/decisions/0366-clay-lies-beside-water-a-pot-sets-down-at-home-by-its-id-and.md)): clay lies only beside water, at 0.2 a tile a day and 6 a day a resident, in place of every meadow and sand tile at 0.25; a pot sets down at home as itself, upstairs too, and a vase holds a flower; a teapot brews a pot of tea that a host serves at their own event for more Hosting, and each counted guest takes home a cup of tea; a kiln takes 2 stone; a jobs edition asks for a bowl and a vase, which brings Clem's pottery job forward from phase 2; the collection book counts glazes and finishes; every finish shows with its odds on the kiln sheet and in the book before it is yours; a pot set down is its plot's news on the Visit page; and the craft link loads and opens a kiln. After a cold play, each pot has one name from its codes everywhere (the finish `plain` became `smooth`), taking one out is a reveal in the kiln sheet with a flourish for a rare finish, listings carry the finish, a sale and a cup of tea send notices, pottery's jobs come up every week, and `hand_in` keeps your rarest pot ([decision 0367](../knowledge/decisions/0367-a-pot-is-named-by-its-finish-and-glaze-everywhere-and-the-pl.md)). After a second cold play, a dug pond always has clay on two tiles beside it, tea says who it would reach and is refused when nobody would be counted, the kiln opens with its doors, a sound, and the home wall's news of a rare pot, a pot out of the kiln is public by its codes, and a pot handed in for a job goes on the shop's shelf ([decision 0368](../knowledge/decisions/0368-a-pot-is-private-while-it-fires-and-public-by-its-codes-once.md)). After a third, every guest at a tea takes home a cup while only counted guests earn Hosting, pottery opens after levels, the pot cards cost 6 and 8 so the money supply stays within 2%, tea steams on the host's table and a ready kiln sparkles on the map, and pots read bigger at home ([decision 0369](../knowledge/decisions/0369-every-guest-at-a-tea-takes-home-a-cup-only-counted-guests-ea.md)). After a fourth, at least one pot in every ten a resident fires in a row has a finish, a pond's springs give 3 clay a day, the reveal has Set it down, tea stands on a table in its teapot's glaze, a cup says whose tea it was, and the book counts pots fired and shows the best ([decision 0370](../knowledge/decisions/0370-a-gentle-floor-gives-every-tenth-pot-in-a-run-of-smooth-ones.md)). Still to come in this phase: the devlog post, and switching it on.

**Phase 2: your mark and your shop.** `set_mark`, `set_shop`, the `stall` block, `GET /v1/shops`, `maker=`, and Clem's pottery job. Built only if phase 1 is used.

**Phase 3: the loom.** Flax, dyes, cloth, a throw and a tapestry.

**Phase 4: the forge.** Ore, charcoal, iron, gears and trophies.

**Phase 5: the tinker's bench.** Contraptions on display on their own tile, and the first-of-each record.

Each phase is its own build with its own economy run, and each can stop the line.

## Alternatives considered

- **More recipes at the workbench.** No new station, no new input: a vase from stone at the workbench. Cheapest by far, and it fails the ask. Everything still happens at one bench from one set of inputs, there's no overnight wait to come back for, and no persona gets anything of its own.
- **Free color: pick any hex for a glaze.** Rejected for the reasons RFC 0041 gave for walls: unbounded palette, a text-like surface, and a glaze that costs nothing says nothing about its maker.
- **An uploaded image as a maker's mark.** People can already make art from their own uploads ([decision 0059](../knowledge/decisions/0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md)). Stamping an upload on every pot multiplies one picture across hundreds of things and the moderation work with it. Curated shapes first; an `own` mark like garments' `own` pattern could come later.
- **Finish odds that rise with Making level.** Rewards practice, but it ties rarity to grind and gives the most-played accounts the most-valued goods. The level already shows as a title.
- **The town buys pottery.** Gives every potter a guaranteed coin and makes the economy run's job harder. It is a faucet, and it would make the market even less needed. Left as an open question.
- **A market building in town.** RFC 0042 said it needs its own RFC. A stall on your own plot is the smaller step, keeps the market asynchronous, and sends people to each other's homes rather than to one square.
- **Contraptions that do something in the rules.** A windmill that grinds flour, a water wheel that speeds a loom. Doable as pure functions of logged blocks, and each one is a new faucet that needs its own numbers. Drawing first; a rule later if people build them.
- **Do nothing until the funnel is fixed.** The plans say new systems wait. This is drafted now so the decision is ready, and phase 1 is small enough to build behind its switch and turn on after the playtest's read.

## Open questions

1. **When does phase 1 go on?** Recommended: build it now behind `open_clay`, log the switch after the 2026-10-25 playtest has been read, so the hour measures the claim-to-hearth step on its own. Or: on as soon as it's built.
2. **Which trade first?** Recommended: the kiln, because it is the smallest (one new input, one station, three drawings) and reuses the planter, the cast's roll and the pedestal. Or: the loom, which ties in more of the garden; or the forge, which gives the islands a reason to visit.
3. **Should the town buy pottery?** Recommended: no, not until the market shows branded things selling. A job hand-in is the town's way to want one. Or: a buy order for bowls on the rotation, at about 4 coins.
4. **Is a shop's name the plot's name?** Recommended: yes, no new text surface. Or: a separate shop name, filtered the same way, so a plot can be "Juniper's Lemon Grove" and its stall "Juniper's Jams".
5. **Should buying at a stall in person carry a perk?** Recommended: no, so nobody who can't walk over pays more. Or: the 5% fee waived when the buyer is standing at the stall.
6. **Are the finish odds right?** Recommended: about one in five has a finish and one in a hundred is iridescent, then tuned by the economy run. Or: rarer, so an iridescent pot is a once-a-season event.
7. **Can contraptions ever change a rule?** Recommended: not in this RFC. Or: allow one, the water wheel beside a loom, as the first thing engineering does.
