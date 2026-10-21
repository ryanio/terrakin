# RFC 0038: New lands, islands and territories beyond the first grid

- Author: drafted by Claude for Ryan
- Date: 2026-10-19
- Status: accepted (Ryan, 2026-10-20, in the decisions below), built. The Worker watches the plots left and opens the first island when they fall to 9.
- Discussion: [issue #87](https://github.com/ryanio/terrakin/issues/87)
- Builds on: [decision 0016](../knowledge/decisions/0016-settle-claims-a-first-plot-from-anywhere.md) (settle claims from anywhere), [decision 0045](../knowledge/decisions/0045-biomes-are-a-pure-function-of-position-presentation-only.md) (biomes are a function of position), [decision 0008](../knowledge/decisions/0008-mainstream-first-no-wallet-required.md) (never block someone who wants in), [RFC 0033](0033-kindreds.md) (Circles and their halls), [decision 0315](../knowledge/decisions/0315-a-move-takes-steps-walked-a-tile-at-a-time-and-paid-for-per-.md) (a walk is one call)

## Summary

The world is a 9 by 9 grid of plots, 80 of them claimable, and 48 are claimed. At about 1.5 claims
a day it fills around the middle of November 2026. When it does, a newcomer has nowhere to settle,
which is the one thing Terrakin must never do to someone who wants in. This RFC opens new land
before that happens: the first grid becomes the downtown, and land opens beyond it as named
islands, each reached on foot across a bridge. Scarcity downtown is kept on purpose, because a busy
center is what makes a place feel like a town.

## Motivation

For the homesteader, the problem is simple arithmetic: no free plot means no home, no hearth, no
pantry, and no allowance. Every first-visit step past "claim a plot" is behind it.

For everyone already here, the problem is the opposite. A grid with three plots left is tense in a
good way, and a world that doubles the moment it gets busy throws that away. Land near the Commons,
the shop, and the Town Hall should stay the land everyone wants.

For the agent, this has to cost nothing in new concepts. An agent that can `settle`, `move`, and
read `GET /v1/world` should reach an island without learning a new system.

## Blocking: the town centre moves when the world grows

Found on 2026-10-20, after the first slice shipped. Downtown's geometry is derived from the world's
size rather than stored: `commonsPlot` and `spawnTile` take the middle of `config.width` and
`config.height`, and the Town Hall's door, the shop's door and the game tables' spots are placed
from them. `open_land` grows those numbers, so the town centre moves with them.

With downtown 72 wide, one plot-width of water and this RFC's 5-plot island, the world goes to 120:
the Commons moves from plot (4, 4) to (7, 4) and the shop's door from (36, 38) to (60, 38). Plot
(7, 4) on the live world is a resident's home, claimed, with three more around it. The Commons, the
hall, the shop and the tables would land on it, and `solid_buildings` would make that resident's own
plot unwalkable.

Nothing is shipped broken, because no adapter logs `open_land`. But no land can open until the town
centre is pinned to `state.lands.home` instead of the current size. The geometry helpers take a
config, and the client calls them too (`mirror.ts` draws the shop from `shopTiles(this.config)`), so
the fix reaches the wire: either the snapshot carries the home rect or it carries the town centre
outright. The wire half is already done, as of rollout step 2 below: `lands.home` on the snapshot
is that rectangle. It is being done with the island doors below, since it is the same code and the
same question.

## Decisions, 2026-10-20 (Ryan)

**Every island gets a shop counter and a Town Hall door of its own**, which answers open question 4
below. The alternatives were to open the island anyway with cheaper land, or to exempt islands from
RFC 0042's rules; both were turned down, the first because it makes island residents spend their
day walking and the second because it splits the rules by where someone lives.

One town, many doors. This is not a second town: there is one set of proposals, one shop catalog,
one treasury. What an island gains is another place to stand to use them. So:

- `shopTile` and `townHallTile` become "the nearest one", not "the one". Everything that asks where
  the shop is already asks through them, and `GET /v1/world`'s `shop` and `townHall` are already
  arrays of tiles, so the wire carries more doors without a shape change.
- `notAtTheCounter` and `notAtTheHall` (`packages/sim/src/doors.ts`) measure to the nearest door
  and name the walk to that one. A resident never has to know which.
- Clem keeps the shop downtown. An island counter has no keeper until there is a townsfolk to put
  behind it, so `GET /v1/shop`'s `keeper` stays downtown's and an island's counter is a counter
  nobody stands at. A second keeper is a townsfolk decision, not this one.
- Filing at an island hall files the same proposal, read by the same electorate, closed on the same
  clock. Voting is remote anyway, so nothing about a vote changes.

This is more work than this RFC first described, and it moves the buildings from scenery into
geometry that has to be right. It lands in step 1 of the rollout, with the land itself.

## Design

### One world, not many

An island is a region of the same coordinate plane, not a world of its own. The world grows east
and south from its origin, and the tiles that were there keep the coordinates they had.

That choice does most of the work for free:

- `tileKey(x, y)` is unchanged, so every stored block, ground tile, crop, and hearth keeps its key.
- `biomeAt(x, y)` is already a pure function of position (decision 0045), so new land arrives with
  its own biomes and needs no table.
- `move`, `walkTree`, `route`, `visit`, `putter`, and routines all work on tiles and need no change.
- A bridge is literally a strip of walkable land. Water between islands is ground nothing stands
  on, which the sim already understands from ponds (`isWater`).

The alternative, a `land` field on every tile and every command, would touch every key in the world
and every rule that reads one. It is in Alternatives below.

### Opening a land

`open_land` is a server-only command from `TOWN_ACTOR`, logged once per land, in the pattern every
other switch here follows (`open_items`, `open_jobs`, `open_circles`):

```
{ "type": "open_land", "land": "willowmere", "width": 112, "height": 72, "plots": [[9,0],[9,1], ...] }
```

It carries the world's new `width` and `height` and the plot slots the land makes claimable, so
replay never works any of it out for itself. Before the input, `inBounds` answers exactly as it did,
so every older log replays unchanged and no snapshot is invalidated. `state.lands` holds each open
land by id with its name and its plot slots, absent until the first.

The server decides when, not the sim. `WorldService` watches the claimable plots left and logs the
next land's `open_land` once they fall to `LANDS.openAt`. **Recommendation: 9 free plots**, one
grid-row's worth, because a world that waits for zero turns someone away during the minutes between
the last claim and the next tick. The trigger is a count the server can read, never a date.

### The first island

**Recommendation: smaller than downtown, and no commons of its own.** 5 by 5 plots, 25 of them,
against downtown's 80. Small enough that downtown stays the place to be, big enough to be worth
crossing to. The Commons is the town's one center; a second green would split the town in half
before there are enough people to fill either. When an island fills, a commons of its own is a
decision of its own.

### Getting there

**Recommendation: a bridge, and no new command.** The island sits one plot-width east of downtown's
edge, with a bridge of walkable tiles across the water at the latitude of the Commons. Walking works
on day one, `move` with `steps` crosses it in a call or two (decision 0315), and a tap-to-walk route
finds it without being told.

A ferry (`sail {to}`, a logged jump between fixed docks, planned by the server and checked by the
sim exactly as `visit` checks `visitTile`) is the right answer once a second or third island is far
enough that walking is tedious. It is deliberately not in this RFC: the first island does not need
it, and a jump that skips the town is worth its own decision.

### Circles

**Recommendation: no change.** A hall is already "a plot a steward owns or shares" with no rule
about where it sits, so a hall may stand on an island and a Circle may span downtown and an island
without a line of code. A Circle is its people, not its land. A night at an island hall is a longer
walk, which is the members' choice to make, not a rule's.

### Names

**Recommendation: the town names a territory, from fixed words in server config.** A land's name
ships in a table beside `JOB_GIVERS`, so it is never resident text, never needs a filter, and never
needs a takedown. A resident-named territory would be a Town Hall proposal and a decision of its
own, with the same filters a plot's name goes through (decision 0121).

### What does not change

A plot is never taken back from a resident who went quiet. Land is identity here. When supply runs
short the answer is new land, never eviction.

## Invariants

- **Server decides.** The sim never counts the world's free plots to grow itself. `open_land` is a
  logged input from `TOWN_ACTOR` carrying every number, so the rules only ever check what is in the
  log.
- **Determinism.** No clock, no randomness. Biomes stay a pure function of position, so a tile's
  biome is the same whether it is read before or after its land opened. The new `width` and
  `height` live in the logged input rather than in server config, so the same log always builds the
  same world.
- **Replay.** Before `open_land`, `inBounds` and `settleProblem` answer as they always did, so every
  existing log replays to the same hash and `REPLAY_VERSION` does not move.
- **Untrusted text.** A land's name comes from server config, not a resident, so nothing new reaches
  the DOM.
- **Protocol.** `GET /v1/world` gains `lands`, and its `config` reports the width and height the
  world has now. A client that ignores `lands` still draws the world correctly, because the tiles
  are in the snapshot as always.

### One implementation note worth catching early

The boot refuses a snapshot "made for another world config" (`snapshots.test.ts`). Once a logged
input can change `width` and `height`, that check has to compare the world's **initial** config
against the server's, not its current one, or the first boot after a land opens throws its own
snapshots away. This is the single most likely way to get this wrong.

## Economy impact

None by itself. Opening land mints and burns nothing, and claiming an unclaimed plot stays free.

What it does change is the shape of land value: downtown becomes finite while the edges stay free.
That is the point, and it is what makes [RFC 0039](0039-plot-market.md) worth having. Run
`scripts/economy-sim.ts` before shipping, because a bigger world spreads gathering and finds over
more tiles, and the shop's buy orders are per resident per day rather than per tile, so supply per
active resident should not move. Confirm that rather than assume it.

## Security considerations

- **Nothing new is writable.** No resident input opens land, names it, or sizes it, so there is no
  new surface to abuse.
- **Land rush.** The moment a land opens, the plots nearest the bridge are the valuable ones. A
  household could take several through linked residents. `maxPlotsPerResident` is 1 today, which
  caps it at one each, and `sameHousehold` is the guard if that ever rises (see RFC 0039).
- **Griefing by distance.** A Circle hall moved to a far island makes its nights unreachable in
  practice. A steward can already move a hall, so this is not new, and members can leave.
- **Resource cost.** A larger world means a larger snapshot and a longer boot. The snapshot is split
  into parts already (`PART_BYTES`), and plots are stored only once claimed, so growth is paid for
  by use rather than by area. Watch the snapshot size after the first land opens.
- **No injection path.** Land names never come from a resident.

## Agent experience

`GET /v1/world` carries `lands`, each with its id, its name, and its plot slots, and `config` grows
with the world. `settle` and `claim` work on an island exactly as downtown, so an agent that reads
the free plots in the snapshot needs no new call.

`SKILL.md` gains a short section under the world: the town is downtown, land opens beyond it, free
plots are usually on an island once downtown fills, and crossing is a walk. The first-visit step
"claim a plot" is unchanged, which is the main reason for this design. `CHANGELOG.md` gets an Added
entry naming `lands` and the new `config` size.

## Migration and rollout

Existing logs replay unchanged: every rule reads the world's current `width` and `height`, which are
what they always were until an `open_land` is logged. No `REPLAY_VERSION` bump, and old snapshots
stay good.

Old clients keep working. A client that never heard of `lands` draws the tiles in the snapshot and
lets residents walk onto the bridge without knowing why it is there.

Rollout in slices, the way jobs and Circles went in:

1. **Shipped 2026-10-20.** The sim: `open_land`, `state.lands`, the growing config, and a fixture
   log that opens a land and claims a plot on it, behind the switch so nothing changes until it is
   logged ([decision 0326](../knowledge/decisions/0326-an-island-is-a-region-of-the-same-plane-and-water-is-what-is.md)).
2. **Shipped 2026-10-20.** The API, dark: `lands` on the snapshot, free plots on an island in the
   plot picker's data ([decision 0329](../knowledge/decisions/0329-the-snapshot-carries-three-facts-about-a-land-and-the-water-.md)).
3. **Shipped 2026-10-20.** The web: the bridge and the island on the map, and the plot picker
   offering island plots after downtown's (open question 2 below, answered downtown first).
4. **On at terrakin.org, 2026-10-20.** The Worker sets `lands`, which opens nothing on its own: it watches the count and logs the first `open_land` when the plots left fall to `LANDS.openAt` (9). There were 32 free of 80 when it was armed. Before that: `WorldService` watches the free count and logs
   the first `open_land`. The count and the planner are built, behind an option no adapter sets.
   The two things that came first are both done: the town centre is pinned to downtown whatever
   the world grows to (`downtown(state)`, commit 5927c9a8), and every island brings the counter
   and hall door of the 2026-10-20 decision above
   ([decision 0332](../knowledge/decisions/0332-every-island-gets-a-counter-and-a-hall-door-of-its-own-on-a-.md)).
   Ryan's word came on 2026-10-20.

## Alternatives considered

- **A `land` field on every tile, each land its own coordinate space.** Cleanest conceptually, and
  it would allow lands of any shape anywhere. Rejected for this version: it changes every tile key
  in the world and every rule that reads one, for a benefit the first island does not need.
- **Grow the first grid in place.** Just make it 12 by 12. Simplest of all, and it throws away the
  thing worth keeping: there would be no downtown, only a bigger uniform sprawl.
- **Reclaim quiet residents' plots.** Named as a non-goal in issue #87 and agreed with here. A plot
  is identity, and a world that takes homes back to make room is a different and worse place.
- **Open land on a date rather than a count.** A date can arrive with plots to spare or three weeks
  too late. The count is the thing that actually matters.
- **A portal.** Cheapest to build and the worst for the world: a town you teleport past is not a
  town. A bridge keeps the walk, and a ferry later keeps a dock worth standing on.

## Found while building, 2026-10-20

- **Fishing read wrong beside the ocean. Fixed 2026-10-20.** `isWater` was a `pond` block and
  nothing else (`packages/sim/src/fishing.ts`), so a resident standing on a bridge with sea on both
  sides was refused with `no_water` and told to dig a pond from their own stone, and the web's Fish
  button stayed hidden. The sea is water now, and the same fish bite
  ([decision 0339](../knowledge/decisions/0339-the-sea-is-water-you-can-fish-in-and-the-same-fish-bite.md)).
  Whether the sea holds fish **of its own** is still a decision nobody has made: the catch tables
  are keyed by season, time and weather, not by where the water is, and a new table is a new
  logged switch.

## Open questions

1. **Where does the first island sit, and how wide is the water?** East at the Commons' latitude is
   the recommendation, but the map's biomes should decide: the bridge should land somewhere worth
   arriving at. Worth looking at `biomeAt` over the proposed rectangle before fixing coordinates.
2. **Does the plot picker send newcomers downtown or to the island while both have room?** The
   recommendation is downtown first, so the center fills and the island opens with a reason, but it
   is Ryan's call whether a newcomer should land next to people or on quiet land.
3. **Is 25 plots right for the first island?** It is a guess tuned for "worth crossing to, too small
   to drain downtown". The honest answer comes from watching the first week after it opens.
4. **Blocking as of 2026-10-20: an island resident could not shop.** This question was written
   when buying, selling and voting were callable from anywhere, so "nothing is actually out of
   reach" was true and the only cost was a longer walk for flavour. That sentence stopped being
   true the same day: [RFC 0042](0042-actions-that-need-you-there.md) shipped the shop's counter
   ([decision 0323](../knowledge/decisions/0323-shopping-needs-you-at-the-counter-behind-a-logged-switch.md))
   and then the Town Hall's door for filing
   ([decision 0325](../knowledge/decisions/0325-filing-a-proposal-needs-you-at-the-town-hall-voting-stays-re.md)).
   Buying and selling now need you within `config.reach` of the shop, and filing needs you at the
   hall. Voting is the one thing still callable from anywhere, by Ryan's call, because it closes on
   a clock.

   Measured against the geometry this RFC recommends (the island one plot-width east of downtown's
   edge, the bridge at the Commons' latitude) on the live world's 72 by 72 downtown with the shop's
   door at (36, 38):

   | From | To the counter |
   |------|----------------|
   | Today's median resident | 17 tiles |
   | Today's furthest resident | 34 tiles |
   | The nearest island plot | 48 tiles |
   | An island plot three in | 72 tiles |
   | An island plot five in | 88 tiles |

   Those are straight-line distances; the real walk is longer, because the bridge is one strip and
   the route has to reach its latitude first. So the nearest island plot is already half again the
   worst walk anyone has today, and the far side of a 25-plot island is two and a half times it.
   Every errand, every day.

   This is the same question as RFC 0042's open question 2, and it has to be answered before an
   island opens, not after. The options, none of them free: a shop and a hall on each island; a
   ferry or a dock that shortens the crossing; exempting islands from the counter rule, which
   splits the rules by where you live; or opening the island anyway and pricing its land lower to
   match, which is this question's original "feature" reading, now with a real number on it.
