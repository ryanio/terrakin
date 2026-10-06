---
title: Finds spawn by biome and season after a logged open_finds, from a frozen table, and stand on pedestals
date: 2026-10-06
status: accepted
tags: [sim, economy, numbers, replay, items, seasons]
---

# Finds spawn by biome and season after a logged open_finds, from a frozen table, and stand on pedestals

## Context

[RFC 0021](../../rfcs/0021-collections-and-foraging.md) adds rarer things to pick up on a walk. Where pickups lie is a pure function of the tile and the day (`gatherableAt`, [decision 0063](0063-simple-gathering-is-in-phase-1-wood-and-stone-picku.md)), so any change to it changes which logged `gather`s the sim accepts. The live log already holds gathers of branches and stones, and the server boots from snapshots, so a change that replays old inputs differently would need a `REPLAY_VERSION` bump ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)). RFC 0018 says a new role or family needs a decision, and finds bring both. Finds also had to be shown on a pedestal, where until now only made things with ids could go ([decision 0059](0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md)).

## Decision

- Finds are a new role, `find`, in four families under `find`: Forest (`forest_find`), Shore (`shore_find`), Stony ground (`stone_find`), and Meadow (`meadow_find`). Sixteen kinds, each drawn by hand. They stack, go on the end of `STACK_KINDS`, and are the API category `find`.
- The spawn changes only at a logged switch. The server sends `open_finds` from `TOWN_ACTOR` once items are open (`WorldService` option `finds`, on in both adapters), setting `items.findsOpen`. Before it, `gatherableAt(config, x, y, day, false)` answers exactly as it always did. After it, a branch or a stone lies exactly where it did, and only a tile with neither may hold a find, from a second roll with its own constants (murmur3's finalizer), so the old spawn never moves.
- Each find has its own chance per tile per day in its biome, and seasonal ones count only on days of their season, in `FIND_SPAWNS` order. A per-biome chance split by weights would make the rare all-year find of a biome common in a season with no seasonal find there, so each find carries an absolute chance instead.
- The table is frozen by name, like the town's rotation. A new find, or new numbers, is a new table that starts at a logged switch of its own. `gather.test.ts` pins the counts of every find over a week of each season on the real world's 72 by 72 tiles, and `src/fixtures/finds-log.ts` pins a log with gathers on both sides of the switch.
- `display` takes a find by its kind. What stands on a pedestal is a made thing (`Display`) or a find (`ShownFind`, `{find, by, day}`), in the same `items.displays`, and a find taken down while its owner is full is held aside like a made thing. A find has no maker, so `admire` refuses it (`not_eligible`) and it never reaches galleries, reports, or karma: `displaysOf`, `displayOfItem`, `heldAsideOf`, and `everyGood` read made things only, and `findsOnDisplay` and `findsHeldAsideOf` read finds. On the wire, finds on display are their own list, `displayedFinds`, with a `find_displayed` event, so `displays` keeps meaning made things for every client that reads it.
- The town never buys finds and the shop never sells them. They mint no coins.

The numbers, per tile of the find's biome per day, on tiles with no branch or stone:

| Find | Where | Season | Chance | About this many a day, world-wide |
|---|---|---|---|---|
| acorn | forest | all year | 0.3% | 4.2 |
| pinecone | forest | all year | 0.25% | 3.5 |
| mushroom | forest | all year | 0.12% | 1.7 |
| feather | forest | all year | 0.03% | 0.4 |
| chestnut | forest | autumn | 0.3% | 4.2 |
| sprig of holly | forest | winter | 0.2% | 2.8 |
| seashell | sand | all year | 0.6% | 4.9 |
| driftwood | sand | all year | 0.3% | 2.4 |
| sea glass | sand | all year | 0.08% | 0.65 |
| starfish | sand | summer | 0.2% | 1.6 |
| crystal | stone | all year | 0.3% | 2.4 |
| fossil | stone | all year | 0.12% | 0.95 |
| geode | stone | all year | 0.04% | 0.32 |
| four-leaf clover | meadow | all year | 0.02% | 0.39 |
| maple leaf | meadow | autumn | 0.25% | 4.9 |
| cherry blossom | meadow | spring | 0.25% | 4.9 |

The world has 1,536 forest tiles, 864 stone, 816 sand, and 1,968 meadow; about 122 branches and 70 stones lie each day, which leaves about 1,414 forest and 794 stone tiles for finds. In autumn that's about 31 finds a day across the world, one for every six branches and stones, and about one every two or three days on a plot. Each of the four rare finds turns up somewhere about once every two or three days, so a resident who walks now and then finds the common ones in a week and the rare ones over a season. Sand has no branches or stones, so its finds are the most common, to make the shore worth a walk.

## Consequences

- Old logs replay unchanged: `REPLAY_VERSION` stays 1, and every older fixture keeps its hash.
- A client that hasn't heard of the switch still draws every branch and stone right; it just draws no finds until it reloads. Clients pass `findsOpen` to the sim's `pickupOn`, so the map draws exactly what `gather` would take.
- `pickups` in `GET /v1/world` lists every find in the world, so agents can race for rare ones. The rarity, the walk, the owners-only rule on claimed plots, and the gift and market gates bound what that's worth; no coins come from finds.
- Recipes that take finds, galleries that list finds on display, and a second table of finds are each a decision of their own.
- Code: `FIND_SPAWNS`, `gatherableAt`, `pickupOn`, `findsOpen`, and `checkOpenFinds` in `sim/src/gather.ts`; the entries and families in `sim/src/catalog.ts`; `ShownFind` and `Shown` in `sim/src/types.ts`; display, take down, held aside, and admire in `sim/src/display.ts`; the drawings in `ui/src/item-art.ts`; `paintFind` in `client/src/render.ts`; `foundThings` in `client/src/scene3d/displays.ts`.
