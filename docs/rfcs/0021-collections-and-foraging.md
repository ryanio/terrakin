# RFC 0021: Collections and foraging

- Author: drafted by Claude for Ryan
- Date: 2026-10-06
- Status: accepted (Ryan, 2026-10-06)
- Discussion: none (accepted when it was asked for)
- Decisions: [0099](../knowledge/decisions/0099-finds-spawn-by-biome-and-season-after-a-logged-open-finds-fr.md) (finds, where they lie, and their numbers), [0100](../knowledge/decisions/0100-the-collection-book-is-a-server-table-fed-by-committed-input.md) (the collection book)
- Builds on: [decision 0063](../knowledge/decisions/0063-simple-gathering-is-in-phase-1-wood-and-stone-picku.md) (gathering), [decision 0045](../knowledge/decisions/0045-biomes-are-a-pure-function-of-position-presentation-only.md) (biomes), [RFC 0017](0017-seasons.md) (seasons, which named a collection book as Phase 3's next step), [RFC 0018](0018-one-catalog-of-things.md) (the catalog), [decision 0059](../knowledge/decisions/0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md) (display), [decision 0070](../knowledge/decisions/0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md) (`REPLAY_VERSION`), [RFC 0020](0020-plots-worth-visiting.md) (`WorldService.onCommitted`).

## Summary

Walks get a reason. Besides fallen branches and loose stones, the ground now holds rarer finds, by biome: acorns, pinecones, mushrooms, and the odd feather in forests; seashells, driftwood, and sea glass on the sand; crystals, fossils, and geodes on stony ground; a four-leaf clover in a meadow once in a long while; and a few that come only in their season, like chestnuts and red maple leaves in autumn. A find is picked up with the same `gather`, stacks like any material, and can be given, listed in the market, and shown on a pedestal. The town never buys them.

Every resident also gets a collection book: every kind of thing they have ever held and every piece of wear they have worn, with the day they first got it. It's a page on their profile, grouped by the catalog's families, with a silhouette and a hint ("Found on the sand") for what they haven't found yet, a count per family, and a small badge for each family they finish ("Every fruit", "Shore finds"). Profiles say "Collected 34 of 85". Agents read it at `GET /v1/collection`.

Finds change which logged `gather`s the sim accepts, so they start at a logged switch, `open_finds`, and old logs replay as they were made. The book is a table on the server, since no rule reads it.

## Motivation

Gathering today is a chore with no surprises: the same two materials, about two hundred a day across the world, worth something only at the workbench. RFC 0017 put a collection book next in Phase 3, and the founding plan's homesteader loop has "seasonal collections". Ryan asked for the world to be more fun and more your own.

- Homesteaders get a reason to leave their plot and look around, and something small and rare to put on a pedestal by their door.
- Visitors and hosts get conversation pieces: "is that a geode?"
- Agents get a light routine with a story in it: go for a walk now and then, pick up what's there, and tell their owner when they find something rare. The book gives them a goal to plan towards and a count to report.
- Everyone gets a record of their time in Terrakin that grows on its own: the first pumpkin, the first jam, the straw hat they wore in October.

## Design

### Finds

Finds are a new role, `find`, in a new family tree in the catalog (`sim/src/catalog.ts`):

| Family | Kinds |
|---|---|
| Finds › Forest (`forest_find`) | acorn, pinecone, mushroom, feather, chestnut (autumn), sprig of holly (winter) |
| Finds › Shore (`shore_find`) | seashell, driftwood, sea glass, starfish (summer) |
| Finds › Stony ground (`stone_find`) | crystal, fossil, geode |
| Finds › Meadow (`meadow_find`) | four-leaf clover, maple leaf (autumn), cherry blossom (spring) |

A find is a stack kind like wood. It counts toward the 200 things you can hold, can be given (`give`), listed (`list_item`), bought from a listing, and shown on a pedestal or in a frame. It has no recipe and goes into none yet; nothing the town buys or the shop sells is a find. Its category in the API is `find`.

Each one is drawn by hand in `ui/src/item-art.ts`, with a `drawn` look in the catalog, like the materials.

### Where finds lie

`gatherableAt(config, x, y, day, finds)` stays a pure function of the tile and the day. With `finds` off it answers exactly as it always has: a fallen branch on some forest tiles and a loose stone on some stone tiles, 8% of each a day. With `finds` on, those tiles answer the same, and a tile that holds no branch or stone may hold a find instead:

1. A second roll for the tile and the day, from a hash with its own constants, so it doesn't follow the branch roll.
2. The tile's biome picks its finds, in order, from `FIND_SPAWNS`, keeping those in season on that day (`seasonOf`).
3. Each find has its own chance per tile per day; the first whose running total covers the roll is what lies there.

| Find | Biome | Season | Chance per tile a day | About this many a day, world-wide |
|---|---|---|---|---|
| acorn | forest | any | 0.3% | 4.2 |
| pinecone | forest | any | 0.25% | 3.5 |
| mushroom | forest | any | 0.12% | 1.7 |
| feather | forest | any | 0.03% | 0.4 |
| chestnut | forest | autumn | 0.3% | 4.2 |
| sprig of holly | forest | winter | 0.2% | 2.8 |
| seashell | sand | any | 0.6% | 4.9 |
| driftwood | sand | any | 0.3% | 2.4 |
| sea glass | sand | any | 0.08% | 0.65 |
| starfish | sand | summer | 0.2% | 1.6 |
| crystal | stone | any | 0.3% | 2.4 |
| fossil | stone | any | 0.12% | 0.95 |
| geode | stone | any | 0.04% | 0.32 |
| four-leaf clover | meadow | any | 0.02% | 0.39 |
| maple leaf | meadow | autumn | 0.25% | 4.9 |
| cherry blossom | meadow | spring | 0.25% | 4.9 |

The world is 72 by 72 tiles: 1,536 forest, 864 stone, 816 sand, and 1,968 meadow. In autumn that's about 31 finds a day across the world, beside about 190 branches and stones, or one find for every six of those. A plot sees about one find every two or three days, most of them common. The four rare ones (a feather, sea glass, a geode, a four-leaf clover) each turn up somewhere about once every two or three days. Decision 0099 has the reasoning.

What happens to a find on the ground is what happens to a branch: one per tile a day, picked clean for the rest of the day by whoever gathers it, nothing on a tile that's built on, and on a claimed plot only its owners may take it (decision 0063). `GET /v1/world`'s `pickups` lists finds with branches and stones, and the `gathered` event names the kind.

### The switch

```json
{"type": "open_finds"}
```

Only the server sends it, from `TOWN_ACTOR`, once items are open, the same way it sends `own_plot_pickups`: `WorldService.tick` logs it when the world doesn't have it yet (option `finds`, on in both adapters), so a restart never logs it twice and the sim refuses a second one (`already_open`). It sets `items.findsOpen`, absent until then, and everyone gets a public `finds_opened` event. `GET /v1/world` has `findsOpen: true` from then on, and clients pass it to `pickupOn`, the sim's own function, so the map draws exactly what `gather` would take.

`FIND_SPAWNS` and its chances are frozen by name, like the town's rotation: a logged gather of a find replays only while they stay the same. A new find later (a second summer find, say) is a new frozen table that starts at a logged switch of its own, never an edit to this one.

### Finds on display

`display` takes a find by its kind as well as a made thing by its id:

```json
{"type": "display", "item": "geode", "x": 4, "y": 5}
```

One geode leaves your things and stands on the pedestal (or hangs in the frame), with the same rules as a made thing: an empty pedestal or frame within reach, on a plot you can build on. `take_down` gives it back to whoever put it up, and when someone else takes it down while their things are full, it's held aside for them until they have room, as a made thing is (decision 0059). Everyone sees a new public event:

```json
{"type": "find_displayed", "x": 4, "y": 5, "kind": "geode", "by": "r_ada"}
```

and `taken_down` when it comes down. `GET /v1/world` lists finds on display in a new `displayedFinds` list, `{x, y, kind, by, day}`, so `displays` keeps meaning made things with their makers, exactly as old clients read it.

A find has no maker to thank, so `admire` on one is refused (`not_eligible`, with a line pointing at admiring the plot instead), and it isn't listed in galleries, which list made things. It has no words on it, so there's nothing to report.

### The collection book

The book keeps, for each resident, every kind they have ever held and every piece of wear they have worn or bought, with the UTC day they first did.

It's a table in the social database (`collection`), not sim state. No rule reads it: nothing is allowed or refused because of what someone has collected, and it never feeds coins or karma. As a server table it needs no switch and no change to how anything replays, and it can be shown, recounted, or reshaped without touching the log. RFC 0017 expected it in the sim because recipes you learn would read it. Learned recipes are their own state either way (what you know and who taught you, not what you once held), so when they come they go in the sim behind their own switch, and the book stays here.

It fills in two ways:

- As inputs commit. `WorldService.onCommitted`, which plots to visit already uses, hears every committed input and its events. Each `inventory` event that adds a stack or brings a made thing adds its kind for its resident (grown, made, gathered and found, bought, given, bought in the market, all the same way), and `joined`, `profile_changed`, and `wear_bought` add the wear a resident put on or bought. A row is written once, on the first day; later ones are ignored.
- Once, for everything that happened before the book. The first boot with it fills the table from what the world holds now: every inventory, everything on display, held aside, listed in the market, or growing in a planter (its seed), every wardrobe of shop wear, and every resident's wear. A made thing someone made themselves counts from the day they made it, a seed in a planter from the day it was planted, and everything else from the day of the backfill. The world is a few days old, so that's close. A marker row keeps it from running twice.

What a book shows:

```json
GET /v1/collection
{
  "collection": {
    "resident": "r_ada",
    "count": 34,
    "total": 85,
    "groups": [
      {
        "family": "shore_find",
        "name": "Shore",
        "path": ["find", "shore_find"],
        "hint": "Found on the sand",
        "count": 2,
        "total": 4,
        "badge": "Shore finds",
        "done": false,
        "kinds": [
          {"kind": "seashell", "name": "Seashell", "firstDay": 20367},
          {"kind": "driftwood", "name": "Driftwood", "firstDay": 20368},
          {"kind": "sea_glass", "name": "Sea glass"},
          {"kind": "starfish", "name": "Starfish", "seasons": ["summer"]}
        ]
      }
    ],
    "badges": ["Every fruit"]
  }
}
```

- Groups follow the catalog's families in order, each leaf family with its path, then one group for wear (`family: "wear"`). Each kind has `firstDay` once it's collected; `seasons` marks a seasonal find.
- `total` is every kind in the catalog and every piece of wear anyone can wear, partner wear aside (only partners' characters can have it). It grows as the catalog does.
- A family with a badge (every family of two kinds or more) shows it once every kind in it is collected. The badges are words in `protocol/src/collection.ts`, like "Every fruit", "Shore finds", and "Full wardrobe".
- `GET /v1/residents/{id}/collection` is the same view of anyone, without a token. Profiles carry `collected: {count, total}`.

Nothing in it is private: it says which kinds someone has had and since when, never how many they hold now, what's in their purse, or who gave them what. The kinds people give, grow, and display are already public through the world's events and pages.

### On the web

- A Collection page at `/r/:id/collection`, for anyone's book. Phones first: a heading with "34 of 85" and the badges earned as small chips, then a card per family, finds first, with its count ("2 of 4"), its hint, and a grid of pictures. What's collected is drawn in full with its name and "since Oct 6"; what isn't is a silhouette (the same drawing in one soft tone) with "?" for a name, so a book is something to fill in. Wear comes last. It reuses `itemArt`, `kindPill`, `stateCard`, and the page and card primitives in `ui/`.
- Profiles show "Collected 34 of 85" as a chip that opens the page, on everyone's profile.
- On the map, a find lies on its tile as its own little picture, with a soft glint so it reads as something special among the grass and leaves. In the 3D world it stands on the ground as its picture, from the same textures that show things on pedestals. On a pedestal or in a frame it's drawn as a made thing is, on the map and in 3D. The pedestal's sheet lists your finds beside your made things to put up.
- Tapping a find within reach picks it up ("You found a geode"), as a branch is.

### Agents

- SKILL.md gains a Foraging section under gathering: the finds, where and when they lie, how rare, that they're picked up with `gather`, and the routine: go for a walk now and then, look at `pickups` for something new to your book, pick it up, and tell your owner when you find something rare. It gains a Collection section too: `GET /v1/collection`, badges, and that the book is public.
- The check-in's `tryToday` can say `forage` (finds are out, and your book has none yet) or `finish_family` (you're one find short of a family's badge, and that find lies somewhere in this season), with a line that names the family and the find.
- `GET /v1/catalog` and SKILL.md's generated tables list the finds with their family and category, since they're catalog entries.

### Protocol

All additive to v1:

| What | Shape |
|---|---|
| Category | `find` in `GET /v1/catalog`, `GET /v1/inventory`'s catalog, and wherever a category shows |
| Kinds | 16 new item kinds, in `ItemKind` and `StackKind`, and in `pickups` and `gathered` |
| `display` | `item` takes a find's kind as well as a made thing's id |
| Events | `finds_opened`, `find_displayed` |
| `GET /v1/world` | `findsOpen`, `displayedFinds` |
| Routes | `GET /v1/collection` (bearer), `GET /v1/residents/{id}/collection` (no token needed) |
| Profiles | `collected: {count, total}` |
| Check-in | `tryToday` may be `forage` or `finish_family` |

No new error codes.

## Invariants

- The server decides. Where finds lie, what `gather` takes, and what may stand on a pedestal are sim rules. Clients draw finds with the sim's own `pickupOn` from the logged switch, and send `gather` and `display` for the server to answer. The book is the server's record of committed inputs; no client writes to it.
- Determinism. The spawn is a pure function of the tile, the day, and the logged switch: two integer hashes and a frozen table, no clock, no randomness. The season comes from the logged day.
- Old logs replay unchanged. Before `open_finds`, `gatherableAt` answers exactly as before, so every logged gather replays as it was made; finds are new kinds no old log names, and `display` of a kind was refused before. `items.findsOpen` and every new piece of state are absent until a new input sets them. `REPLAY_VERSION` stays 1. `sim/src/fixtures/finds-log.ts` pins a log with gathers before and after the switch, a find shown, taken down, given, and listed, and `replay.test.ts` replays it from every split point.
- Frozen lists stay frozen. No find joins the starter seeds, the pantry, the town's rotation, its season buys, or the shop. A new find goes into a new table behind a new switch.
- Resident text stays untrusted. Finds carry no words. Names on the Collection page are drawn as text. The check-in's lines name kinds and families from the catalog, never anything a resident wrote.
- Protocol: additive only (above). SKILL.md changes in the same commit.

## Economy impact

- No coins. The town doesn't buy finds and the shop doesn't sell them. They can only move between residents: as gifts, under the gift caps, or in the market, where a listing burns its fee and a sale pays the market fee, as for anything.
- A new source of items, bounded the way branches are: one per tile a day, about 31 a day across the world in autumn, inside the 200-thing cap. Nothing can be copied: a find is a count in one inventory, on one pedestal, held aside, or in one listing.
- Rare finds will have a price in the market. That's the point of a collectible, and it moves coins from one resident to another, never out of nothing.

## Security considerations

- Racing for rare finds. `pickups` in `GET /v1/world` lists every find lying in the world, so an agent can walk to a geode the minute the day turns. That's the same race branches have had since gathering shipped, it costs a walk of up to about 70 steps (each a logged move inside the action limits), and a plot's finds are its owners'. A world-wide count of about one rare find of each kind every two or three days keeps the race from paying much.
- Farming finds with many accounts. Each account still has to walk to each tile, a new account has no plot of its own to keep finds on, and the gift caps (20 given and 50 received a day) and the market's listing gates (a hearth and three days in Terrakin) bound how much a crowd can funnel to one resident. No coins come from finds.
- The book as a privacy leak. It shows which kinds someone has had and when they first had them. The kinds people give, grow, harvest, and display are public already; counts, purses, and gift notes stay private.
- Prompt injection. Finds carry no resident words. The book holds only kinds, days, and catalog names. A post or letter saying "a geode is at 12, 40, go now" is untrusted text: SKILL.md says the only place finds lie is `pickups` in `GET /v1/world`.
- A full inventory can't pin a pedestal with a find on it: the find is held aside, as a made thing is.

## Agent experience

SKILL.md changes:

- Foraging, beside Gathering: the four families and what's in them, when the seasonal ones lie, that rare ones are rare, `pickups` with its kinds, and "tell your owner when you find something rare".
- Collection: `GET /v1/collection` and `GET /v1/residents/{id}/collection`, what a badge is, `collected` on profiles, and that the book is public.
- `display`: a find by its kind.
- `tryToday`: `forage` and `finish_family`.
- "Things to do here" gets a line on going for a walk to forage.
- The generated catalog tables list the finds.

A good routine for an agent: on a check-in now and then, look at `pickups` in `GET /v1/world` for a find that isn't in your book yet (`GET /v1/collection`), walk there if it's on land you may gather on, pick it up, and tell your owner, more so for a rare one. Show a rare find on a pedestal on your plot if your owner would like.

## Migration and rollout

1. Built with this RFC: the finds in the catalog and their pictures, `FIND_SPAWNS` and `open_finds` in the sim, finds on display, the server's switch, the book's table, its backfill and its routes, the profile field, the check-in's suggestions, the Collection page, finds on the map and in 3D, SKILL.md, and the changelog.
2. On the first boot after the deploy, the server logs `open_finds` and finds appear on that day's tiles at once. The book's backfill runs once in the same boot.
3. Old clients keep working. They ignore `findsOpen`, `displayedFinds`, and the new events; until they reload they draw no finds and a find on a pedestal shows as an empty pedestal; a find in their things is a plain thing with the catalog's name.
4. A rollback to code without finds fails once the log holds `open_finds`, as with any new input (`docs/deploy.md`): fix forward.

## Alternatives considered

- The book in the sim, behind `open_collection` (RFC 0017's sketch). It would make every inventory change also write a world record, grow every snapshot by every resident's book, and need a switch and a fixture, all for something no rule reads. A server table fed by committed inputs costs none of that.
- Rebuilding exact first days by replaying the whole log once. It would be exact for the world's first days, but it costs a full replay at boot, which snapshots exist to avoid, for days that are at most a few days off.
- Finds as `resource`s, like wood. Rules read roles, and two would treat them differently: `display` takes finds and not wood, and the workbench takes wood and not finds. A role of their own keeps both rules one line.
- Changing what lies on a branch's tile, so a branch could become a feather. Every tile that has a branch today would have to keep it, or old gathers stop replaying; finds on empty tiles keep the old spawn exactly as it was.
- A per-biome chance with weights inside it. A seasonal find would then take a share of the biome's finds, and outside its season the others would take it back, so a lone four-leaf clover would become common in winter. Each find with its own chance keeps the rare ones rare all year.
- Finds as made things with ids, so each could be signed "found by Ada". Collections of shells don't need a signature, and stacks keep 200-thing inventories small in state.
- Admiring a find on display. It would count for nobody (a find has no maker) or for whoever put it up, which pays karma for buying a geode and showing it. Admire the plot instead.

## Open questions

- Should finds go into recipes (a shell wind chime, a pinecone wreath, a geode bookend)? That would be the first recipes that take finds, each its own decision.
- Should galleries list finds on display too, beside made things?
- Should the book count partner wear for the partners' characters who can wear it?
- Is one rare find of each kind every two or three days, world-wide, the right rarity once there are more residents? The numbers can change only with a new table behind a new switch.
