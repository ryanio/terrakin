---
title: Every island gets a counter and a hall door of its own, on a square in its logged input
date: 2026-10-20
status: accepted
tags: [world, sim, lands, town-hall, agents]
---

# Every island gets a counter and a hall door of its own, on a square in its logged input

## Context

Two things shipped on 2026-10-20 and collided.

[RFC 0042](../../rfcs/0042-actions-that-need-you-there.md) moved buying, selling and filing onto the
map: you have to be within `config.reach` of the shop's counter to trade ([decision 0323](0323-shopping-needs-you-at-the-counter-behind-a-logged-switch.md))
and at the Town Hall's door to file a proposal ([decision 0325](0325-filing-a-proposal-needs-you-at-the-town-hall-voting-stays-re.md)).
Then [RFC 0038](../../rfcs/0038-new-lands.md)'s first slice gave the world land beyond downtown
([decision 0326](0326-an-island-is-a-region-of-the-same-plane-and-water-is-what-is.md)): an island,
the water round it, and a bridge.

Measured against that RFC's own geometry on the live 72 by 72 world, an island resident would stand
48 tiles from the shop's counter at the nearest island plot and 88 at the far side, against a median
of 17 and a worst case of 34 downtown. A day's walk to buy a seed. The alternatives Ryan turned down
on 2026-10-20 were opening the island anyway with cheaper land, which makes its residents spend
their day walking, and exempting islands from RFC 0042, which splits the rules by where someone
lives.

## Decision

**One town, many doors.** Every land the town opens brings a square: one plot slot of its own ground
where its Town Hall door and its shop counter stand, laid out exactly as downtown's Commons, with
the hall one row in from the square's north edge and the counter one row in from its south edge.

It is one town either way. One set of proposals, read by the same electorate and closed on the same
clock; one shop catalog, one set of prices, one treasury share. What an island gains is another
place to stand to use them. Clem keeps the counter downtown, and an island's counter has nobody
behind it until there is a townsfolk to put there, which is a townsfolk decision, not this one.

Four choices inside that are worth writing down.

**The square is in the logged input, not worked out from the plots.** `open_land` carries
`square: [px, py]` beside `plots` and `bridge`, and the sim checks it: inside the world the land
makes, on no land already, not one of this land's own claimable plots, never under the bridge, and
touching the land side on, so its buildings are never a rock in the sea that no walk reaches (a
diagonal step past two corners of water is refused). RFC 0038's own invariant is that everything
geometric arrives in the logged input, so a better planner can place the next land's square
differently without changing how this one replays. Deriving it instead, say as the slot nearest the
middle, would have made the choice a rule: changing the rule later would move the buildings of every
land already open, and the logged `plots` would no longer mean what it says, since one of them would
quietly stop being claimable.

**The square is never claimable, and that is what keeps it off a resident's plot.** It is not in
`plots`, so `landPlots` leaves it out and the count that decides when the next land opens is
unchanged. `settleProblem`'s `plot_is_commons` case became `plot_is_square`, `claim` asks the same
question of the tile you stand on, and both answer with the Commons' own rejection code and words
that name the land ("That's Willowmere's square, where its own hall and counter stand."). `onLand`
counts it, so it is ground rather than sea: a resident walks there and stands at the counter.

**Which door you are sent to is the land you stand on, then the nearest.** `nearestHall` and
`nearestCounter` in [`packages/sim/src/doors.ts`](../../../packages/sim/src/doors.ts) pick the
square of the land under your feet, the nearest of those if a land ever has more than one, and the
nearest of all when you stand on no land, which is a bridge tile. Nearest is reach's own distance,
ties north to south then west to east, so replay never guesses.

The land comes before the distance because the lands are a plot-width of water apart: reaching
another land's counter means walking to the bridge and over it, which is far longer than the crow
flies. On the east edge of downtown the first island's counter is the nearer of the two as the crow
flies and much the farther to walk, and people live on that edge. A rule that measured distance
alone would send them across the water. Walking distance would be honest, and it would cost a
breadth-first search of the whole world on every call, including the ones a client makes to decide
whether to hold a button back; the land is the same answer for a fraction of the work.

A resident never has to know which door they got. `notAtTheCounter` and `notAtTheHall` measure to
the one they were given and the refusal names the walk to it, as it already did.

**Downtown's buildings did not move, and could not.** The hall and the counter stand on the spawn
column, where they always have; a land's square has no spawn tile, so its buildings stand on the
middle of its square, which is the same tile wherever a square's plot count is odd, downtown on the
live world included. That is why no pinned fixture hash but the lands log's moved, and that one
moved only because the land now records its square: the whole canonical world is otherwise
identical, with the same resident on the same tile and the same plot claimed.

Pinning the town centre to downtown's own rectangle came first, in its own commit, because the
Commons, the spawn tile, the hall, the shop and the game table spots were all derived from the
middle of the world and `open_land` grows the world (decision 0326's own correction, and the
"Blocking" section of RFC 0038).

**That fix had to reach the wire, not just the rules**, because the web derived the same geometry
from the same number: the mirror built the shop's tiles from `shopTiles(this.config)`, and its
config is the snapshot's, which grows with the world. So nothing in the client works the centre out
any more. It reads the Commons as `commons`, every hall and counter as `townHall` and `shop`, each
land's own square as `lands[].square`, and downtown's rectangle as `lands.home`, all off the
snapshot. `squareOf` is there for the one case that has no field to read, the `shop_opened` event,
which names no tiles: the counter faces its hall across the same square, so each hall the snapshot
already carries says where a counter goes.

## Consequences

What this makes easy: an island is a place to live rather than a commute. `GET /v1/shop`'s
`you.counter` and `GET /v1/town`'s `you.hall` still answer with one tile, and it is now the one that
reader would be served or file at. `tiles` and `hall` carry every building of their kind, so a
client that drew them as a list draws an island's buildings with no change, and `solid_buildings`
stops walkers at each of them through the same `groundOf`.

What it costs: the sim has a third kind of ground (a plot, the water, and a square), and every rule
that asks "could someone claim this slot?" has to ask `isTownSquare` rather than `isCommons`. The
two that do are `settle` and `claim`, plus the free-plot hint and the web's picker, which are the
places a resident would otherwise be pointed at the island's hall.

What to revisit. The server's planner picks each square when it logs `open_land`, which is RFC
0038's step 4: for the first island, 5 by 5 plots, the slot nearest the middle leaves 24 claimable
plots and a worst case of about 20 tiles to the counter, in line with downtown's 34. An island
counter with nobody behind it is a counter you buy at and nobody greets you: whether a townsfolk
moves there is its own decision. Game tables stay downtown, deliberately: the Commons keeps its
green, and a second set of tables is a decision about where people play, not about where they shop.

Code: [`packages/sim/src/doors.ts`](../../../packages/sim/src/doors.ts) (which door),
[`packages/sim/src/world.ts`](../../../packages/sim/src/world.ts) (`squares`, `hallDoor`,
`counterDoor`, `isTownSquare`, `settleProblem`),
[`packages/sim/src/lands.ts`](../../../packages/sim/src/lands.ts) (`open_land`'s `square`,
`landOfSquare`, `squareWords`), [`packages/sim/src/apply.ts`](../../../packages/sim/src/apply.ts)
(`settle`, `claim`), [`packages/server/src/shop.ts`](../../../packages/server/src/shop.ts) and
[`packages/server/src/town.ts`](../../../packages/server/src/town.ts) (`you.counter`, `you.hall`).
Tests: the nearest door and an island's own counter in `shop.test.ts`, its hall and the bridge in
`town.test.ts`, solid island buildings in `walk.test.ts`, the square's refusals in `lands.test.ts`,
and `src/fixtures/lands-log.ts`, whose island every one of them opens.
