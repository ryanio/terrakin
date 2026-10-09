# RFC 0028: Homes with more than one storey

- Author: drafted by Claude for Ryan
- Date: 2026-10-09
- Status: accepted (one storey above the ground to start; see Decisions)
- Discussion: [issue #48](https://github.com/ryanio/terrakin/issues/48) (item 1, multiple floors)
- Builds on: [RFC 0016](0016-build-with-what-you-gather.md) (paths and floors, plans), [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) and [decision 0070](../knowledge/decisions/0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md) (replay), [decision 0072](../knowledge/decisions/0072-walking-is-eight-ways-around-solid-buildings-paced-by-your-f.md) (walking), [decision 0075](../knowledge/decisions/0075-paths-and-floors-are-a-second-layer-that-never-blocks-and-fu.md) (ground is its own layer), [decision 0076](../knowledge/decisions/0076-a-build-plan-uses-plot-coordinates-refuses-whole-what-the-pl.md) (build plans), [decision 0030](../knowledge/decisions/0030-3d-art-direction-and-performance-budget.md) (3D look and budget), [decision 0048](../knowledge/decisions/0048-plot-photos-are-drawn-by-the-worker-over-a-service-binding-a.md) and [decision 0160](../knowledge/decisions/0160-pictures-by-link-are-public-cached-pngs-of-a-plot-a-look-and.md) (plot photos and pictures by link), [decision 0144](../knowledge/decisions/0144-after-a-claim-the-web-offers-a-starter-home-in-one-tap-or-th.md) (the starter home on the web)

## Summary

Residents can build up as well as out. A plot owner pays coins to add a storey to their plot (up to two above the ground floor), lays a floor upstairs where walls below hold it up, places a staircase, and walks up it. Agents do the same with the actions they already know: `place`, `lay`, `remove`, `lift`, and `build` take an optional `storey`, `move` takes `up` and `down`, and one new action, `add_storey`, opens the next storey.

Upper storeys live in their own part of the world state, absent until the first `add_storey`. The ground floor stays exactly where it is today, in `state.blocks` keyed `"x,y"`, so every existing world log replays to the same hash with no change to `REPLAY_VERSION`.

On the map and in 3D you see the plot you stand on cut away at your own storey, and every other plot from above. A storey picker in the build bar and in the 3D home view lets you look at (and build on) one storey at a time. Plot photos show the home from above by default, and can show one storey's floor plan.

## Motivation

Issue #48 asks for multiple floors so residents can "build up, not just out". A plot is 8 by 8 tiles and the starter hut takes 5 by 5 of it, so a home that wants a bedroom, a kitchen, a garden, and a gallery runs out of ground fast.

- Homesteaders get room for a loft, a roof garden, or a reading nook over the kitchen, and a reason to save coins for something they can see.
- Hosts get a balcony to wave from and a second room for guests.
- Delvers get a long goal: the second storey costs more than the first, and the materials for a floor take gathering.
- Agents get a clear, checkable way to build a two-storey home in one `build` call, with a dry run that prices it and refusals that say exactly what is missing.

## Words

The code already uses "floor" for a ground kind (`planks` is "Plank floor", and RFC 0016 calls ground "paths and floors"). "Level" is taken by the roadmap's progression levels, "z" is what the 3D code calls the map's y axis (`toZ(y)` in `scene3d/blocks.ts`), and "story" reads as a post. So the API and the code say **storey**: `storey: 0` is the ground floor, `storey: 1` is upstairs. Copy for people says "Ground floor" and "Upstairs" (see Decisions).

## Design

### 1. Data model: a separate layer for each upper storey

The ground floor keeps `state.blocks` and `state.ground` as they are. Upper storeys get one new optional field, keyed by the storey's number, each holding the same two records the ground floor has:

```ts
interface WorldState {
  /** The ground floor's blocks, keyed by tileKey(x, y). Unchanged. */
  blocks: Record<string, BlockKind>;
  /** The ground floor's paths and floors. Unchanged. */
  ground?: Record<string, GroundKind>;
  /**
   * Storeys above the ground floor (RFC 0028), keyed "1" and "2". Each holds its own blocks and
   * floors keyed by tileKey(x, y). Absent until the first add_storey.
   */
  storeys?: Record<string, { blocks: Record<string, BlockKind>; ground: Record<string, GroundKind> }>;
}

interface Plot {
  /** How many storeys above the ground floor this plot has added. Absent at 0. */
  storeys?: number;
}

interface Resident {
  /** The storey they stand on. Absent on the ground floor. */
  storey?: number;
}
```

A world with a starter hut and a loft on plot (1, 1) looks like this (shortened):

```json
{
  "blocks": { "9,9": "wood", "10,9": "wood", "11,10": "stairs", "...": "..." },
  "ground": { "11,11": "rug" },
  "plots": { "1,1": { "px": 1, "py": 1, "ownerId": "r_ada", "storeys": 1 } },
  "storeys": {
    "1": {
      "blocks": { "9,13": "glass", "10,13": "glass" },
      "ground": { "9,9": "planks", "10,9": "planks", "...": "..." }
    }
  }
}
```

Stairs stand on the storey you climb from, so the hut's staircase is in the ground floor's `blocks`, and tile `"11,10"` on storey 1 has no floor: that's where the stairs come up.

#### Why this keeps old logs replaying to the same hash

`hashWorld` is FNV-1a over canonical JSON of the whole state, and `canonicalJson` skips keys whose value is `undefined`. Every new field (`storeys` on the world, `storeys` on a plot, `storey` on a resident, `storey` on an event) is absent until an input that didn't exist before sets it: `add_storey` is a new command, `storey` on an action is a field the action schemas strip today (they are plain `z.object`, so no logged input carries one), `move` with `up` or `down` was refused, and `stairs` is a new block kind that `place` refused. A logged input that never names a storey means the ground floor, which is what it meant when it was logged. So:

- No existing world hashes differently, and `REPLAY_VERSION` stays at 1.
- Every fixture in `packages/sim/src/fixtures/` keeps its pinned hash, and `replay.test.ts` keeps checking every split point. Those unchanged pins are the proof.
- `pnpm cf:deploy` runs `scripts/replay-check.ts` against terrakin.org's real log and refuses to deploy on a mismatch, so the live world is checked too.
- One rule changes meaning for a new kind only: `isSolid` stops treating `stairs` as solid. No old log has stairs, so no old walk changes.

#### Reading it

Every reader that means "the ground floor" keeps reading `state.blocks` and needs no change. Readers that mean "any storey" go through four new helpers in `packages/sim/src/storeys.ts`, so nothing else reaches into `state.storeys` by hand:

- `blocksOn(state, storey)` and `groundOn(state, storey)`: the records for one storey (the ground floor's for 0).
- `solidAt(state, x, y, storey)`: whether a block other than stairs stands there.
- `storeyGround(state, storey)`: the `Ground` that `stepFrom`, `walkTree`, and `route` walk on, where a tile upstairs with no floor is a new obstacle, `no_floor`.

#### Where the key and one block per tile live today

This is every place the `"x,y"` block key or the one-block-per-tile assumption is used, and what each needs. "Ground only" means it keeps reading `state.blocks` and stays correct, because the thing it checks can only be on the ground floor.

| Where | What it does with blocks | Change |
|-------|--------------------------|--------|
| `sim/src/keys.ts` | `tileKey`, `parseKey` | None. Each storey reuses `tileKey`. |
| `sim/src/types.ts` | `WorldState.blocks`, `Plot`, `Resident`, `Command`, events, rejection codes | New optional fields and codes, as above. |
| `sim/src/world.ts` `isSolid` | Ground-floor walls stop walkers | `stairs` isn't solid. New `solidAt` per storey. |
| `sim/src/world.ts` `starterHome`, `starterHutGardenTiles` | The hut is ground-floor tiles | Ground only. |
| `sim/src/walk.ts` `groundOf`, `worldGround`, `stepFrom`, `walkSteps`, `walkTree`, `route` | One `Ground` for the world | Take a storey's `Ground`; new obstacle `no_floor`. |
| `sim/src/apply.ts` `place`/`remove`/`lay`/`lift` | Reads and writes `state.blocks[key]` | Take `storey`; support checks; `ground_floor_only` kinds. |
| `sim/src/apply.ts` `release` | Refuses while any tile has a block or ground | Also checks every storey. |
| `sim/src/apply.ts` `set_hearth`, `build_starter_home`, `landingTile`, `standingTiles`, `hearthTiles` | Tiles and who stands on them | Ground only for the hearth and hut; "standing there" compares the storey too. |
| `sim/src/build.ts` `planBuild`, `commitBuild`, `plotPlan` | A plan's tiles, one block and one ground each | Entries take `storey`; order and skips below. |
| `sim/src/town.ts` `checkPlan`, `closeBuild` | Commons builds | Ground only. `add_storey` refuses the Commons. |
| `sim/src/items.ts` planter and station checks, `blockNeeds` | `state.blocks[key] === "planter"`, a kitchen or workbench at the craft tile | Ground only. `blockNeeds` adds `stairs`. |
| `sim/src/display.ts` | A pedestal or frame at the tile | Ground only. |
| `sim/src/fishing.ts` `isWater`, `waterBeside` | Ponds beside the caster | Ground only; the caster must be on the ground floor. |
| `sim/src/halloween.ts` `candyFor` | A `candy_bowl` on the plot | Ground only. |
| `sim/src/games.ts` table spots, `sit` | No block on a spot | Ground only; `sit` lands on the ground floor. |
| `sim/src/gather.ts` | A pickup's tile isn't `built` | Ground only; gathering needs the ground floor. |
| `sim/src/merge.ts` | Refuses while the record's plot has blocks or ground | Also checks every storey. |
| `sim/src/putter.ts`, `sim/src/routines.ts` | Edge tiles, `isSolid` | Plan and check on the resident's storey. |
| `sim/src/visit.ts`, `sim/src/events.ts` `joinTile` | Landing tiles | Land on the ground floor. |
| `sim/src/economy.ts` `payAllowance`, `sim/src/items.ts` `payPantry` | "On their hearth" is `x` and `y` | Also the ground floor, so standing over your hearth upstairs isn't home. |
| `sim/src/hash.ts`, `sim/src/replay.ts` | Hash and replay | None. |
| `protocol/src/schemas.ts` | Actions, `BuildAction`, the snapshot's `blocks` and `ground`, events, plan summary | Optional `storey` everywhere a tile is named; `add_storey`; `move` up and down. |
| `protocol/src/plots.ts` | `PlotView.blocks`, a count | Counts every storey; adds `storeys`. |
| `protocol/SKILL.md` | The building sections and plans | New "Building up" section. |
| `server/src/world-wire.ts` | `Object.entries(state.blocks)` into the snapshot | Adds each storey's entries with `storey`. |
| `server/src/plots.ts` `plotViews` | Blocks per plot | Counts every storey. |
| `server/src/plot-photo.ts` `areaOf`, `plotSpecOf`; `server/src/pictures.ts` | Ground and blocks per tile for photos | Every storey, drawn from above; an optional storey. |
| `server/src/links/making.ts`, `server/src/links/shared.ts` `freeHutTiles` | Free planter and station tiles for link-only assistants | Ground only. |
| `client/src/mirror.ts` | `blocks` and `paving` maps keyed `"x,y"`, `hasBlock` for walking | A map per storey; residents' storey; walking per storey. |
| `client/src/render.ts` | The 2D map's block loop, fence and wall neighbors, ponds | Draws storeys with the cutaway rule below. |
| `client/src/world.ts` | Tap to build, stations, ponds beside you | Taps act on the picked storey; stations and ponds ground only. |
| `client/src/plot-thumb.ts`, `client/src/pulse.ts`, `client/src/visits.ts` | Thumbnails and block counts | Draw from above; counts every storey. |
| `client/src/town-view.ts`, `client/src/town-format.ts` | Commons plans | Ground only. |
| `client/src/scene3d/layout.ts` `plotLayout`, `LayoutBlock` | Blocks and a solid set from the snapshot | `LayoutBlock` gets `storey`; solid set per storey. |
| `client/src/scene3d/blocks.ts`, `paths.ts`, `ground.ts` | Instances at y = 0 | Lift by storey height; floors upstairs get a slab. |
| `client/src/scene3d/plot.ts`, `home.ts`, `page.ts` | Framing, home model footprint, Take a photo | Frame the home's height; storey picker; cutaway. |
| `client/src/scene3d/world.ts`, `world-layout.ts` | The world in 3D, a solid set | Storeys and the cutaway rule. |
| `cards/src/plot.ts` `areaParts`, `cards/src/templates.ts` | Blocks back to front in one layer | Storeys back to front, with height shadows. |

The staff app (`packages/admin/`) draws no plots, so nothing there changes.

### 2. Building up and getting up

#### Adding a storey

```json
{"type": "add_storey", "px": 1, "py": 1}
```

From anywhere, like `build`. It needs a plot you own or share (`not_your_plot`), not the Commons (`plot_is_commons`), coins open (`economy_closed`), fewer than `STOREYS.max` storeys already (`too_high`), and the price in your purse (`not_enough_coins`). It sets `plot.storeys` one higher, takes the price like a shop purchase (the treasury's share in, the rest burned), and emits a public `storey_added {px, py, storey, by}` and your private `coins` event. A dry run prices it. Nothing is built: a new storey is empty air until you lay a floor.

A storey is never taken away or refunded. `release` already refuses while a plot has anything on it, and releasing drops the plot's record, so the next claimer starts at the ground floor.

#### What holds a storey up

Two rules, both local, so a check reads a few dozen tiles at most:

1. A floor upstairs (any ground kind, laid with `lay` at `storey` 1 or 2) needs a wall below: a `wood`, `stone`, or `glass` block on the storey under it within `STOREYS.span` tiles (2, Chebyshev), on the same plot. A 5 by 5 starter hut holds a floor over all of it, and a floor can reach 2 tiles past a wall as a balcony.
2. A block upstairs needs a floor on its own tile, or a `wood`, `stone`, or `glass` block right under it (a wall on a wall).

Taking something away can't leave anything floating. Removing a wall that is the last support of a floor above, or lifting a floor under a block, stairs, or someone standing there, is refused with `holds_up`, naming what it holds. This keeps the rule decision 0018 set for `release`: nothing silently tears down.

Some blocks stay on the ground floor, because other state is keyed by their tile alone: `planter` (crops), `kitchen` and `workbench` (crafting at a tile), `pedestal` and `frame` (displays), `pond` (fishing), and `candy_bowl` (Halloween). Placing one upstairs is `ground_floor_only`. Every other block, decor, and furniture can go upstairs.

#### Getting up: stairs

`stairs` is a new block kind on the end of `BLOCK_KINDS`, costing `STOREYS.stairsWood` (4) wood through `blockNeeds`, given back to whoever takes it up, exactly as a pond's stone is.

- It goes on the storey you climb from, on a tile you could place any block on. On storey 1 it also needs a floor under it.
- The storey above must exist on the plot (`no_storey`), so stairs can't go on the top storey (`too_high`).
- The tile right above it must be empty (no floor and no block), and stays that way: that tile is the stairwell. `lay` or `place` on a stairwell is `tile_occupied` ("Stairs come up here.").
- It is the one block you can walk onto. `solidAt` skips it.

```json
{"type": "place", "x": 11, "y": 10, "block": "stairs"}
{"type": "move", "dir": "up"}
{"type": "move", "dir": "down"}
```

`move` with `up` works when you stand on stairs and takes you to the stairwell tile one storey up. `down` works when you stand on a stairwell and takes you onto the stairs below. Anything else is `no_stairs` ("Stand on stairs to go up."). Each is one step, paced like any move. One-tile stairs mean no facing to store; the 3D view turns them toward the nearest open tile, as presentation.

#### Where a resident stands

A resident's position is `x`, `y`, and `storey` (absent on the ground floor). `moved` events carry `storey` when it isn't 0, so every logged move today emits the same bytes it always did.

- Walking upstairs uses that storey's `Ground`: no step onto a tile without a floor (the stairwell counts as one), into a block, or diagonally past a corner. Walking off an edge is refused, so nobody falls. The message is the existing `blocked` code with "There's no floor there."
- Building reach counts a storey as a tile: `max(|dx|, |dy|, |dstorey|) <= config.reach`. From the ground floor you can reach one storey up.
- Jumps land on the ground floor and clear `storey`: `home`, `visit`, `settle`, `join_event`, `sit`, and a routine's `walk_home`.
- `putter` and a routine's stroll plan and check steps on the storey you're on. The planner never climbs, so tuning it never needs stairs.
- What asks "standing there" (placing on a tile, landing tiles, a build skipping a tile) compares the storey too. What asks "on the plot" (event attendance, a putter wave's earshot) keeps reading `x` and `y`. What asks "beside something on the ground" (fishing, sitting at a table, gathering, knocking on a door) needs the ground floor. Your hearth, allowance, and pantry are on the ground floor.

#### The API for agents

The new optional field is `storey` (0 to 2, absent means 0) on every action that names a tile on a plot:

```json
{"type": "lay", "x": 10, "y": 10, "storey": 1, "ground": "planks"}
{"type": "place", "x": 9, "y": 9, "storey": 1, "block": "wood"}
{"type": "remove", "x": 9, "y": 9, "storey": 1}
{"type": "lift", "x": 10, "y": 10, "storey": 1}
```

Build plans take `storey` on any entry, so one call can build a hut with a loft. This plan (tiles from the plot's north-west corner) puts a planked loft over the starter hut, a railing of glass on its south edge, and stairs inside:

```json
{
  "type": "build", "px": 1, "py": 1,
  "blocks": [
    {"x": 3, "y": 2, "block": "stairs"},
    {"x": 1, "y": 5, "storey": 1, "block": "glass"},
    {"x": 2, "y": 5, "storey": 1, "block": "glass"}
  ],
  "ground": [
    {"x": 1, "y": 1, "storey": 1, "ground": "planks"},
    {"x": 2, "y": 1, "storey": 1, "ground": "planks"}
  ],
  "dry": true
}
```

The order inside a plan is fixed so support works in one call and old plans replay as they did: removals and lifts from the top storey down, then the ground floor's blocks and ground (today's order), then for each storey up: its floors, then its blocks. A plan naming a storey the plot hasn't added is refused whole (`no_storey`, with the price of `add_storey`). Two new skip reasons join `BUILD_SKIPS`, since both depend on things that move (a co-owner may have just taken a wall away): `unsupported`, a floor or block nothing holds up, and `holds_up`, a removal or lift that would leave something the plan keeps floating. Each list may hold a whole plot per storey (`plotSize² × (1 + STOREYS.max)`, 128 entries while `max` is 1), and the 5 second spacing between real builds stays.

`GET /v1/plots/{px}/{py}/plan` reads every storey back, so "copy a design" copies lofts too, and the snapshot's `blocks` and `ground` entries carry `storey` when it isn't 0. Residents carry `storey`, plots carry `storeys`.

New refusals:

| Code | When | Message, roughly |
|------|------|------------------|
| `no_storey` | Building on, or putting stairs up to, a storey this plot hasn't added | "This plot has no upstairs yet. add_storey adds it for 200 coins." |
| `too_high` | Past `STOREYS.max`, or stairs on the top storey | "Homes go up one storey above the ground." |
| `nothing_under` | A floor with no wall below within 2 tiles, or a block with no floor or wall under it | "Nothing holds that up. Build walls under it first, within 2 tiles." |
| `holds_up` | Taking away what holds up a floor, a block, stairs, or someone | "That wall holds up the floor above. Lift the floor first." |
| `no_stairs` | `move up` off stairs, or `move down` off a stairwell | "Stand on stairs to go up." |
| `ground_floor_only` | A planter, station, pedestal, frame, pond, or candy bowl upstairs | "Planters stay on the ground floor." |

### 3. Limits and numbers

`STOREYS` in `packages/sim/src/storeys.ts`, every number in one place:

| Number | Value | Why |
|--------|-------|-----|
| `max` | 1 storey above the ground floor | A loft first: half the camera, picker, and photo work of two, and usage shows whether a second is wanted. May go up later, never down, since logged inputs on a storey must stay valid. |
| `price` | 200 coins for storey 1 ([decision 0242](../knowledge/decisions/0242-a-storey-costs-200-coins-the-economy-run-with-builders-says-.md), from PR 3's economy run) | At 80 the run's builders could pay on day 1 from the welcome gift, a tip, and a first sale; at 200 the median builder pays on day 9 and the earliest on day 5. A second storey, if the cap goes up, costs more. |
| `span` | 2 tiles | Covers the whole starter hut and allows a 2-tile balcony, but no floating decks across a plot. |
| `stairsWood` | 4 wood | About a day or two of branches on a wooded plot; given back on removal. |

Floors upstairs cost what the ground kind costs (RFC 0016's table): planking the starter hut's 25 tiles is 25 wood, a moss roof garden is free. Walls stay free, as they are today. So a storey's real costs are coins once and wood for stairs and a good floor.

#### What the economy run checks

`scripts/economy-sim.ts` gains builders: some regulars who save for `add_storey` and gather wood for stairs and a planked floor, from their own PRNG stream, and `--no-storeys` to play the month as it was. The run should show:

1. Supply per active resident still grows in a straight line in decision 0039's band, with storeys burning coins.
2. Days for a regular to afford storey 1. The target is inside two weeks, and never in a newcomer's first days.
3. Newcomers' first-week spending (the line the run already prints) doesn't drop, so saving for a storey doesn't crowd out seeds and a first costume.
4. Days of gathering for a builder to plank a starter hut's loft and make stairs, against the anglers' rod and pond, so wood for building up doesn't starve fishing and furniture.
5. Coins burned by storeys a day against the day's mint, so the sink is felt but supply never shrinks over the month.

The numbers go in a decision record with the run's output before `add_storey` is exposed (PR 3 below).

### 4. The map, the 3D views, and photos

Today a home has walls and no roof: from above you see every room. A floor upstairs covers what's under it. The rule everywhere is the same: **you see the storey you're on, and the rest of the world from above.**

#### The 2D map

Other plots draw from above: each tile shows the highest storey that has something on it, and an upper storey's blocks get a longer shadow, so height reads at a glance. The plot you stand on is cut away at your storey: storeys above you aren't drawn, except a faint outline of where their floors end, so you know something is overhead; storeys below you show through open tiles, dimmed. Figures are never hidden, so "who's home" still reads: someone under a floor is drawn faded, with their name.

#### The build bar on a phone

On a plot with storeys, the build bar's header gets a storey picker of two chips ("Ground floor", "Upstairs"), 44 px tall, with `aria-pressed`. Picking one sets the storey taps build on and moves the map's cutaway there, without moving you. The last chip is "Add a storey, 200 coins" while the plot can have another, sending `add_storey` after a confirm, since it spends coins. The picker starts on your own storey. Standing on stairs or a stairwell shows a "Go up" or "Go down" pill beside your figure. Tap to walk stays within one storey; tapping a tile on another storey walks you to the stairs and shows the pill, so nothing climbs without a tap.

#### The 3D home view

A storey is one wall tall (1.25, `blockLook("wood").height`), and a floor upstairs draws as a thin slab with the ground kind's look on top. The page's bar gets the same picker, "Whole home" first: it hides every storey above the one picked and darkens the top edges of the cut walls so the cut reads as a cut. "Take a photo" (PR #51) photographs what's shown, framed to the whole home's bounds including its height. Upper storeys add instances to the meshes each kind already has, plus one slab mesh, so the draw calls stay within decision 0030's budget. A resident's own home model still replaces the blocks under its footprint on every storey.

#### The world in 3D

The same rule as the map: the plot you stand on is cut away at your storey, and every other plot shows whole.

#### Plot photos and pictures by link

`POST /v1/plots/photo` and `/og/plot/<px>-<py>.png` draw the plot from above, every storey, with the height shadows the map uses, so a two-storey home looks like one. The facts line under the photo says "2 storeys". `POST /v1/plots/photo` takes an optional `{"storey": 0}` that draws that storey's floor plan instead (everything above it left out), so an agent can show what's inside. The picture by link stays from above only, so its cache keys stay one per plot. The home picture still stands over the hearth, and figures are drawn as on the map.

## Invariants

- The server decides. Support, stairs, reach, storey caps, and the price are sim rules. The client's picker only chooses which `storey` to send, and the client checks your own steps with the same `storeyGround` before it sends them, as it does today.
- Determinism holds: no new clock, randomness, or I/O. Support is a fixed-radius read of the state, and a plan's order is fixed.
- Same log in, same world out. New state is absent until a new input sets it, and every existing fixture pin stays as it is. `REPLAY_VERSION` doesn't move.
- Resident text stays untrusted, and nothing here adds text. A storey is a number from 0 to 2, checked as a whole number in range in the sim, and turned into a record key only after that check.
- In the protocol, `storey` is additive on actions. The snapshot's `blocks` and `ground` lists gain entries with `storey`, which a reader that ignores the field would draw on the ground floor; while Terrakin is pre-alpha ([decision 0146](../knowledge/decisions/0146-while-terrakin-is-pre-alpha-v1-can-break-announced-in-the-ch.md)), that is a Changed entry in `CHANGELOG.md` telling readers to key tiles by storey too. `SKILL.md` changes in the same commit.

## Economy impact

- A new coin sink: `add_storey`, 200 coins a plot ([decision 0242](../knowledge/decisions/0242-a-storey-costs-200-coins-the-economy-run-with-builders-says-.md)), split like a shop purchase. No new source.
- A new wood sink: stairs (4 each, given back when taken up) and planked floors upstairs (1 a tile, given back when lifted).
- Nothing duplicates: stairs and floors give back exactly what they took, as decor and ground do, and the price is never refunded. `expectSupplyHolds` runs after `add_storey` in its tests.
- A co-owner can pay for a storey on a plot they share. If the owner later releases the plot, the coins stay burned; nothing comes back to anyone, so there's nothing to farm.

## Security considerations

- Trapping. Someone could build stairs on their plot, wait for a visitor to climb, and take the stairs away. Removing stairs someone stands on, or the floor under them, is `holds_up`. A visitor left upstairs without stairs is never stuck: `home`, `visit`, and `settle` jump to the ground floor.
- Hiding things under a roof. Block art on a ground floor can be covered by a floor upstairs. It's still in the snapshot and the plan route, the cutaway shows it to anyone standing on the plot, and a storey's floor plan photo shows it. Staff can read every storey of any plot from `GET /v1/plots/{px}/{py}/plan`, and a staff view of a reported plot can draw one storey at a time with the same code the floor plan photo uses.
- Flooding the broadcast. A plan can now hold 128 entries a list instead of 64 (one storey up). The one-real-build-every-5-seconds spacing (decision 0076) bounds the events a resident can cause; this doubles what one build may broadcast, so the server's per-build event count should be watched once it ships.
- Prompt injection. No new text fields. A copied plan is numbers and kinds, so "copy a design" can't carry words into an agent's context.
- Odd ids. `storey` comes from input and becomes a key into `state.storeys`. The sim converts it only after checking it's a whole number from 1 to `STOREYS.max`, so `__proto__` and friends never reach a record, and `own.test.ts` gains the storey field.
- Coins. `add_storey` spends the sender's coins, so the web asks before sending it and agents are told in SKILL.md to add a storey only when their owner wants one.

## Agent experience

`SKILL.md` gets a "Building up" section after the build plans:

- `add_storey {px, py}` with its price and a dry run, and "only when your owner wants it, since it spends coins".
- `storey` on `place`, `lay`, `remove`, `lift`, and plan entries, and the two support rules in one sentence each.
- `stairs`, its wood, the stairwell, and `move` with `up` and `down`.
- The refusals table above, generated from the sim's codes like the others.
- A fourth copyable plan, "Hut with a loft", that builds on the starter hut: stairs, a planked loft, and a glass railing, with a dry run first.
- That `storey` appears on snapshot entries, residents, and plots, and `GET /v1/plots/{px}/{py}/plan` includes upper storeys.

`build_starter_home` doesn't change: a loft is the plan above, not a new command.

## Migration and rollout

Old logs replay as they were made (Design, section 1). Old clients: the web client ships with the server. A third-party reader that ignores `storey` would draw upstairs on the ground floor, which the CHANGELOG entry covers.

### 5. Build plan, PR by PR

Nothing can be built upstairs until the protocol accepts `storey`, so the sim lands first, dark. Each PR passes `pnpm verify`, and the client ones `pnpm e2e`.

#### PR 1. Sim: storeys and building on them

`storeys.ts` (`STOREYS`, `blocksOn`, `groundOn`, `solidAt`), `add_storey`, `storey` on `place`, `remove`, `lay`, `lift`, the support rules, `holds_up`, `ground_floor_only`, and `release` and `merge` checking every storey.

Tests: each accept and refusal through `apply` with the hash unchanged after the refusal; guard tests that fail with the guard removed (`too_high` past the cap, `not_enough_coins`, `plot_is_commons`, `nothing_under`, `holds_up`, release with only an upstairs block); `expectSupplyHolds` after `add_storey`; every existing fixture hash unchanged; a new `fixtures/storeys-log.ts` with its hash pinned, which `replay.test.ts` then checks at every split point.

#### PR 2. Sim: stairs and walking

`stairs` in `BLOCK_KINDS` and `blockNeeds`, `solidAt` skipping it, `storey` on residents and `moved`, `move up`/`down`, `storeyGround` with `no_floor`, reach by storey, jumps landing on the ground floor, the allowance and pantry needing the ground floor, and putter and strolls on your storey.

Tests: walking on a floor, refused off its edge and past a corner; up and down, `no_stairs`; stairs on the top storey `too_high`; the stairwell refusing `lay`; removing stairs under someone `holds_up`; no allowance standing over your hearth upstairs; `home` from upstairs clears `storey`; the storeys fixture extended and re-pinned (it's new, so nothing live depends on it).

#### PR 3. Economy run and the numbers

Builders in `scripts/economy-sim.ts` with `--no-storeys`, the five checks above, and a decision record with the run's output, adjusting `STOREYS` if it says so.

Tests: `storeys.test.ts` pins every number, so a change is deliberate.

#### PR 4. Build plans

`storey` on plan entries, the plan order, the `unsupported` and `holds_up` skips, `no_storey` refusing whole, the larger list cap, and `plotPlan` reading every storey.

Tests: a one-call hut with a loft builds the same on two plots, and `plotPlan` reads it back equal to the plan; a plan that removes a wall holding up a floor it keeps skips that removal as `holds_up`; a plan that removes a wall holding up a floor upstairs it doesn't name skips that removal as `holds_up`; a plan that removes stairs someone stands on, at the foot or at the top, skips that removal as `holds_up`; a loft plan on a plot without a storey is refused whole; old-shape plans in the build and commons fixtures keep their hashes and event bytes.

#### PR 5. Read side: the wire and the web drawing storeys

`storey` on the snapshot's entries, residents, and plots, and on events; `world-wire.ts`, `plots.ts`; the mirror's per-storey maps; the 2D map's from-above and cutaway rule and faded figures; and, until PRs 7 and 8, the 3D views and photos drawing the ground floor only so nothing misdraws.

Tests: `protocol.test.ts` for the snapshot schema; a server test that the snapshot carries an upstairs block with `storey`; client unit tests for the pure cutaway function (which storey each tile shows for a viewer on a storey) and for the mirror applying `block_placed` with `storey`.

#### PR 6. Write side: it goes live

The action schemas, `add_storey`, `move` up and down, the plan route, the "Building up" section of `SKILL.md`, the CHANGELOG entry, `pnpm gen`; on the web, the build bar's picker, "Add a storey" with its confirm, and the Go up and Go down pill.

Tests: `protocol.test.ts` keeps SKILL.md's tables equal to the sim's; a server test that a dry `add_storey` prices it and spends nothing; steps added to `e2e/build.spec.ts` on a phone viewport: add a storey, lay a loft, place stairs, go up, and see the picker follow you. Then `pnpm dev:test` with `pnpm persona stocked` and a look in the browser.

#### PR 7. 3D views

Storey heights, floor slabs, the picker and cutaway in the 3D home view, whole-home framing with height, and the world in 3D's cutaway.

Tests: `scene3d.test.ts` and `world-3d.test.ts` on the layout functions (instances lifted by storey, nothing above the picked storey, the frame's radius covering the top storey) and a check that draw calls per kind don't grow; steps added to `e2e/three-d.spec.ts`: open a plot with a loft, pick the ground floor, take a photo.

#### PR 8. Photos and pictures by link

Every storey from above with height shadows in `cards/src/plot.ts`, the facts line, `storey` on `POST /v1/plots/photo`, a sample with a loft in `cards/src/samples.ts`, and a `CARDS_VERSION` bump so cached photos are drawn again.

Tests: `cards.test.ts` (a floor upstairs draws over the ground floor's tiles; a storey's floor plan leaves out what's above), `plot-photo.test.ts` (the `storey` field, and `no_storey` for one the plot lacks), `pictures.test.ts` (a new upstairs block changes the cache key). Steps added to `e2e/plot-photo.spec.ts` only if a lower test can't show it.

Docs move with each PR: `packages/sim/AGENTS.md` (a Storeys section), `docs/architecture.md` (Building), `docs/plans/README.md`, and a devlog post with a screenshot when PR 6 ships.

## Alternatives considered

### A storey on the tile key for every block (`"x,y,z"`)

One record, one shape. It re-keys every block in every world, so every world's hash changes: it needs a `REPLAY_VERSION` bump, a snapshot migration on terrakin.org, new hashes for every fixture (which throws away the pins that prove old logs replay), and a change to every one of the readers in the table above at once, including the ones that only ever mean the ground floor. It lost on replay and on the size of the first PR.

### A storey on the key only above the ground floor (`"x,y"` stays, `"x,y,1"` is upstairs, in the same `state.blocks`)

This keeps old hashes, since ground keys don't change. But every reader that walks `state.blocks` (the wire, the 2D map, plot photos, plot counts, `plotPlan`, `merge`, `release`) would silently treat upstairs blocks as ground-floor ones until it was fixed, and `parseKey` would drop the storey. A separate record makes the safe default "you don't see upstairs" instead of "you see it in the wrong place". It lost on how quietly it fails.

### Floors appear by themselves over a closed room

No `lay` upstairs: any ring of walls gets a floor above it. It needs a flood fill to decide what's closed, makes a roof garden or balcony impossible, and moving one wall would silently delete a floor. It lost on predictability.

### Ladders, or two-tile stairs with a facing

A ladder is the same mechanic as one-tile stairs with a different picture, so it can be a look later. Two-tile stairs need a facing stored on the block and a footprint that crosses tiles, which `BLOCK_KINDS` can't express. One tile won.

### A `climb` action instead of `move` up and down

Agents already reason in `move`, the pace is a move's, and `walkHint` can say "move up". A separate action would be one more thing to learn for no new rule.

### No coin price, materials only

Walls are free, so a storey would cost a few wood. It'd give the economy no sink for its most visible build, and give regulars nothing to save for between costumes. A recurring upkeep was also considered and dropped: it punishes being away, which Terrakin never does.

### Roofs instead of a cutaway

Hide a gable roof when you come inside. Homes have no roofs today, so this is a new art feature on top of storeys; a roof can be a later look on the top storey, and the cutaway works without it.

### Photos as floor plans side by side

The photo frame could show each storey's plan next to the others. The card keeps what matters in its middle 800 pixels so the feed's 4:3 crop keeps it (`plot` in `packages/cards/src/templates.ts`), and three small plans read worse than one plot from above. The `storey` field covers the need.

## Decisions

1. The word: `storey` in the API and code; "Ground floor" and "Upstairs" for people. "Floor" names a ground kind and "story" reads as a post.
2. The price: coins and materials. A storey is something to save for that everyone can see, and coins need sinks. The economy run (PR 3) sets the number, with a newcomer able to afford storey 1 within about two weeks of ordinary play.
3. How tall: one storey above the ground to start (`STOREYS.max` is 1). The cap can go up later, never down.
4. Privacy upstairs: open to visitors, like the ground floor. Visiting is how the town meets, and blocks and closed doors (`closedDoor`) already keep out who they keep out; an invite list would be new state for little gain.
5. What upstairs holds: the ground-floor-only list stands. Roof gardens need crops keyed by storey, which is a replay change with an RFC of its own.
6. The Commons: ground only for now. A Town Hall storey (a lookout, a stage) is its own decision later.
7. Pictures by link: `/og/plot` stays from above. Plot photos take an optional `storey` (PR 8).
