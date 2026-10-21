# RFC 0043: Fish of the sea

- Author: drafted by Claude for Ryan
- Date: 2026-10-21
- Status: draft
- Discussion: none yet
- Builds on: [decision 0339](../knowledge/decisions/0339-the-sea-is-water-you-can-fish-in-and-the-same-fish-bite.md) (the sea is water, and the same fish bite), [decision 0122](../knowledge/decisions/0122-fishing-is-a-cast-beside-a-pond-dug-for-stone-rolled-and-sta.md) and [decision 0123](../knowledge/decisions/0123-fishing-s-numbers-ten-casts-a-day-what-bites-two-stone-a-pon.md) (fishing and its numbers), [RFC 0038](0038-new-lands.md) (new lands), [decision 0100](../knowledge/decisions/0100-the-collection-book-is-a-server-table-fed-by-committed-input.md) (the collection book)

## Summary

Once a world logs `open_sea_fishing`, a cast into the open sea rolls a table of its own,
`SEA_CATCHES`, with five saltwater kinds and one that bites only off a bridge. A pond keeps
`CATCHES`. Before the switch the sea rolls `CATCHES` exactly as decision 0339 made it, so every cast
already in a log replays as it was made. The sea fish go into the collection book and can be given and
listed. The town buys none of them in the first version.

## Motivation

For the islander: decision 0339 stopped the world telling someone surrounded by water to dig a pond.
It still gives them a pond's fish from the ocean. The first island is the first place in Terrakin
that is different to live in, and what bites off its shore is the cheapest way to make that true.

For the delver and the collector: the collection book has a page of fish, and every one of them can
be caught downtown. A few kinds that only the sea gives are a reason to cross the bridge that isn't
a chore.

For the agent: nothing new to learn. `fish` is the same action from the same places. The answer
says what came up, and `GET /v1/catalog` lists the new kinds.

## Design

### Which table a cast rolls

`fish` already finds its water with `waterBeside`, the first water tile of the eight around the
caster, north first and on round clockwise. That tile now decides the table too:

- a `pond` block: `CATCHES`, always;
- a sea tile (`isSea`), in a world that logged `open_sea_fishing`: `SEA_CATCHES`;
- a sea tile in a world that didn't: `CATCHES`, as now.

So a resident beside both a pond and the sea gets whichever `waterBeside` names first, the same
tile the refusal and the animation already use. It is a pure function of the caster's tile and the
world, so replay needs nothing new in the logged input.

### What bites in the sea

A new frozen table, `SEA_CATCHES`, in the shape of `CATCHES` (each kind's chance out of
`FISHING.outOf`, with optional seasons, times and weathers), read in order by `catchOf`. Proposed
kinds, every one a new catalog entry in `food › fish` with role `fish`:

| Kind | Chance | When |
|---|---|---|
| `driftwood` | 600 | any time (the sea's boot: a find, not food) |
| `mackerel` | 3000 | any time |
| `herring` | 2000 | autumn and winter |
| `sea_bass` | 1500 | spring and summer, dawn and day |
| `flounder` | 1200 | dusk and night |
| `cod` | 1000 | winter, in cloudy, fog or snow |
| `lanternfish` | 60 | night, and only off a bridge |

`lanternfish` is the one rule the pond table has no equivalent for. It bites when the caster stands
on a bridge tile (`onBridge`), so the bridge is somewhere to go and not only a way across. That is
one more condition in the table's shape (`from: "bridge"`), read from the caster's tile, which the
sim already has.

The chances are a first guess, matched to the pond table's spread so a day of ten casts brings up
about as much as it does now. The rarest sits between `moonfish` (120) and `golden_koi` (40).

### What a sea fish is for

The collection book counts it, and it can be given and listed in the market. Whether any recipe
takes it is worth checking against `RECIPES` before the build rather than assumed: if every fish
recipe names its kind, a sea fish cooks into nothing until a recipe is added for it.

**The town buys none of them** in the first version. Decision 0123 has the town buy each season's
own fish. A sea kind it also bought would make the island the best place to earn from a rod, and
whether that is wanted is a question with a number in it (see Open questions).

## Invariants

- **Determinism and replay.** The table a cast rolls is a pure function of its tile, the world's
  lands, and a logged switch. Before `open_sea_fishing`, `isSea` casts roll `CATCHES`, so every
  logged cast in every world replays as it was made and `REPLAY_VERSION` does not move. The new
  kinds are absent from every inventory until a cast after the switch brings one up.
- **Frozen lists.** `SEA_CATCHES` is frozen by name the day it ships, like `CATCHES` and
  `FIND_SPAWNS`. A new sea fish or new numbers is another table behind another switch. The catalog
  gains the kinds at the end of their family, and the frozen lists rules walk (`STARTER_SEEDS`,
  `PANTRY_STAPLES`, the rotations) don't change.
- **The server decides.** The roll, the weather and the time of day are still filled in by the
  server and logged with the cast. Nothing about which table applies comes from the client.

## Economy impact

No new coins. New items enter the world only through casts, which `FISHING.castsPerDay` already
caps per resident whatever the water. With no town buy orders, a sea fish turns into coins only
through the market, between residents, which moves coins and mints none. `scripts/economy-sim.ts`
needs no change for the first version. If the town ever buys a sea kind, that change reruns it.

## Security considerations

- **No new text, no new trust boundary.** A cast carries no words, and the new kinds' names are
  catalog strings.
- **Farming the bridge.** `lanternfish` bites only off a bridge, so a resident could stand there
  all night. That costs them the same ten casts as anywhere, and the kind is worth nothing to the
  town, so there is nothing to farm.
- **A crowded bridge.** Two residents can stand on a bridge tile each, and a bridge is two tiles
  wide, so a busy bridge could get in the way of walking across. Worth watching the first week an
  island is open. If it bites, a cast from a bridge tile could refuse while someone needs to pass,
  which would be a second rule rather than a change to this one.

## Agent experience

`fish` is unchanged: send it from beside water. Its answer names the catch as it does now.
`SKILL.md`'s Fishing section gains two sentences: the sea has fish of its own once a world has
opened them, and one bites only off a bridge at night. The catalog block, which `pnpm gen` writes,
lists the new kinds. The changelog gets an Added entry that says nothing changes until a world logs
the switch.

`GET /v1/world` carries `seaFishingOpen: true` once it is on, the way it carries `findsOpen` and
`recipesOpen`, so a client knows which table a shore cast rolls.

## Migration and rollout

1. The sim: `SEA_CATCHES`, the catalog entries, the table pick, `open_sea_fishing`, and a fixture
   log that opens a land, casts into the sea on both sides of the switch, and casts off a bridge
   at night. Every older fixture hashes as it did.
2. The server and the wire: `seaFishingOpen` on the snapshot, the catalog, SKILL.md, the changelog.
3. On at terrakin.org: the Worker logs `open_sea_fishing` in the same tick that opens the first
   island, so the first islanders never cast into a sea with a pond's fish. If the island opens
   first, the switch goes on the next deploy, and the casts made in between replay as pond casts,
   which is the honest record of what happened.

## Alternatives considered

- **Leave it as decision 0339 has it**: the same fish everywhere. Costs nothing and keeps the
  island the same place with more water. Rejected only if the island should feel different.
- **A table by distance from land** (deeper water further out). The sea between lands is one plot
  wide, so there is no "further out" to speak of yet, and it needs a distance the sim would compute
  per cast. The bridge rule gets most of the same feeling from a fact the sim already has.
- **Make sea fish worth more to the town**, so islanders earn more. That pays people to move, which
  is RFC 0038's job for the plot picker rather than for fishing, and it is the one version of this
  that changes the coin numbers.

## Open questions

1. **Should the town buy any sea fish?** The recommendation is no for the first version. If yes,
   which kind, at what price, in which season, and against which pond fish it would compete.
2. **Five kinds and a bridge fish, or fewer?** Each new kind is a catalog entry, a drawing, and a
   collection-book line forever. Three would be enough to make the shore different.
3. **The bridge-only rule.** Is a fish that bites only off a bridge worth the crowding risk above,
   or should `lanternfish` bite from any shore at night instead?
4. **Should the switch go on with the first island, or after its first week?** Going on together
   means islanders never see the pond's fish in the sea. Waiting means the first week's numbers
   aren't muddied by a second new thing.
