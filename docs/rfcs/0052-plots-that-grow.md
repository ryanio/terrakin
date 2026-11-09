# RFC 0052: Plots that grow, and homes that differ

- Author: Ryan Ghods, with Claude
- Date: 2026-11-09
- Status: draft
- Discussion: <PR link>
- Builds on: [RFC 0016](0016-build-with-what-you-gather.md) (blocks and plans), [RFC 0028](0028-homes-with-storeys.md) (floors), [RFC 0038](0038-new-lands.md) (lands), [RFC 0046](0046-streets.md) (streets and ways), [RFC 0050](0050-roomier-homes.md) (walls between tiles, surfaces, hung things), [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) (replay), [decision 0400](../knowledge/decisions/0400-a-furnished-home-counts-furniture-and-seats-as-pieces-and-wh.md) (furnished counts), [decision 0428](../knowledge/decisions/0428-building-reaches-the-whole-plot-and-walls-go-only-on-lines-f.md) (whole-plot reach, walls on lines)

## Summary

Every plot slot becomes 16 by 16 tiles, four times today's 8 by 8, in one logged `regrid` that moves everything already built into the middle of its new slot. What a resident can build on, their *lot*, starts at 8 by 8 in the middle of the slot and grows in four steps to the whole 16 by 16, each step bought with coins once the home shows enough of what its owner made. The ring of the slot outside the lot is a *wild yard*: grass, flowers, trees and pickups drawn from the plot's position, so a new plot looks lived-in, not empty. The same change gives each plot a few fixed features of its own (a big tree, a rock, a stream bend, a slope of flowers) and adds ways to make a home look like no other: porches and fences that frame the lot, rugs and wallpaper, display shelves, and a front sign.

## Motivation

An 8 by 8 plot holds a 5 by 5 hut and not much more. RFC 0050 gave rooms back the tiles their walls took, but the plot is still the limit: a homesteader who has crafted a dozen pieces of furniture, a few pots and a gallery of pieces has nowhere to put them, and a host has no room for guests. Ryan's words: "peoples spaces are very cramped", and "we want it to feel roomy and to showcase all your stuff you make in game, but also don't want it to feel too big and empty in the beginning as a newb."

Today every home looks alike from the map: the same hut in the same spot of the same square, in one of four wall colors. The plot gives nothing to build around.

- **Homesteader**: room for a kitchen garden, an orchard, a workshop and a home, and a reason to grow it.
- **Host**: a yard big enough for a party, a dining room, a porch.
- **Delver**: a place to show finds and the collection book.
- **Newcomer**: a first plot that feels like a cozy cottage in a meadow, not a bare square.
- **Agent**: one more number to plan by (`lot`), the same build actions, and a clear next step ("grow your lot") in the check-in.

## Design

### 1. The grid doubles: one logged `regrid`

`config.plotSize` goes from 8 to 16 by a TOWN_ACTOR input, `regrid`, that transforms the whole world in one commit. It is a pure function of the state (`regridWorld(state)` in a new `packages/sim/src/regrid.ts`), so every replay makes the same world.

The rule for a tile is: a tile at `(x, y)` on plot slot `(px, py)`, at `(lx, ly)` inside it, moves to `(px*16 + 4 + lx, py*16 + 4 + ly)`. Every plot keeps its slot, so `px` and `py` mean what they meant; what stood on it sits in the middle 8 by 8, with a ring of 4 new tiles on every side. The world's `width` and `height` double, and so do `lands.home` and each land's bounds.

What moves with the rule, field by field (`WorldState`): residents' `x`, `y` and `hearth`; `blocks`, `edges`, `grades`, `turns`, `ground` and each floor's own; `ways`; `items` keyed by tile (`crops`, `tops`, `hung` by face, `kilns`, and `gathered` for today; what is keyed by resident, like inventories and `heldAside`, stays as it is); displays and pots; events' and games' places; the town's tiles (`townHall`, counters, table spots, the green), which are worked out from `downtown` and so follow it; routines' and knocks' tiles. A test lists `WorldState`'s keys and fails on a new one nobody has placed in `regrid.ts`, so a later field can't be left behind.

Streets and the Commons are plot slots too, so they double with the rest. A street is then 16 tiles wide, which is too wide. Two choices are open (open question 1): the street draws a 4-tile road down its middle and leaves the rest as wild verge, or the regrid shrinks street slots by laying them out at a narrower width. The simple one is the first: the street slot stays nobody's, and the verge is decoration.

Pure functions of position (`biomeAt`, `gatherableAt`, `weatherAt`, the sea) read the regrid through `config.plotSize`: they divide a position by `plotSize / 8` before using it, so each biome region and the sea keep their places relative to the plots. A world without `regrid` passes 8 and reads exactly as it did.

The `regrid` event, `world_regridded {plotSize: 16}`, tells every client to drop its mirror and load the snapshot again, as a gap does today. Nothing tries to move a mirror in place.

### 2. Your lot grows

A plot gains `lot`: the side of the square, centered in the slot, its owner can build on. It starts at 8 and grows by 2 a step, to 10, 12, 14 and 16 (64, 100, 144, 196 and 256 tiles). Absent means 8, so every plot after the regrid reads as it was.

```json
{"type": "grow_lot", "px": 5, "py": 3, "dry": true}
```

answers with what the step costs and what it needs, and without `dry` grows the lot one step:

```json
{"type": "lot_grown", "px": 5, "py": 3, "lot": 10, "by": "r_..."}
```

What a step asks (numbers for the economy run, open question 3):

| Lot | Tiles | Coins | The home shows at least |
|----:|------:|------:|---|
| 10 | 100 | 150 | 6 pieces of furniture |
| 12 | 144 | 300 | 12 pieces, 4 things on show |
| 14 | 196 | 600 | 20 pieces, 10 on show |
| 16 | 256 | 1,000 | 30 pieces, 20 on show |

"Pieces" and "on show" are decision 0400's counts (`furnished.ts`): furniture and seats, and what stands on surfaces, hangs on walls, and is on display. Growing needs a full home, so the lot grows when there's something to fill it, and the coins are a sink. A shared plot grows by any of its owners; a household's touching plots grow each on its own.

Every building rule that asks "is this tile on a plot you build on" also asks "is it in the lot" (`inLot`, one function beside `canBuildOn`). Outside the lot a `place`, `lay` or line is `outside_lot`, with the step that would reach it. Whole-plot reach (decision 0428) reaches the slot.

### 3. The wild yard

The slot's tiles outside the lot are the wild yard. Nobody builds there, everyone walks there, and it draws from the plot's position: grass of the plot's biome, clumps of flowers, a few trees and bushes, and the pickups that lie on any wild tile (branches, stones, finds) for the owner to gather (`own_plot_pickups` already gives a plot's pickups to its owners). A new plot is a cottage in a meadow; each step of the lot clears a ring of it.

The yard is drawing and pickups only. Trees and bushes don't block walking and aren't state: the client draws them from a hash of the tile, as pets are drawn, so the server never stores them and nothing replays them.

### 4. What makes one plot unlike another

Each plot slot gets one *feature* from a pure function of its slot (a hash of `px` and `py`, as `biomeAt` hashes a region): a big old tree, a boulder, a bend of a brook, a flowering bank, a well, an old stone wall, or none. It sits in the wild yard, off the middle 8 by 8, so no home stands on it today. It is drawing only, except the brook, which is water you can fish beside, and the well, which a kitchen counts as water. Once the lot grows over it, the owner keeps it or clears it with `remove` (it gives back nothing). A test pins the table, so a feature never moves.

Inside, three new kinds of decoration that change how a room feels without taking a tile:

- **Rugs** are a ground kind that lies under furniture (a rug under a table), sold at the shop and woven at the workbench from cushions.
- **Wallpaper and paint** go on a wall line's face, one per face, the way hung things do (`faceKey`): a color or a print from `PRINTS` (the patterns wear already uses). Drawing only, in the 3D view and the plot photo.
- **Display shelves and cases** are surfaces that hold three things, not one, so a collection fits in a corner.

Outside: a **front sign** (the plot's name on a post by the path, drawn from the name the owner already chose), **gates** in a fence line (a door kind that's a fence), and **porches** (a roofed run of floor along a wall, drawn from the roof's style).

### 5. Starter homes and designs

A newcomer's starter hut is the same 5 by 5 room, in the middle of an 8 by 8 lot, in a meadow 16 tiles across. Designs (`packages/protocol/src/designs.ts`) gain sizes: each design says the lot it fits, and the home sheet offers the ones that fit the lot you have, with the next size up shown dimmed and the step that unlocks it. The first new designs are a cottage with a garden (10), a house with two rooms and a porch (12), a house around a courtyard (14) and a farmhouse with a barn (16).

## Invariants

- **Server authority.** `regrid`, `grow_lot` and every feature are the sim's. The client draws the yard and the features from the same pure functions the sim exports (`plotFeature`, `wildAt`), and holds back a build outside the lot with the sim's `inLot`.
- **Determinism.** `regrid` is a logged input and a pure transform of the state; a feature comes from a hash of the slot, never a clock or a roll. Logs before the input replay at plot size 8, logs after at 16. `REPLAY_VERSION` doesn't move.
- **Untrusted text.** The front sign draws the plot's name, which is already resident text: it reaches the canvas and the photo as text only, and a held name stays held (`shownPlotName`). No new text field.
- **Protocol.** Breaking, allowed pre-alpha (decision 0146): every coordinate in a client's notes from before the regrid is wrong after it, and `config.plotSize` reads 16. Callers re-read `GET /v1/world` and their plot (`GET /v1/plots/{px}/{py}/plan`) after `world_regridded`. New: `lot` on plots, `grow_lot`, `lot_grown`, `outside_lot`, `world_regridded`, `feature` on plot views, and the new kinds. A map (`mapToPlan`) of a plot is the lot, not the slot.

## Economy impact

`grow_lot` is a coin sink of 2,050 coins per plot to reach 16, in four steps tied to how furnished the home is, so it can't be bought ahead of building. It mints nothing. The wild yard's pickups are the ones any wild tile already has; a plot's ring adds 192 tiles of them, which `own_plot_pickups` keeps to the owner, so the economy run needs a homesteader who gathers their own yard (open question 3). Rugs, wallpaper and shelves are shop and workbench kinds with fixed prices and recipes, so they are sinks too. Run `scripts/economy-sim.ts` with a grower and a gatherer before the numbers are fixed.

## Security considerations

- **Griefing by size.** A bigger plot is a bigger thing to fill with something ugly or a message spelled in blocks. Plot reports and takedowns already cover what's built; nothing new.
- **Land hoarding.** Doubling the grid doubles walking, not the number of plots, so it doesn't make plots scarcer. `grow_lot` grows only what you hold.
- **Prompt injection.** The front sign shows a plot name that is already filtered (`plot_name`) and marked untrusted in every view. An agent reading a sign in a scene photo treats it as the name it is, never an instruction; SKILL.md's safety rules already say so for signs.
- **A broken regrid.** One input moves everything. It ships behind a dry run on a copy of the live snapshot that checks the coin and item supply identities, every resident on a walkable tile, every hearth walkable from town, and no two things on one key, before the input is logged.

## Agent experience

SKILL.md changes:

- The world section says a plot is 16 by 16 and a lot starts at 8 in its middle, with `lot` on every plot, and how to read your lot's corner: `px*16 + (16 - lot)/2`.
- `grow_lot` gets its own section, with each step's cost and counts read from the dry run's answer (never quoted numbers), and the check-in's `todo` offers "Grow your lot" when the home qualifies.
- Designs list their `lot`, and `build` with a design too big for the lot is `outside_lot`, naming the step.
- The starter-home-by-hand recipe moves its corner to the lot's.
- The changelog entry for the regrid tells every agent to drop remembered coordinates and read their plot again.

## Migration and rollout

1. Build the transform and its tests against every fixture log and a copy of the live snapshot.
2. Ship the client that reads `plotSize` everywhere (no hard-coded 8: `git grep -n "\b8\b" packages/client/src` for plot math) and draws the wild yard and features.
3. Log `regrid` from the server at a quiet hour after a post on the devlog and a line in the changelog; clients reload on `world_regridded`.
4. Turn on `grow_lot` with its own switch once the economy run settles the numbers.
5. Designs by size, rugs, wallpaper, shelves, signs, gates and porches follow as separate slices.

Old logs replay unchanged: `regrid` is one more input. A snapshot from before it boots and replays it. Clients from before it get a gap and reload.

## Alternatives considered

- **Bigger plots for everyone, no lot.** The simplest rule, and Ryan's second option. A newcomer's first home sits in 256 bare tiles, which is the "too big and empty" he wants to avoid, and nothing rewards filling a home.
- **Home interiors** (a door leads to an interior that is its own space, bigger than the house looks). Keeps the town compact, but splits a home in two places, doubles what the 3D view and plot photos have to draw, and a visitor can't see in from the street. It may still come later for the town's buildings.
- **Merging neighbouring slots.** A resident buys the slot next door to grow. Works without a regrid, but most slots downtown are taken, so a homesteader in the middle can never grow, and an L-shaped plot breaks every rule that assumes a square.
- **A fresh world** at the new size, with everyone starting over. Cleanest for code, but it throws away everyone's homes and history. The regrid keeps them.
- **Only a bigger starter hut.** RFC 0044 and 0050 weighed it; the plot is the limit, not the hut.

## Open questions

1. Streets after the regrid: a 4-tile road down a 16-wide slot with wild verge on each side, or lay streets out narrower in the transform?
2. The town's middle doubles in size too: the Commons becomes 16 by 16. Fill it with the same buildings and a bigger green, or keep the buildings and draw a square around them?
3. The lot steps' coins and furnished counts, and whether the wild yard's pickups need a smaller spawn rate than open wild land (economy run).
4. Does a lot ever shrink (selling a plot, merging households), or does `lot` stay with the slot whoever holds it? This RFC says it stays.
5. Should the wild yard of an unclaimed slot draw the same meadow, so the town looks green everywhere, or stay plain so claimed plots stand out?
6. Which plot features, and is a brook (water) worth the fishing balance change?
