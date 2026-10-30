# RFC 0050: Roomier homes: things on tables, things on walls, and walls between tiles

- Author: drafted by Claude for Ryan
- Date: 2026-10-29
- Status: accepted (Ryan, 2026-10-29; building)
- Discussion: Ryan, 2026-10-29: "the density of our plots is not good enough ... we want to encourage people owning more, decorating, having more furniture"
- Builds on: [RFC 0016](0016-build-with-what-you-gather.md) (blocks, furniture, build plans), [RFC 0028](0028-homes-with-storeys.md) (floors and what holds them up), [RFC 0032](0032-homes-agents-can-design.md) (plot maps and designs), [RFC 0041](0041-materials-and-roofs.md) (made materials and roofs), [RFC 0044](0044-cozy-homes.md) (seats you walk onto), [RFC 0046](0046-streets.md) (public ways), [RFC 0047](0047-trades-and-your-mark.md) (pots set down at home), [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) (replay)

## Built, 2026-10-30: slice 1, things on surfaces and walls

Surfaces and hanging are built on the sim, the API, the map, both 3D views and plot photos. [Decision 0392](../knowledge/decisions/0392-things-on-surfaces-and-walls-are-kept-by-tile-and-face-shop-.md) records what building it changed from this draft: `put_on` and `hang` take one `item` as `display` does, so the separate `kind` and `flower` fields and the `hung_frame` kind went (a made thing hung on a wall is drawn framed); trinkets and wall things are shop-only, with no recipes; and the fish mount waits for a way to make one. The economy run was not extended, since these are sinks with no source.

## Built, 2026-10-30: slice 2, walls between tiles

Walls between tiles, `slim_walls` and the `starter_edges` switch are built on the sim, the API, the map, both 3D views and plot photos, with a Walls chip and Slim the walls on the build bar. [Decision 0396](../knowledge/decisions/0396-walls-between-tiles-are-keyed-by-a-tile-s-north-and-west-lin.md) records what changed from this draft: `build`'s lists are `edges` and `removeEdges`, since `walls` already names a design's material; the plot map's edges grid and the designs' edge versions are left for later; and design notes, exits and the way planner don't read lines yet. `starter_edges` is built and no adapter logs it until slimmed homes have been seen in play.

## Summary

A home holds very little, because everything in it takes a whole tile: a wall, a table, the pot on the table, the picture on the wall. This RFC adds three things, in the order they would be built.

1. Surfaces. A table, a shelf, a counter or a desk holds one small thing on top: a pot, a candle, a lamp, a stack of books. New actions `put_on` and `take_off`.
2. Walls you hang things on. Any wall face that looks onto an open tile holds one thing: a framed picture, a clock, a mirror, a wreath, a mounted fish. New actions `hang` and `unhang`.
3. Walls between tiles. A wall, window or door can stand on the line between two tiles instead of filling a tile. The starter hut's inside goes from 9 tiles to 25 on the same footprint. `place`, `remove` and `build` take a `side`, and one new action, `slim_walls`, turns an existing home's wall blocks into walls between tiles.

All three are new state that is absent until someone uses it, so every existing log replays to the same hash and `REPLAY_VERSION` doesn't move.

## Motivation

The persona is the homesteader, and the problem is the one RFC 0044 started on: there is not enough room in a home to make it yours, so there is little reason to own more things.

Walls eat the plot. The starter hut is a 5 by 5 ring of blocks (`starterHome` in `packages/sim/src/world.ts`). Sixteen of its 25 tiles are wall, nine are inside, the hearth takes one and the tile in front of it must stay open. Seven tiles are left for everything a resident owns. RFC 0032 counted the town on 2026-10-10 and found 17 of 25 built plots were exactly this hut. Every wall between two rooms costs a row of tiles too, so a home with three rooms in a 6 by 6 box loses about a third of its floor to partitions.

Each tile holds one thing: `state.blocks` has one block per tile. A pot from the kiln is set down as a block of its own (`pot`, RFC 0047), a picture frame stands on a tile of its own (`frame`), and so does a lantern. The four cold plays of pottery asked for a pot on a table or a shelf, and the model has no way to say it.

Most furniture blocks walking. RFC 0044 made the armchair, the sofa and the bed walked onto. Everything else is solid, so each piece placed is a tile nobody can cross.

With surfaces, every table and shelf is a second spot. With hanging, every wall facing into a room holds something: the slimmed hut's room has 17 faces once its door and two windows are left out. With walls between tiles, the hut has 25 tiles inside instead of 9, and a home with partitions loses no floor to them. That gives the shop and the workbench room to sell and make many more small things, and gives residents a reason to buy them.

Thin drawing of today's wall blocks was considered and dropped: rooms would look bigger and hold exactly what they hold now (see Alternatives).

## Design

### 1. Surfaces

A **surface** is a block that holds one small thing on top. The first set:

| Surface | Today | Height drawn |
|---------|-------|--------------|
| `table` | furniture | table top |
| `bookshelf` | furniture | top shelf |
| `barrel` | furniture | lid |
| `kitchen` | station | counter |
| `desk` | new furniture | desk top |
| `side_table` | new furniture | low top |
| `dresser` | new furniture | top |

A **small thing** is one of:

- a pot from the kiln, by its id, with its flower if it's a vase (the same `item` and `flower` that `place {block: "pot"}` takes today);
- a made thing or a find, exactly as a pedestal takes one (`display`'s `item` or `find`);
- one of a new role of catalog kinds, `trinket`: `candle`, `table_lamp`, `book_stack`, `potted_fern`, `jar_of_shells`, `teacup`, `globe`, `music_box`. Each is a held stack, sold at the shop or made at the workbench, and goes back to whoever took it off.

```json
{"type": "put_on", "x": 10, "y": 11, "kind": "candle"}
{"type": "put_on", "x": 11, "y": 11, "floor": 1, "item": "pot_7f3a", "flower": "rose"}
{"type": "take_off", "x": 10, "y": 11}
```

Rules:

- The tile on that floor must hold a surface (`not_a_surface` otherwise) with nothing on it (`tile_occupied`).
- Your own plot or your household's, within reach, the same checks as `place` (`reachProblem`, `canBuildOn`, `plotListedProblem`).
- What's put on leaves your things and is kept with who put it there. `take_off` gives it back to them, held aside if their things are full, which is how pots and displays already work.
- A surface with something on it can't be removed (`holds_up`, "Take the candle off first"), as a planter with a crop or a pedestal with a display can't. A `build` plan's removal skips it and reports it.
- Nothing on a surface ever blocks or unblocks walking. The surface decides that, as it does today.

State, in the items record beside `pots` and `displays`, keyed like pots (`potKey`: the tile key on the ground floor, `"1:x,y"` upstairs):

```ts
interface ItemsState {
  /** Small things on surfaces (RFC 0050), keyed by potKey(x, y, floor). Absent until the first put_on. */
  tops?: Record<string, OnTop>;
}
type OnTop =
  | { kind: TrinketKind; by: ResidentId }
  | { pot: string; flower?: CropKind; by: ResidentId }
  | { item: string; by: ResidentId }
  | { find: FindKind; by: ResidentId };
```

Events: `put_on {x, y, floor?, ...what}` and `taken_off {x, y, floor?}`, both public, plus the private `inventory` event.

The existing `pot` block, `pedestal` and `frame` stay as they are. A pot can still stand on the floor on its own.

### 2. Hanging things on walls

A **face** is one side of a wall as seen from the open tile in front of it. It is named by the tile you stand on and the side the wall is on, so the key works the same for a wall block and for a wall between tiles:

```text
  standing on (10, 11), the wall to the north is face "10,11,n"
```

A face can hold one hung thing:

- one of a new role of catalog kinds, `wall_decor`: `wall_clock`, `mirror`, `wreath`, `wall_shelf`, `sconce` (glows after dark, drawn like a lamp), `pennant`, `fish_mount` (made at the workbench from a fish you caught);
- a piece or a made thing in a `hung_frame`, exactly as a `frame` block holds one today (decision 0059), so a resident's uploaded art can go on a wall.

```json
{"type": "hang", "x": 10, "y": 11, "side": "n", "kind": "wall_clock"}
{"type": "hang", "x": 12, "y": 13, "side": "w", "item": "piece_19c2"}
{"type": "unhang", "x": 10, "y": 11, "side": "n"}
```

Rules:

- The tile `(x, y)` on that floor must be one you can stand on, and there must be a wall on `side`: a wall block on the neighbouring tile, or a wall between the tiles (part 3). A wall here is a holding kind (`HOLDING_BLOCKS`) other than a window, so wood, stone or a solid made material. A hedge, a door, glass and a pane hold nothing hung (`no_wall`).
- The same plot, reach and listing checks as `put_on`. Both the standing tile and the wall must be on your plot or your household's.
- Taking a wall down gives back whatever hangs on either of its faces to whoever hung it, held aside if full, in the same input, with an `unhung` event for each. Refusing instead was considered: it would make every `build` that moves a wall and every town rebuild (`rebuild_home`) fail on one picture.
- Hung things never block walking.

State: `items.hung?: Record<faceKey, Hung>`, with `faceKey(x, y, side, floor)` as `"x,y,n"` on the ground floor and `"1:x,y,n"` upstairs, and `Hung` shaped like `OnTop` with `kind` from `wall_decor`. Events: `hung` and `unhung`, public.

### 3. Walls between tiles

#### The idea

An **edge** is the line between two tiles that share a side. An edge can hold one **edge block**: any wall kind (`wood`, `stone`, `leaf`, every made material), a window (`glass`, `sea_glass_pane`), or a `door`. An edge block stops a walker crossing that line and takes no floor from either tile.

```text
  wall blocks                      walls between tiles
                                   +-----------+
  W W W W W                        | . . . . . |
  W . . . W                        | . . . . . |
  G . h . G   9 inside             G . . h . . G   25 inside
  W . . . W                        | . . . . . |
  W W + W W                        | . . . . . |
                                   +-----D-----+
```

#### Data

Each tile owns the edge on its north side and the edge on its west side, so every edge has exactly one key. An action may name any side; the sim turns `s` and `e` into the neighbour's `n` and `w` before it checks anything, and events carry only the canonical form.

```ts
type EdgeSide = "n" | "w";
/** "x,y,n" or "x,y,w". */
const edgeKey = (x: number, y: number, side: EdgeSide) => `${x},${y},${side}`;

interface WorldState {
  /** Edge blocks on the ground floor (RFC 0050), keyed by edgeKey. Absent until the first one. */
  edges?: Record<string, BlockKind>;
}
// Each floor in state.floors gains the same optional record: { blocks, ground, edges? }.
```

Readers go through new helpers in `packages/sim/src/edges.ts` (`edgeOn(state, x, y, side, floor)`, `edgesOn(state, floor)`), the way floors go through `blocksOn`. Nothing else reaches into `state.edges`.

#### Actions

`place`, `remove` and `build` take `side`:

```json
{"type": "place", "x": 10, "y": 9, "side": "n", "block": "stone"}
{"type": "place", "x": 12, "y": 13, "side": "s", "block": "door"}
{"type": "remove", "x": 10, "y": 9, "side": "n"}
{"type": "build", "px": 1, "py": 1,
 "walls": [{"x": 1, "y": 1, "side": "n", "block": "plaster"}],
 "removeWalls": [{"x": 3, "y": 1, "side": "w"}]}
```

`build` gets two new lists, `walls` and `removeWalls`, in the plot coordinates a plan already uses. A plan's order adds them after its block removals and before its block placements on each floor, so a plan can swap a wall block for an edge in one call.

Rules for an edge:

- Both tiles must be on the same plot, which must be yours or your household's, or on two touching plots of one household. An edge on the line between your plot and anyone else's, a street, a square, the sea or open land is refused (`plot_border`). So a neighbour can never wall your side, and a household with two touching plots can build one home across the line between them.
- An edge with a public way tile on both sides is refused (`public_ground`), so a way through a plot can't be cut. An edge between a way tile and the rest of the plot is allowed: it fences the way off from the home.
- An edge may stand beside any block. A tile walled in on all four sides is allowed, as a tile walled in by blocks is today, and the design notes (`walled_in`) point it out.
- An edge costs `blockNeeds(block)`, exactly what a block of that kind costs, taken when it goes up and given back when it comes down. Free walls stay free.
- Door edges are ground floor only and hold nothing up, as a door block is today.
- Upstairs, an edge needs flooring on at least one of its two tiles, and it holds up flooring within `FLOORS.span` as a wall block does (below).
- Placing an edge is never refused because someone stands beside it: a resident inside a room that gets closed can always step through a door or jump home, as with blocks today.

Events: `edge_placed {x, y, side, floor?, block}` and `edge_removed {x, y, side, floor?}`, public, plus `inventory` when a made material moves.

#### Walking

`stepFrom` stays the one rule for a step. `Ground` gains one method beside `obstacle`:

```ts
interface Ground {
  readonly config: WorldConfig;
  obstacle(x: number, y: number): Obstacle | undefined;
  /** What stops a walker crossing the side of (x, y), or undefined. Undefined everywhere with no edges. */
  edge(x: number, y: number, side: "n" | "e" | "s" | "w"): Obstacle | undefined;
}
```

- A straight step is refused when an edge block that isn't a door stands on the line it crosses (`blocked`, "There's a wall in the way").
- A diagonal step is refused when either of the two straight two-step routes it cuts past would cross an edge, the same rule as the corner rule for blocks today. So nobody slips diagonally through the corner where two edge walls meet.
- Where no edge exists, `edge` returns undefined and `stepFrom` decides exactly as it does now. Every logged walk, putter and stroll replays the same.

Everything that walks goes through `Ground` already: `walkTree`, `route`, `walkOrWhy`, `rest`, the reach refusals, `openings.ts` exits, the design notes, the server's planners and the client's mirror. They get edges with no change of their own beyond building the `Ground`.

#### What holds things up

`HOLDING_BLOCKS` stay the rule. An edge of a holding kind on floor `f - 1` counts as a wall at both of its tiles when `floors.ts` asks whether flooring on floor `f` is held up within `FLOORS.span`. Taking down an edge that alone holds something up is refused (`holds_up`) with the same words as a wall block.

#### Roofs

`roofShape` reads walls through its `wall(x, y, floor)` fact. It gains an `edge(x, y, side, floor)` fact. A group of touching edges (edges that share a corner point) makes a box in corner coordinates, and the roof covers the tiles inside that box. A box must be at least `ROOFS.minSpan` (3) tiles across each way, as now. Wall blocks and edges that touch make one group, so a home that mixes them gets one roof.

#### Slimming an existing home

`slim_walls {px, py, floor?, dry?}` turns a home's wall blocks into edges. The server plans it and logs the plan's lists with the command, as it logs a putter's steps: `slim_walls {px, py, remove, walls}`. The sim checks those lists exactly as it checks a `build` by the resident, plus the one free top-up below. It never runs the planner, so improving the planner never changes replay.

The plan, for each floor asked:

1. Find the tiles a walker can't reach from the plot's edge without crossing a wall block: the inside.
2. Every wall block that borders the inside comes up. On each line between an inside tile (or a wall tile being taken up) and the outside, an edge of the same kind goes in: walls become walls, windows become windows, a door block becomes a door edge.
3. Where that line is the plot's own border, the edge moves one line in, since a border edge is refused.
4. Flooring, furniture and everything else stays where it is. A wall tile that came up is plain floor.

The starter hut becomes a 5 by 5 room with edges on all four sides, a window edge on east and west, and a door edge on the south, needing 20 edges for the 16 blocks it gave back. Free walls cost nothing.

The first slim on a plot is free for made materials too. Where the edges of a made material outnumber the blocks of it that came up, the town supplies the difference, once, and the plot records it with `slimmed: true` (absent until then). The top-up covers only edges that replace that home's own walls of the same kind, so it can't be used to get material for anything else. A later slim on the same plot, after it was rebuilt in blocks, costs the difference like any build, and the dry run says how many (`short`, as `build` does today).

#### New starter homes

`build_starter_home` is a logged command, so what it builds can only change behind a logged switch. Once `starter_edges` is logged by `TOWN_ACTOR`, a new starter hut is built from edges: the same 5 by 5 footprint, 25 tiles inside. Huts built before the switch stay block huts until their owner slims them. `starterHutGardenTiles` gains the edge layout's spots.

### 4. Drawing

- Map (2D): an edge is a slab about a fifth of a tile thick on its line, joined at corners into continuous walls, with windows and doors drawn in the line. Wall blocks keep their current look. A hung thing is drawn on the face it hangs on, and a small thing on its surface. Everything is drawn from `@terrakin/ui` code, so plot photos and link cards get it too ([decision 0035](../knowledge/decisions/0035-draw-with-code-first-and-rasterize-only-at-the-edge.md)).
- 3D: one `InstancedMesh` per edge kind with a turn per instance, posts at the corners, window and door pieces built the way `paneTurn` places them now. Hung things and small things are instanced by kind. The phone budget from [decision 0060](../knowledge/decisions/0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md) holds: the new meshes are measured on a dense plot before the slice ships.
- The build bar gets a Walls mode where tapping near a tile's side places an edge, and a "Slim the walls" button on a plot whose home is made of wall blocks, with the dry run's count shown first.

### 5. New things to own

Surfaces and walls are only worth having with things to put on them. The first set, all in the catalog with pictures, map and 3D looks:

| Role | Kinds | Where from |
|------|-------|-----------|
| surface (furniture) | `desk`, `side_table`, `dresser` | workbench, wood |
| `trinket` | `candle`, `table_lamp`, `book_stack`, `potted_fern`, `jar_of_shells`, `teacup`, `globe`, `music_box` | shop, or workbench from wood, finds and crops |
| `wall_decor` | `wall_clock`, `mirror`, `wreath`, `wall_shelf`, `sconce`, `pennant`, `hung_frame`, `fish_mount` | shop, or workbench (a fish mount takes a caught fish) |

Prices and recipes come from the economy run (below), not this table.

## Invariants

- Server decides: every new action is checked in the sim. The client holds back what the sim would refuse using the sim's own checks (decision 0052), as it does for `place` today.
- Determinism and replay: no clock or randomness. `tops`, `hung`, `edges` and each floor's `edges` are absent until an input that didn't exist before sets them, so `canonicalJson` skips them and every fixture keeps its pinned hash. `stepFrom` changes only where an edge exists, and no old log has one. `starter_edges` is a logged switch with a fixture on both sides. New fixtures: `surfaces-log.ts`, `hung-log.ts`, `edges-log.ts`, `slim-log.ts`.
- New kinds go on the end of `BLOCK_KINDS` (the three surfaces) and `STACK_KINDS` (trinkets and wall decor). Nothing joins a frozen list.
- Chat is untrusted: no new text. A hung frame shows a piece, which went through the upload checks already and is taken down like any piece ([decision 0065](../knowledge/decisions/0065-piece-picture-takedowns-tell-holders-and-purges-clear.md)).
- Protocol: additive: `side` on `place` and `remove`, `walls` and `removeWalls` on `build`, four new actions (`put_on`, `take_off`, `hang`, `unhang`) and `slim_walls` with its server-planned lists, `slimmed` on a plot, six new events, new kinds in the enums, and the rejection codes `not_a_surface`, `no_wall` and `plot_border`. One change can surprise a caller: a plot's map (RFC 0032) and its plan read gain an `edges` grid (below). An agent that ignores it still reads every block correctly but won't see walls between tiles, so SKILL.md says to read it. Nothing is removed.

## Economy impact (if any)

No new coin source. One small item source, and new sinks.

- Trinkets, wall decor and the three surfaces are sold at the shop (the treasury's share, the rest burned) or made at the workbench from gathered things. The town never buys them, so nothing mints.
- Edges cost what blocks cost. Free walls stay free, so no starter home or design gets more expensive. The first slim on a plot supplies the extra made-material edges it needs, about a quarter more than the blocks it gives back, once per plot (`slimmed`). Those edges stay on the wall: taking one down gives it back like any block, so a resident could slim, then pull the walls for the material. The most one plot can yield is a quarter of its made-material walls, once, which is a handful of plaster or brick. Most homes are free walls and get nothing.
- Things put on surfaces and hung on walls stay their owner's and come back whole, so nothing is duplicated: each is in exactly one of someone's things, a surface, a face, or held aside. `everyGood` and the merge rules count `tops` and `hung` the way they count pots and displays, and `merge_resident` moves them.
- Inventory stays capped at 400. More places to put things is what makes a bigger collection worth having, but the cap doesn't move here.
- `scripts/economy-sim.ts` gets decorators who buy a trinket or a wall piece when they hold a spare surface or face, with `--no-decor` to play the month without them. The numbers in the table above are set from that run and recorded in a decision.

## Security considerations (required)

- Walling in a neighbour: an edge must be inside your own plot or between two plots of your household (`plot_border`), so nobody can wall someone else's tiles, a street, or open land.
- Cutting a public way: an edge between two way tiles is refused (`public_ground`). A way inside a plot stays walkable end to end, and `ways.test.ts` gets the edge cases.
- Trapping a visitor: an owner can close an edge or a door edge behind someone, exactly as they can place a block today. `home` always works, and a resident with no way out is told the jump.
- Slipping through corners: the diagonal rule checks both straight routes, so two edges meeting at a corner seal it. `edges.test.ts` walks every diagonal past every corner shape.
- Hiding a pot or a piece to dodge a takedown or a merge: `tops` and `hung` are read by `everyGood`, the takedown purge and `merge_resident`, the same as displays. `own.test.ts` throws `__proto__` and friends at every new id-taking action.
- Size: a plot has at most 112 inside edges per floor, 64 surfaces and a bounded number of faces, so no input can grow the world past what a plot already allows.
- Prompt injection: nothing new carries text. Kinds, ids, coordinates and sides only.

## Agent experience

- SKILL.md gets a short "Rooms" section: put a thing on a table with `put_on`, hang one with `hang` on a side, build walls on the lines between tiles with `side`, and turn an old home into a roomier one with `slim_walls` (dry run first). Each refusal names the fix, as now: `no_wall` says which side has a wall, `plot_border` says to move the wall one tile in.
- Plot maps: a map's blocks grid stays as it is. A new `edges` grid draws the lines between tiles in the usual text style, two characters per tile, with a material letter where a wall stands:

A 3 by 3 room with a window on each side and a door to the south:

```text
+S+S+S+
S. . .S
+ + + +
G. h .G
+ + + +
S. . .S
+S+D+S+
```

The grid is two characters per tile plus one. `+` marks a corner. A letter on a line between corners is an edge block of that kind, using the letters of `MAP_BLOCKS`, except that a door is `D` here because `+` is taken. A space is no edge. The tile positions are written for orientation and ignored on read. `mapToPlan` reads the grid into `walls`, and `build` takes it as `edgesMap` beside `map`.
- Designs: the nine designs in `GET /v1/designs` gain edge versions, offered once `starter_edges` is on, so an agent building a first home gets the roomy one.
- The check-in says nothing new. A plot's read (`GET /v1/plots/{px}/{py}/plan`) adds `tops`, `hung` and `edges`.

## Migration and rollout

Nothing replays differently. Every addition is new state, new actions or a new switch.

Built in slices, each its own push:

1. Surfaces and hanging in the sim, with the new kinds, fixtures and the economy run. Then the API and SKILL.md, then the map, 3D and plot photos.
2. Edges in the sim: `edges.ts`, `Ground.edge`, `stepFrom`, `place`/`remove`/`build` with `side`, holding up, roofs. Then the protocol, the plot map's edges grid and SKILL.md. Then the drawing and the build bar's Walls mode.
3. `slim_walls`: the server planner, the action, the build bar button.
4. `starter_edges` and the designs' edge versions, switched on at terrakin.org after a look at slimmed homes in play.

Old clients keep working until they meet an edge: one that doesn't draw edges shows a room with no walls, and the server still refuses the walk through one. The web ships with its slice, so only a stale tab sees that.

## Alternatives considered

- Draw today's wall blocks thin. Rooms look roomier and hold exactly what they hold now, the tile beside a thin wall looks walkable and isn't, and nothing new can be owned or placed. Dropped.
- A finer building grid (each tile split 2 by 2 for blocks). It gives density everywhere but quarters every coordinate in the API, every plan and every map, and changes every logged `place`. Far larger than edges for less.
- A bigger starter hut or a bigger plot. RFC 0044 weighed the hut: two hut sizes forever, and the existing huts gain nothing. A bigger plot changes every coordinate downtown. Edges give every existing home the room through `slim_walls`.
- Several things per tile, freely stacked. No limit means no picture of what a tile holds and unbounded state. One surface thing and one face thing per spot keeps it drawable and countable.
- Refuse to take down a wall with something hung on it. Consistent with planters and pedestals, but it would make every plan that moves a wall and every town rebuild fail on one clock. Giving it back is safe because it goes to whoever hung it.

## Decided

Ryan's calls on the draft's open questions, 2026-10-29.

1. Edges on a plot's own border stay refused. A single plot's biggest room is 6 by 6 (36 tiles, against the hut's 9 today), with a one-tile yard kept around every home for its way out and the walk between homes. Allowing border edges that face a way, a street, the sea or open land is for later, once homes are in use.
2. A home across a household's two plots gets two roofs, one per plot, as roofs work now. Joining them waits until people build across the line.
3. The first `slim_walls` on a plot is free for made materials, as the Slimming section describes.
4. No more walked-onto furniture in this RFC. It waits to see how full homes get.
5. A furnished-home measure is a follow-up of its own after surfaces and hanging ship. No rule reads it, so it needs no RFC.

## Open questions

None left from the draft.
