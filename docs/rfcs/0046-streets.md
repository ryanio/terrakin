# RFC 0046: Streets, so every home has a way to town

- Author: drafted by Claude for Ryan
- Date: 2026-10-22
- Status: draft
- Discussion: [issue #100](https://github.com/ryanio/terrakin/issues/100)
- Builds on: [decision 0351](../knowledge/decisions/0351-a-plot-s-way-out-is-a-step-from-its-hearth-s-walk-onto-groun.md) (what a way out is), [decision 0354](../knowledge/decisions/0354-a-settle-or-claim-says-when-it-takes-a-neighbor-s-last-way-o.md) (claims warn, pickers prefer plots that close nobody in), [RFC 0038](0038-new-lands.md) (new lands), [decision 0341](../knowledge/decisions/0341-new-lands-are-armed-at-terrakin-org-the-worker-watches-the-c.md) (lands are armed), [decision 0352](../knowledge/decisions/0352-an-island-s-presence-is-its-shop-counter-town-hall-filing-stays.md) and [decision 0353](../knowledge/decisions/0353-an-island-s-hall-building-stays-standing-and-takes-no-filing.md) (shop on the island, filing downtown), [decision 0343](../knowledge/decisions/0343-staff-can-clear-a-block-off-a-plot-to-open-a-way-out-of-a-home.md) (staff clear a block), [RFC 0039](0039-plot-market.md) (the plot market), [RFC 0042](0042-actions-that-need-you-there.md) (the shop needs you there)

## Summary

The town has no streets. Plots sit side by side, and the only public ground downtown is free slots and the Commons. 18 of 53 claimed plots have no way out, and the Commons itself is closed in: every slot around it is claimed, so nobody reaches the shop or the Town Hall without crossing someone's yard.

This RFC proposes two things. New lands get streets in their layout before the first island opens: whole plot slots nobody can claim, logged in `open_land`, laid out so every plot has a side on a street that joins the bridge and the island's counter. Nobody owns island land yet, so this costs no one anything, and it has to land before the first `open_land`, which at the current claim rate is one to two weeks away.

Downtown, where all 80 slots are fixed, the RFC lays out the options with measured costs and recommends public ways: a logged rule that keeps a one-tile strip along a plot's edge clear of blocks, starting on the townsfolk's own land and reaching residents' plots only with the owner's yes.

## Motivation

Since RFC 0042, buying and selling need you at the counter and filing needs you at the Town Hall. A home with no walk to town is now worse off than before: its owner can't shop or file, and their agent hears about it in the check-in.

Today every hearth still walks to the counter, but only because neighbors leave their yards open. Decision 0351 defined a way out as a step onto ground nobody has claimed, so that "open" means something a neighbor can't take away. By that test the numbers are bad, and they are about to get worse in a new place: the first island, as planned, puts two private plots between the bridge and the island's counter.

This matters to every persona. A homesteader can be shut in by a neighbor's wall. A host's guests cross yards to arrive. An agent that settles in good faith on a free slot can be landlocked by the next claim beside it. And every island resident walks home to the island's counter for shopping, and home to the bridge and on to downtown's Town Hall for filing, so on an island both walks have to be public.

## Measured today

Every number here was measured on 2026-10-22 from the public `GET /v1/world` (53 claimed, 27 free, 40 hearths) with the sim's own `stepFrom`, `openingsOf` and `landlockedFrom`. The scripts were scratch work and are not in the repo.

### Downtown

```
     0 1 2 3 4 5 6 7 8
  0  # . . . . . . . T
  1  # # # # # # # # #
  2  . # L L L L L L L
  3  . # L # T L L L L
  4  . # L T C T L # T      L  landlocked
  5  . # L L T T # # .      T  townsfolk
  6  . # # # L L # . .      #  resident, with a way out
  7  . . . # # # # . .      .  free
  8  T . . . # . . . .      C  the Commons
```

- 18 of 53 claimed plots are landlocked: 16 surrounded, 2 walled ((5, 3) and (3, 5)). Issue #100 counted 14 and 4 at 51 claimed; it is the same 18 plots, and two claims since then turned (2, 5) and (5, 6) from walled into surrounded.
- The Commons is closed in. The open ground you can walk to from the spawn tile is 52 tiles, all inside the Commons. All eight slots around it are claimed, five of them by townsfolk: (4, 3), (3, 4), (5, 4), (4, 5) and (5, 5).
- Every one of the 40 hearths walks to the counter across yards. Walking only on its own plot and ground nobody has claimed, 1 does. Counting the townsfolk's yards as public too, 11 do.
- Of the 27 free plots, 21 close nobody in when claimed (decision 0354's test).
- The bridge to the first island lands on (8, 4), a townsfolk plot. From there to the Town Hall's door is 38 steps today, across (8, 4), three residents' yards ((7, 4), (7, 5), (6, 5)), and (5, 5).

### Pace

Decision 0341 counted 48 claimed and 32 free on 2026-10-20. Two days later it is 53 and 27. The first island opens when free downtown plots fall to 9 (`LANDS.openAt`), 18 claims from now: about 12 days at the 1.5 a day RFC 0038 used, about 7 at the last two days' 2.5. That is early November, not mid November, and it is the deadline for anything in the island layout.

### The first island as planned

`planLand` (`packages/server/src/lands.ts`) lays a 5 by 5 island at plot columns 10 to 14, rows 2 to 6, with its square in the middle at (12, 4) and a two-tile bridge from x 72 to 79 at y 36 and 37. The bridge lands on plot slot (10, 4).

Filled, with nothing built:

- 15 of its 24 plots are surrounded. The 8 around the square touch it; the outer ring touches only plots and sea, except (10, 4), which touches the bridge.
- None of the 24 has a public walk to both the island's counter and the bridge. Every walk from the bridge to the counter crosses (10, 4) and (11, 4). Whoever claims (10, 4) can close the island off from downtown with a wall on their own land.

## Design

### Part 1: streets on new lands

#### What a street is

A street is a plot slot that belongs to a land, is ground rather than sea, and that nobody claims or builds on. It is the same kind of thing as a land's square, without the buildings, and there can be many.

- `open_land` gains an optional `streets: [px, py][]`, sorted, like `plots`. The planner works it out; replay never does. A land opened without it has none, so the two fixture logs that open a land replay as they did.
- `landedFrom` counts a street as land, so `seaFrom` doesn't make it water and the web draws it from the snapshot like the rest.
- `settle` and `claim` refuse a street, the way they refuse a square, with words that say it is the island's street and name the nearest free plot.
- `plotsLeft` and `landPlots` leave streets out, as they leave out squares.
- `nearestFreePlot`, the plot pickers and `settleProblem` skip streets.
- The lookups that ask which land a slot is on (`landOfPlot`, `landOfSquare`, what `nearestCounter` and `nearestPark` read) count a street as its land's, so someone standing on an island street is sent to that island's counter and green.
- `checkOpenLand` holds a street to the rules a plot slot meets (in the new bounds, not on land already, not under the bridge), and its square rule changes in one place: the square must touch its land side on, where "its land" now means its plots or its streets. In the recommended layout the square sits where streets cross, with no plot beside it, so this change is required, not optional.

Nothing can be built on a street: placing, laying and building all need a plot you own or share, and a street is nobody's. Branches and stones lie there, and anyone may gather them, as on a free slot. Nobody body-blocks a street either, since `stepFrom` never counts a resident as an obstacle.

`openings.ts` needs no change. A street is an unclaimed slot, which decision 0351 already counts as open ground.

#### Sim rule or layout data

Both, split the way RFC 0038 split lands. Which slots are streets is layout data: the server's planner decides, and it goes into the logged `open_land`, so a better planner later can never change how a logged land replays. What a street is (land, unclaimable, unbuildable) is a small sim rule in `packages/sim/src/lands.ts` and `world.ts`.

#### Why whole slots

The sim's whole model is that a plot is its slot: `plotOf` is a division, every rule that asks "is this tile on that plot" asks it that way, designs are 8 by 8 maps that turn in quarters (RFC 0032), and plot photos, roofs, the map and visits all read a plot as its 8 by 8 square. A lane inside a slot would need a tile that is in a plot's slot but not on the plot, and every one of those readers would have to learn it. The costs side by side:

| Lane | Plot area kept | Every plot on a lane | Sim cost |
|------|----------------|----------------------|----------|
| One tile around every slot (two-tile lanes) | 36 of 64 tiles, 56% | yes | a plot smaller than its slot, in every rule and view; 8 by 8 designs no longer fit |
| One tile on two sides of every slot (east and south) | 49 of 64, 77% | yes | the same, and plots of two sizes at the island's edge |
| One tile taken from the upper plot every two rows, plus a joining lane | 56 or 64 (94% on average) | yes | the same, with plots of two shapes |
| Whole street slots, rows of plots on both sides | every plot keeps 64 | yes | one new kind of slot, listed in `open_land` |

On an island, land is not scarce: the planner decides how big it is, and growing it by a few slots costs nothing anyone owns. A plot that loses a sixth of its tiles is a loss to every resident who settles there, forever. So the RFC spends land, not plot area.

#### Layouts

Measured with the sim's own walk on an empty, fully claimed island, with the bridge as `LAND_PLAN` has it. "Public walk" means walking only on your own plot, streets, the square and the bridge. Steps are from a tile near a plot's middle to within reach of the island's counter, and to the bridge's island end.

| Layout | Plots | Street slots | Landlocked when full | Public walk to counter and bridge | To counter, median and most | To the bridge, median and most |
|--------|-------|--------------|----------------------|-----------------------------------|-----------------------------|-------------------------------|
| A. Today's plan, 5 by 5 | 24 | 0 | 15 | 0 of 24 | none | none |
| A with its middle row and column as streets | 16 | 8 | 4 | 12 of 16 | 12, 16 | 28, 37 |
| One main street at the bridge's row, plots both sides, 12 long | 24 | 11 | 0 | 24 of 24 | 22, 45 | 53, 93 |
| Two streets joined by a spine, 7 by 6 | 26 | 15 | 0 | 26 of 26 | 22, 40 | 52, 61 |
| A long cross, 7 by 9 (recommended) | 24 | 14 | 0 | 24 of 24 | 18, 32 | 44, 53 |
| A canal: the main street as water, boardwalks on both shores | 24 | 0 (11 water slots) | 0 | 24 of 24 | 24, 48 | 55, 96 |

The long cross, with the bridge (`=`) arriving on its west street and the square (`Q`) where the streets cross:

```
      9 10 11 12 13 14 15 16
  0   ~  ~  ~  P  S  P  ~  ~
  1   ~  ~  ~  P  S  P  ~  ~
  2   ~  ~  ~  P  S  P  ~  ~
  3   ~  P  P  P  S  P  P  P
  4   =  S  S  S  Q  S  S  S
  5   ~  P  P  P  S  P  P  P
  6   ~  ~  ~  P  S  P  ~  ~
  7   ~  ~  ~  P  S  P  ~  ~
  8   ~  ~  ~  P  S  P  ~  ~
```

Every plot has a whole side on a street, so no neighbor's block at a corner can close it. The bridge lands on a street, so the walk home to the bridge never crosses a yard. The square is the hub, so the walk to the counter is short: no plot is more than 32 steps from it. The island keeps 24 plots, as RFC 0038 planned, and fits inside downtown's nine rows, so the world grows east only.

Its cost is 14 street slots of land, so plots are 24 of the 39 slots the island uses (62%), and the island is a plus shape with sea in its corners. The main-street layout keeps a rectangle at 67%, but its far plots are 93 steps from the bridge.

The canal layout needs no new sim concept: a water slot is already unclaimable, and bridge tiles are already open ground. It lost because a boardwalk has to run along both shores of every canal and join at the ends, which for one 12-slot canal is 204 bridge tiles, over `LANDS.bridgeMax` (200), and two canals can't cross without more bridges. It is the fallback if streets can't be built in time (see Open questions).

#### The planner's check

`reaches` in `packages/server/src/lands.ts` walks from the Commons to every slot today. Today's plan passes it, and leaves 15 plots surrounded once the island fills. The check grows by one test: with every plot of the new land counted as claimed, every plot slot has a way out (`openingsOf`, walked from every tile, as a claim's notes walk a plot with no hearth) onto a street, the square or the bridge, and that ground joins both the island's counter and the bridge without crossing a plot. A plan that fails opens no land and says so, as it does now.

#### The rest of the trip to file

An island resident files downtown. The downtown leg, from the bridge landing on (8, 4) to the Town Hall door, crosses five claimed slots today. Streets on the island don't fix that; Part 2 does, and the bridge landing is the first place it should reach.

### Part 2: downtown

All 80 slots are fixed and 53 are claimed, so anything here takes something from someone or waits for someone to agree. These are the options, with what each would cost against today's world.

The right-of-way and public-slot numbers come from a greedy search: it joins the cheapest plot first and repeats. A better search may find a smaller answer; these are upper bounds, not optimums.

#### Option 1: a public way along a plot's edge

The plot stays its owner's, but a set of its edge tiles becomes a way: nothing that stops a walker may stand there. Paths and flooring are fine, and the owner can still build upstairs over it, which makes a covered passage.

- A server-only `open_way {tiles, reason}` from `TOWN_ACTOR` adds tiles to `state.ways` (absent until the first). It is refused while any of those tiles holds a block, so staff clear them first with `clear_block` (decision 0343), which gives everything back to the owner. Nothing anyone owns is lost. `close_way` takes tiles off.
- From then on, `place`, `build`, `build_starter_home` and a Town Hall build refuse a block on a way tile, with a new code such as `public_way`. A door and the seats you walk onto pass walkers, but a door may one day lock and stairs make a stairwell, so a way holds no block at all.
- `openingsOf` counts a step onto a way tile as open ground, which amends decision 0351's definition. The nightly check reads `ways` from the snapshot.
- A listed plot is frozen (decision 0344), so `open_way` is refused on one and joins the freeze table in `plot-market.test.ts`.

Measured costs, each a one-tile strip along plot edges:

| Goal | Tiles | Resident plots that give tiles | Most from one plot | Townsfolk tiles | Blocks in the way |
|------|-------|-------------------------------|--------------------|-----------------|-------------------|
| A way out for the 18 landlocked plots, onto any open ground | 111 | 11 | 14 | 22 | 6 |
| The bridge landing joined to the Commons | 27 | 3 ((4, 6), (4, 7), (4, 8)) | 8 | 10 | 0 |
| Every plot and the bridge landing joined to the Commons | 147 | 14 | 15 | 20 | 6 |

No hearth stands on any of these tiles. The last row is the one that gives everyone a public walk to the shop and the hall, and it touches 14 of the 45 residents' plots, taking 9 tiles of 64 from each on average.

What it costs the owner is room along one edge. What it gives the town is a guarantee nobody can take back with a wall. It is a rule change behind a logged input, so every older log replays as it was.

#### Option 2: the town buys back a strip

A slot can't shrink in this model (see "Why whole slots"), so a strip bought back is Option 1 with a payment: the treasury pays the owner for each way tile on their plot. It mints nothing. It is fairer to the owner and costs the treasury; the price per tile is a number Ryan would set, and `scripts/economy-sim.ts` should run with it before it ships.

#### Option 3: a whole slot made public

The town takes a whole claimed slot and makes it a street, the same kind of slot as Part 1, through a server-only `make_street {px, py}` that is refused unless the slot is unclaimed and empty. So the owner has to leave first.

- For openings alone, 6 residents' slots would do: (7, 3), (3, 2), (3, 5), (5, 3), (6, 5) and (2, 5).
- For every plot to open onto ground joined to the Commons, it took 11 slots, 9 of them residents': (5, 5), (6, 5), (4, 7), (1, 1), (3, 3), (5, 1), (6, 2), (7, 3), (5, 4), (3, 5), (2, 5). Even then the bridge landing on (8, 4) is not joined.
- The townsfolk's own slots go furthest for least: making (4, 3), (3, 4), (5, 4), (4, 5), (5, 5) and (8, 4) streets turns the Commons into a plus and leaves 8 plots landlocked, with nobody but the townsfolk moving. Joining everything else to it after that takes a way of 77 tiles from 13 residents' plots.

Moving a resident off a slot means taking their home apart: `release` refuses a plot with anything on it, and their things come back into an inventory with a cap. There is no command that moves a home with its blocks, floors, crops, roof and name. That would be an RFC of its own.

#### Option 4: voluntary swaps and moves

A landlocked owner could move to one of the 21 free plots that close nobody in, or to an island street plot once Part 1 ships. Two things limit it.

- It moves people, not geometry. The slot they leave is free ground for its neighbors only until the next claim, which decision 0354 warns about but never refuses.
- Without a move command, moving means rebuilding from nothing.

The plot market (RFC 0039) bears on this in three ways. It sells a plot frozen as it stands and moves only the owner, so a sale passes a landlocked plot to a buyer without fixing it; the listing should say so, from `openingsOf`. It gives an owner who wants out a way to recover something for what they built. And it is dark today and opens after the first island: ways announced after listings exist would change a plot under its buyer, so any downtown way should come before `open_plot_market`, not after.

#### Option 5: a staff-carved path

Staff can already clear a block (decision 0343), but only to open a walk to the counter, and only one block at a time. Every hearth walks to the counter today, so there is nothing for it to clear: the surrounded plots aren't shut, they are open at a neighbor's pleasure. A path staff carve by hand has no rule behind it, and the owner can put the wall back the next minute. It is the right tool for the 2 walled plots and the wrong one for the 16 surrounded.

#### Option 6: do nothing

Every hearth walks to town today, the check-in names the neighbor's block when one is shut (decision 0346), staff can clear one, and claims now warn before they close someone in (decision 0354). The count may stop growing.

What it leaves: the 18, the Commons closed in on all sides, and a public trip to file from an island that crosses five yards downtown. Most walks to the counter already cross a townsfolk yard, so in practice the townsfolk's land is the town's street today, by habit rather than by rule.

## Recommendation

1. Put street slots in `open_land`, lay the first island as the long cross, and extend the planner's check, all before the first island opens. This is the one part with a deadline, and the one part that costs nobody anything.
2. Downtown, ship public ways (Option 1) and lay the first ones on the town's own land: the townsfolk's yards and the strip the bridge landing needs, since the team runs the townsfolk and no resident gives anything up. Then offer ways to residents one plot at a time, only with the owner's yes, paid from the treasury (Option 2), and before the plot market opens.
3. Leave residents' whole slots (Option 3) and moving homes (Option 4) for later. Both need a move command that doesn't exist, and both take far more from fewer people. The townsfolk-slot variant of Option 3 stays the alternative if Ryan would rather move the townsfolk than run ways through their yards.

## Invariants

- The server decides. It plans where streets go and logs them in `open_land`, and it logs which tiles are ways in `open_way`. The sim only checks what the log says.
- Nothing reads a clock or a random number. A street and a way are facts in the log, and the rules that read them are pure.
- Replay is unchanged. `open_land` without `streets` means none, and no live log holds an `open_land` yet, so the fixtures replay to the same hash. Ways don't exist until the first `open_way`. `openings.ts` is read-only and no rule reads it. `REPLAY_VERSION` does not move.
- No resident writes anything new, so no new untrusted text reaches the world. `open_way`'s reason goes to the moderation log, never the world log or the wire.
- `GET /v1/world` gains `streets` on each land and `ways` once there are any. A client that ignores them still draws every tile, though it draws a street as sea until it reads them. `settle`'s refusal for a street is a new code or new words, with a `CHANGELOG.md` entry either way.

## Economy impact

Streets mint and burn nothing.

A way bought back (Option 2) moves coins out of the treasury to an owner, under the treasury's reserve, with a ledger line, like a grant. Nothing is minted. The price per tile is open, and the economy run should see it first.

Streets do spread island land over more slots, which spreads gathering over more tiles. Pickups are per tile and the shop's buy orders are per resident, so supply per active resident shouldn't move; RFC 0038 already asks for the economy run when the first land opens, and it should run with streets in.

## Security considerations

- A street is nobody's, so nobody can wall it. No resident input creates, moves or removes one.
- A way is on someone's plot. The rule stops the owner from blocking it; it doesn't stop them from building upstairs over it or laying a path on it, which is fine. Neighbors can't place on another's plot, so nobody else can block it either.
- A way is not a grant: walking on someone's way gives no right to build, gather (`own_plot_pickups` still holds), or visit-count there.
- Grief by claim stays possible on downtown free slots: claiming the last free slot beside a neighbor. Decision 0354 warns; this RFC doesn't change that.
- An agent told by chat or a post to "claim the street" gets a refusal; nothing a resident writes becomes a street or a way.
- An island plot next to the bridge is no longer a choke point anyone can buy or claim, because the bridge lands on a street.

## Agent experience

`SKILL.md` gains two short lines under the world: islands have streets, which nobody claims and anyone walks; and downtown may have public ways, edge tiles of a plot that hold no blocks. A `settle` on a street is refused with the nearest free plot named, as a square is.

A build that puts a block on a way is refused, and its dry run says so, so an agent planning a design learns it before it spends anything. The design notes (`no_opening`, `seals_neighbor`) keep working, and fewer of them fire.

The nightly landlocked issue keeps its test. A second line could count plots that open onto ground joined to the Commons, which is the walk an agent actually needs; today that is 6 of 53.

## Migration and rollout

1. Before the first `open_land`. The sim: `streets` in `open_land`, `landedFrom`, the square rule, `settle` and `claim`, the pickers, the land lookups, and a fixture log that opens a land with streets and walks from a plot to the counter and the bridge. The server: `LAND_PLAN` and `planLand` lay the long cross, and `reaches` gains the way-out check. The wire and the web: `streets` on each land, drawn as ground, never offered as a plot.
2. Then, downtown: `open_way` and `close_way`, the build refusals, `openings.ts` reading ways, `ways` on the snapshot, and the freeze-table row. The first ways on townsfolk land and toward the bridge landing, through the staff route, after `clear_block` empties them.
3. Then, with residents: ways offered plot by plot, with the payment, before `open_plot_market`.

Nothing old replays differently at any step, and old clients keep working, though an old client draws island streets as water.

## Alternatives considered

- Lanes inside plot slots save land, but every resident on the island loses a share of their plot, and they break the rule that a plot is its slot, which designs, photos, roofs and every building rule rely on. See the table under "Why whole slots".
- Canals need no new sim concept, but one canal is over the bridge cap and they are awkward to branch. They stay the fallback.
- Counting townsfolk yards as open ground, by policy, is free and immediate, and gives only 11 of 40 hearths a public walk to the counter. It also rests on a promise rather than a rule.
- Refusing a claim that closes a neighbor in was ruled out by decision 0354: it changes which logged inputs are accepted and takes free land away from a newcomer.
- Reclaiming quiet residents' plots for streets was ruled out by RFC 0038: land is identity here, and the answer to a shortage is new land, never eviction.
- Waiting for the plot market doesn't help. It moves owners, not land, and a landlocked plot stays landlocked under its next owner.

## Decisions that would follow

None are recorded yet; each would be a record once Ryan answers.

- New lands are laid out with streets, logged in `open_land`, and the first island is the long cross.
- A land's planner refuses a plan where, fully claimed, any plot has no way out onto a street joined to the bridge and the counter.
- A public way is edge tiles of a plot that hold no block, opened by staff and counted as open ground (amending decision 0351).
- Which downtown land carries the first ways, and whether the townsfolk give whole slots or ways through their yards.
- What the treasury pays for a way on a resident's plot.

## Open questions

1. Is the long cross the island layout you want (24 plots, 14 street slots, a plus-shaped island), or the rectangle with one main street (24 plots, 11 street slots, longer walks)?
2. If streets aren't built when free plots reach 9 (early November at today's pace), should the town open today's 5 by 5 anyway, open the canal fallback, or hold the island and risk turning a newcomer away?
3. Downtown: may a public way run across a resident's plot only with that owner's yes, or may the town lay one by rule?
4. What does the treasury pay a resident for a way on their plot, per tile?
5. May the townsfolk give over their yards around the Commons and at the bridge landing, as ways through them or as whole slots with the townsfolk moving?
