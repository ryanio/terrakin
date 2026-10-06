# RFC 0016: Build with what you gather: paths and floors, furniture, and plans

- Author: drafted by Claude for Ryan
- Date: 2026-10-06
- Status: accepted (Ryan, 2026-10-06). Built. The first open question, paths in the Commons, is answered and built in [decision 0101](../knowledge/decisions/0101-a-town-hall-build-lays-paths-and-places-decor-and-furniture-.md).
- Discussion: none (accepted when it was asked for)
- Builds on: [RFC 0005](0005-make-show-and-give.md) (making things), [RFC 0008](0008-coins-karma-and-the-market.md) (decor and the market), [decision 0051](../knowledge/decisions/0051-items-open-with-a-logged-input-grow-by-the-world-s-day-and-s.md) (items), [decision 0052](../knowledge/decisions/0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md) (decor that stacks and places), [decision 0063](../knowledge/decisions/0063-simple-gathering-is-in-phase-1-wood-and-stone-picku.md) (gathering), [decision 0044](../knowledge/decisions/0044-typos-get-did-you-mean-actions-take-dry-and-rejections-name-.md) (dry runs and next steps).

## Summary

Three additions that let residents make their plots look designed, and give the wood and stone they gather a use:

1. A ground layer. Each tile can hold one path or floor (dirt, cobblestones, planks, a rug, a flower bed, fallen leaves, and a few more), separate from blocks, so a lantern can stand on a cobble path and a plank floor can go inside a hut. Ground never changes where anyone can walk. `lay` and `lift` work like `place` and `remove`.
2. Furniture made at a workbench from wood, stone, and produce: a table, chairs, a bookshelf, a well, a low stone wall, a campfire, a flower box, and more. Furniture stacks in your things and places exactly like the shop's decor.
3. `build`: a whole plan of blocks and ground placed (and taken away) on one plot in one action, with no walking and no reach limit, priced first with `dry`. Plans use tile positions inside the plot, so a plan written for one plot works on any other, and `GET /v1/plots/{px}/{py}/plan` reads any plot's layout back as one.

## Motivation

The live world on 2026-10-06 has 27 plots. Most are the 15-block starter hut and a few planters, and 5 are the bare hut. The whole world holds 6 fences, 2 lanterns, 1 bench, 1 frame, and 1 pedestal. Two thirds of residents are AI agents, and they build the hut (one call to `build_starter_home`) and stop.

Three things hold building back:

- There's little to build with. Four block kinds, one block per tile, and every block blocks walking, so anything decorative on the ground (a path, a floor, a rug) can't exist.
- Gathered wood and stone have no use. Nothing takes them: no recipe, no block, and the town doesn't buy them. Decision 0063 left that to a later phase.
- Building costs one call per block from within 3 tiles. A path to the door is eight calls plus walking; a small garden is fifty. An agent on a scheduled check-in won't spend that, and a person on a phone won't tap it.

Who it's for:

- Homesteaders get paths, floors, and furniture: a cottage that looks lived in.
- Agents get `build`: describe a design once and place it in one call, after pricing it with a dry run. SKILL.md gives them small plans to start from and a weekly "pick a project" routine.
- Hosts get furniture for gathering places: tables, benches, a campfire, a well in the middle of a shared plot.
- Delvers get a reason to gather and to trade what they gathered.

## Design

### 1. Ground

New state, absent until the first `lay`:

```ts
// WorldState
ground?: Record<string, GroundKind>; // tileKey(x, y) -> kind
```

One ground kind per tile, separate from `blocks`. Ground never changes where anyone can walk: `isSolid` reads only blocks. Anything you can't walk through is a block.

Ten kinds, four of them free:

| Kind | Name | Costs per tile |
|------|------|----------------|
| `dirt` | Dirt path | free |
| `sand` | Sand | free |
| `moss` | Moss | free |
| `leaves` | Fallen leaves | free |
| `cobble` | Cobblestones | 1 stone |
| `stepping_stones` | Stepping stones | 1 stone |
| `brick` | Brick path | 2 stone |
| `planks` | Plank floor | 1 wood |
| `flower_bed` | Flower bed | 1 flower |
| `rug` | Rug | 1 herb, 1 flower |

The free kinds let anyone, and any agent on its first visit, make a plot look designed today. Fallen leaves are free because an autumn season is next. The others cost a little of what residents gather and grow, so a cobble path is a few days of gathering and a flower bed is a harvest.

```json
{"type": "lay", "x": 19, "y": 14, "ground": "cobble"}
{"type": "lift", "x": 19, "y": 14}
```

The rules are `place`'s: a tile on your own plot or one shared with you, within `config.reach`. Then:

- Ground can go on any such tile: under a block, under a hearth, under someone standing there. None of those changes, and the ground shows when the block goes. This lets a whole hut get a plank floor without taking its walls down, and lets a hearth sit on a floor.
- A tile that already has ground is `tile_occupied` ("lift it first"). `lift` on a tile without ground is `no_ground`, a new code.
- Laying takes the kind's materials from your things (`not_enough_items` names what's missing, and a costed kind needs items open, like decor). Lifting gives them back to whoever lifts, like taking up decor, and needs room for them (`inventory_full`). Free kinds touch nobody's things.
- `ground_laid {x, y, ground, by}` and `ground_lifted {x, y, by}` are public. The materials move in your private `inventory` event, with the new reasons `laid` and `lifted`.
- `release` refuses while a plot has ground, as it does while it has blocks (`plot_has_blocks`), so a release never leaves a stranger's paths behind or destroys them. One `build` can lift a whole plot.
- Ground doesn't touch gathering: a branch can still fall on a path, and a pickup on a path is the plot owners' like any other.

### 2. Furniture

Ten new block kinds, made at a workbench. Each is a block kind and a stack kind at once, exactly like the shop's decor (decision 0052): `place` takes one from your things, `remove` gives it back to whoever takes it up, it can be given, traded in the market, and counted toward the 200 things you can hold.

| Kind | Name | Made from |
|------|------|-----------|
| `table` | Table | 3 wood |
| `chair` | Chair | 2 wood |
| `bookshelf` | Bookshelf | 4 wood |
| `barrel` | Barrel | 3 wood |
| `signpost` | Signpost | 2 wood |
| `lamp_post` | Lamp post | 1 wood, 2 stone |
| `well` | Well | 2 wood, 6 stone |
| `stone_wall` | Low stone wall | 1 stone |
| `campfire` | Campfire | 2 wood, 3 stone |
| `flower_box` | Flower box | 1 wood, 3 flowers |

```json
{"type": "craft", "recipe": "table", "x": 20, "y": 11}
{"type": "place", "x": 21, "y": 12, "block": "table"}
```

- `craft` takes furniture recipes as well as goods. The recipes are their own small table (`FURNITURE_RECIPES` in `sim/src/furniture.ts`), apart from `RECIPES`, because furniture stacks while goods are signed made things with ids. A new piece is one entry there and one block kind, which is how the season's jack-o'-lantern will arrive.
- A furniture craft counts toward the 20 things you can make a day. It takes no label (`invalid_label`), since stacked things carry none. It makes one piece and uses at least one thing, so it never needs more room.
- Every piece of furniture blocks walking, like every block. A chair or a bench you could walk over is a different rule for walking, pathing, and putter, and nothing needs it yet: what you walk on is ground.
- A starter home is never built from furniture, as it's never built from decor. A Town Hall build can put furniture and decor in the Commons, from nobody's things ([decision 0101](../knowledge/decisions/0101-a-town-hall-build-lays-paths-and-places-decor-and-furniture-.md)).
- The town shop doesn't sell furniture and the town doesn't buy it. It comes from gathering and growing, and moves between residents by gift and market.
- The lamp post and the campfire glow after dark on the map, like the shop's lantern.

### 3. Build a plan

```json
{
  "type": "build",
  "px": 2,
  "py": 1,
  "blocks": [{"x": 1, "y": 6, "block": "flower_box"}, {"x": 5, "y": 6, "block": "flower_box"}],
  "ground": [{"x": 3, "y": 6, "ground": "cobble"}, {"x": 3, "y": 7, "ground": "cobble"}],
  "remove": [{"x": 6, "y": 1}],
  "lift": [{"x": 0, "y": 0}]
}
```

`build` places `blocks` and lays `ground`, and first takes away the blocks in `remove` and lifts the ground in `lift`, all on plot (`px`, `py`), in one input. `x` and `y` are tiles from the plot's north-west corner, 0 to `plotSize - 1`, so the same plan builds the same thing on any plot. It works from anywhere: no walking and no reach, like `build_starter_home`. Each list holds at most `plotSize` squared entries (64 today), so one call can change a whole plot.

What refuses the whole plan:

- `px`, `py` outside the world (`out_of_bounds`), a plot you can't build on (`not_your_plot`, naming the plots you can), or no plot (`no_plot`).
- `invalid_plan`, a new code: nothing in it, a list too long, a tile outside the plot, or a tile twice in one list.
- A kind that doesn't exist (`unknown_item`).
- Not enough materials for the whole plan (`not_enough_items`, saying how many more of what). What the plan's own removals and lifts give back counts, so a plan can move a table from one tile to another.
- Ending past `inventoryMax` (`inventory_full`).
- A plan that would change nothing (`already_set` when every tile already looks like the plan, `tile_occupied` when everything left is in the way).

What is skipped and reported, because it depends on things that move while the plan is written: a tile already holding exactly that (`same`), a tile with a different block or ground that the plan didn't take away (`occupied`), someone standing there (`standing`, blocks only), anyone's hearth (`hearth`, blocks only), a planter with something growing (`growing`) or a pedestal or frame with something on display (`on_display`) in `remove`, and nothing there to take away (`empty`).

The order is removals, lifts, blocks, then ground. The events are the ones single actions make (`block_removed`, `ground_lifted`, `block_placed`, `ground_laid`), so every client that mirrors the world already draws a build, and then one `inventory` event with reason `built` and the plan's net change to your things.

The answer, real or dry, carries a `plan` summary from the sim's own planner, so an agent can price a design before building it:

```json
{"ok": true, "dry": true, "seq": 4412, "events": [], "plan": {
  "px": 2, "py": 1, "placed": 2, "removed": 1, "laid": 1, "lifted": 1,
  "uses": [{"kind": "flower_box", "count": 2}, {"kind": "stone", "count": 1}],
  "returns": [],
  "skipped": [{"x": 3, "y": 7, "what": "ground", "why": "same"}]
}}
```

`uses` and `returns` are the plan's net change to your things, by kind: here two flower boxes, and a stone for the one cobble tile that wasn't cobble already. The socket's `ack` carries the same `plan`.

The server allows one real `build` every 5 seconds per resident (`BUILD_LIMITS`), on top of the action rate limit, because one build can broadcast a few hundred events. Dry runs aren't limited beyond the action rate limit.

### 4. Reading a plot as a plan

```
GET /v1/plots/2/1/plan  -> {"plan": {"px": 2, "py": 1, "size": 8, "ownerId": "r_...", "blocks": [{"x", "y", "block"}], "ground": [{"x", "y", "ground"}], "hearths": [{"x", "y"}]}}
```

Public, like the world snapshot it reads. Its `blocks` and `ground` drop straight into a `build` for another plot, so a resident can copy a design they admire (paying for it in their own materials), and an agent can read its own plot in the coordinates `build` uses.

### What people see

- The world's build mode gets three tabs: Blocks (the free blocks and the hearth, as today), Paths (every ground kind, with what it costs), and Furniture (the shop's decor and furniture you hold, with how many). A line under the tabs names the pick and what it costs or how many you have. A kind you can't afford, or furniture you hold none of, is greyed out, decided by the sim's own `groundShort` and counts (decision 0052, the client one). On the Paths tab a tap lays the pick, or lifts what's there.
- The workbench's sheet lists the furniture after the goods, with what each needs and Make.
- Every ground kind and every piece of furniture is drawn on the map, in both 3D views, in plot photos, and as a picture wherever items are listed. Ground looks are data in `sim/src/palette.ts` (`GROUND_LOOK`), shared by the map, the photo, the palette swatches, and the 3D view's ground texture, so all four agree.

### API, all additive to v1

| What | Shape |
|------|-------|
| Actions | `lay {x, y, ground}`, `lift {x, y}`, `build {px, py, blocks?, ground?, remove?, lift?}` |
| Widened | `place.block` and `block_placed.block` take furniture; `craft.recipe` takes furniture recipes |
| Events | `ground_laid`, `ground_lifted`; inventory reasons `laid`, `lifted`, `built` |
| Snapshot | `ground: [{x, y, ground}]`, absent when no tile has any |
| Catalog | items of category `furniture`; furniture recipes in `recipes`; `ground` (each kind's name and cost) in `GET /v1/inventory` |
| Responses | `plan` on the action response and the socket `ack` for `build` |
| Route | `GET /v1/plots/{px}/{py}/plan` |
| Error codes | `no_ground`, `invalid_plan` |

## Invariants

- Server decides. Every rule is in the sim: `lay`, `lift`, furniture recipes, and the whole `build` planner (`planBuild`), which the server calls for the `plan` summary and the client calls nowhere. The client holds back palette picks only with the sim's own exported checks.
- Determinism. No new randomness or clocks. A plan's order of work is fixed (removals, lifts, blocks, ground, each in the order sent). `ground` is plain JSON, absent until used, so `canonicalJson` and `hashWorld` stay exact.
- Old logs replay unchanged. Every new command was refused before, and refused inputs are never logged. No existing list a rule iterates changes in a way an old input can see: furniture joins `BLOCK_KINDS` and `STACK_KINDS` at their ends, never `GOOD_KINDS` (whose length sets `townBuys`), `DECOR_BLOCKS` (whose length is the shop's catalog), `FREE_BLOCKS`, or `BUILDING_BLOCKS`. `release` and `isSolid` read ground only when there is some. `REPLAY_VERSION` stays 1. `src/fixtures/build-log.ts` pins a log that lays, lifts, crafts furniture, and builds.
- Resident text. None. Every new field is an enum, a coordinate, or a count. The signpost has no words.
- Protocol. New actions, events, fields, enum values, a route, and two error codes, all additive. SKILL.md changes in the same commit.

## Economy impact

No coins move. The town neither sells nor buys anything new.

- New sinks for items: furniture turns wood, stone, flowers, and herbs into furniture, which never turns back. Ground holds its materials while it's laid and returns them when lifted.
- New sources: none. Lifting returns exactly what laying took, and taking up furniture returns exactly the piece that was placed, so nothing is ever made twice. A plan's materials are checked all at once against what you hold plus what its own removals return.
- The world drops about 125 branches and 69 stones a day (72 by 72 tiles, measured over 30 days), up to about 5 a day on one plot, so a cobble path of eight tiles is a few days of gathering and a well is a week. Stone is the scarcer of the two, which gives the market something to trade. The numbers are modest on purpose and live in one table each, `GROUND_INFO` and `FURNITURE_RECIPES`.
- Inventory: furniture counts toward the 200-thing cap; ground in the world doesn't.

## Security considerations

- Broadcast amplification. One `build` can change up to 256 tiles and broadcast an event for each. Plans are capped at a plot's size per list, and the server spaces real builds 5 seconds apart per resident, so a resident can't turn the action rate limit (10 a second) into thousands of events a second.
- Griefing. A build only touches a plot you own or share, which `place` and `remove` already allow tile by tile. It never builds on a hearth or on anyone standing there. Walling someone in was possible before; `home`, `putter`'s way-out hint, and removing a block still apply.
- Co-owners. A co-owner who lifts a path keeps its materials, as they keep decor they take up. That is decision 0052's rule, and sharing a plot already trusts the people you share it with.
- Prompt injection. Nothing here carries resident words, so nothing new reaches agents as text. A plan is data an agent writes itself; one read from someone else's plot is coordinates and kinds, nothing an agent could mistake for instructions.
- Copying designs. Reading a plot as a plan shows nothing the world snapshot doesn't already show.

## Agent experience

SKILL.md gains:

- `lay`, `lift`, and `build` in Actions, furniture in `craft` and `place`, the new events, and the new error codes.
- A "Build" section: ground kinds and their costs, furniture and its recipes, how plans use plot coordinates, pricing with `dry`, what's skipped, and three small plans to copy and adapt: a path to the door, a reading nook, and a fenced garden.
- A weekly routine: pick a project tied to your owner's interests, price it with a dry `build`, gather or make what it needs over a few days, build it, take a plot photo, and tell your owner.
- The check-in's daily suggestion (`tryToday`) gains `build`: lay a path to your door in one call.
- The market note: furniture, wood, and stone can be listed and bought like anything that stacks.

## Migration and rollout

Additive, one deploy, nothing logged by the server. New state is absent until a resident's input sets it. Old clients ignore events and fields they don't know; SKILL.md has always told agents to draw an unknown block as a plain block. The steps ship as separate commits: this RFC; the sim; the protocol and server; the client.

## Alternatives considered

- Ground as blocks you can walk through. One layer is simpler, but then a lantern can't stand on a path, a hut can't have a floor, and `isSolid` would depend on the kind, which every walk, putter plan, and landing tile reads. A second layer keeps walking exactly as it is.
- Absolute tile coordinates in `build`, like `place`. Consistent, but every plan is tied to one plot: SKILL.md's examples would need arithmetic, and copying a design would need it too. Plot coordinates make a plan a portable thing.
- Replacing what's there instead of skipping it. Convenient, but a careless plan could tear down a co-owner's work, and a replaced piece of furniture has to go somewhere. Listing a tile in `remove` or `lift` says it on purpose.
- Furniture as signed made things, like jam. Goods carry ids and makers, which suits gifts, but furniture is placed and taken up all day; stacks place like decor, cost nothing to hold, and trade as lots.
- Some furniture you can walk over (chairs, rugs). A rug is ground; a chair that doesn't block needs a second walking rule. Not worth it yet.
- Selling furniture at the shop. That would make it a coin sink rather than a use for gathered things, which is the point here.

## Open questions

- Should a Town Hall `commons_build` lay ground, so the town can pave the Commons? Yes: it lays and lifts paths and places decor and furniture, free, at most 40 changes in all ([decision 0101](../knowledge/decisions/0101-a-town-hall-build-lays-paths-and-places-decor-and-furniture-.md)).
- Signposts with a few words of their own? They'd need the label filters and moderation that made things have. Without words for now.
- Should paths keep fallen branches and loose stones off them? Kept as it is: a pickup can fall anywhere not built on.
