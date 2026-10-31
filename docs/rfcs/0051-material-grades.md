# RFC 0051: Material grades: fine and masterwork walls

- Author: drafted by Claude for Ryan
- Date: 2026-10-30
- Status: accepted
- Discussion: <PR link>
- Builds on: [RFC 0041](0041-materials-and-roofs.md) (made materials and roofs), [RFC 0050](0050-roomier-homes.md) (walls between tiles, `slim_walls`, the furnished measure), [RFC 0047](0047-trades-and-your-mark.md) (a roll the server logs for a kiln's finish), [RFC 0029](0029-levels-and-skills.md) (levels never change odds), [RFC 0008](0008-coins-karma-and-the-market.md) (the market), [decision 0322](../knowledge/decisions/0322-made-materials-are-a-role-of-their-own-never-learned-and-nev.md) (materials are never learned and never free), [decision 0400](../knowledge/decisions/0400-a-furnished-home-counts-furniture-and-seats-as-pieces-and-wh.md) (the furnished measure, counts only)

## Summary

Ryan chose grades of material as the way a home gets better. This RFC proposes three grades for the five made materials: plain (what every made material is today), fine, and masterwork.

Fine is made on purpose: the same workbench recipe plus one find, making fewer. Masterwork is luck on top of that: each fine craft has a small chance, rolled by the server and logged with the input the way a kiln's finish is, of coming out masterwork, with a floor so nobody goes without one for long.

A grade is a property on a stack and on a placed wall, never a new kind. It changes how a wall looks on the map, in 3D, in plot photos and in item pictures, and it adds counts to a plot's read. It changes no rule: walking, holding up floors, roofs, coins and points work exactly as they do for plain. The four free blocks have no grade and stay free.

## Motivation

The persona is the homesteader, with the delver's chase as a second reason.

RFC 0041 gave homes a choice of what they are made of. RFC 0050 gave them room inside. Neither gives a home a way to get better over time once it is built. A brick home on day five and a brick home on day fifty look the same. The only thing left to work toward on a finished home is more furniture, which RFC 0050 already counts.

Grades give a built home a direction: the same walls, better made, a few at a time. A resident can redo the front of the house in fine brickwork this week and the doorway in masterwork when the roll comes up. A neighbour can see the difference from the street, and a plain home next door looks exactly as it did.

It also gives finds a steady use. RFC 0041 pointed out that the seventeen finds mostly lead to the collection book and a pedestal; made materials gave two of them, driftwood and sea glass, a use. Fine grades spend four more kinds (seashell, pinecone, crystal and clay), one each, every craft.

The mission promises "gear with real usefulness and real rarity". Gear rarity is still its own RFC (RFC 0029 and RFC 0030 sketched it), and its usefulness is power. A material's grade is rarity with no power at all, which is the safer place to start: it tests whether people chase a better-looking thing before anything chases a stronger one.

## Design

### The ladder

```ts
/** A made material's grade (RFC 0051). Plain is every material before grades, and is never stored. */
export const GRADES = ["plain", "fine", "masterwork"] as const;
export type Grade = (typeof GRADES)[number];
```

Three, fixed, append-only like every list the sim hashes. Only the five made materials (`MATERIAL_KINDS`: `plaster`, `brickwork`, `timber_frame`, `driftwood_plank`, `sea_glass_pane`) have grades. A free block (wood, stone, glass, leaf), a door, furniture and decor are refused a grade (`ungraded`).

Plain is never written anywhere. Absent means plain, in state, in commands, in events and on the wire, so every material that exists today is already plain and nothing about it changes.

### Getting a grade

#### Fine: the recipe plus one find

A material's craft takes an optional `grade`:

```json
{"type": "craft", "recipe": "plaster", "x": 12, "y": 9, "grade": "fine"}
```

A fine craft takes the plain recipe's inputs plus one finishing thing, and makes 2 instead of 4. One table in `materials.ts`, `FINE_RECIPES`, frozen once live:

| Material | Plain (today) | Fine | Why that find |
|----------|---------------|------|---------------|
| `plaster` | 2 stone, makes 4 | 2 stone, 1 seashell, makes 2 | shells burned for lime |
| `brickwork` | 2 stone, 1 wood, makes 4 | 2 stone, 1 wood, 1 clay, makes 2 | a fired clay face |
| `timber_frame` | 1 plaster, 2 wood, makes 4 | 1 fine plaster, 2 wood, makes 2 | a better input, no find |
| `driftwood_plank` | 3 driftwood, makes 4 | 3 driftwood, 1 pinecone, makes 2 | resin to seal it |
| `sea_glass_pane` | 2 sea glass, makes 4 | 2 sea glass, 1 crystal, makes 2 | a clearer pane |

These numbers are a starting point for the economy run (below), not a decision. The shape is what this RFC asks for: a fine unit costs a little over twice a plain one, plus a find from a different biome than the base, so a fine home asks you to walk.

Fine brickwork needs clay, which lies only in a world that logged `open_clay` (terrakin.org has; self-hosted worlds and `pnpm dev` do not). In a world without clay a fine brickwork craft is refused with the same `not_enough_items` words any missing input gets, and the catalog says so.

A recipe's input is always plain unless the table says otherwise. Plain timber frame takes plain plaster, fine timber frame takes fine plaster, and neither will take the other.

#### Masterwork: a roll on a fine craft

Every fine craft carries a roll the server draws and logs, as it does for a cast (RFC 0023) and a kiln (RFC 0047). The sim never rolls.

```json
{"type": "craft", "recipe": "plaster", "x": 12, "y": 9, "grade": "fine", "roll": 7311}
```

```ts
export const GRADING = {
  /** A roll is a whole number from 0 to one less than this. */
  outOf: 10_000,
  /** A fine craft whose roll is below this comes out masterwork: 8 in 100. */
  masterwork: 800,
  /**
   * A gentle floor: a resident's fine crafts with no masterwork among them in a row, after which
   * the next comes out masterwork whatever its roll. Counted in the sim, as pottery's `finishFloor`.
   */
  floor: 15,
} as const;
```

The roll decides the whole batch: both units of a craft come out fine, or both masterwork. The floor counter lives in `items.fineRun?: Record<ResidentId, number>`, absent until the first fine craft, reset to 0 by a masterwork.

There is no masterwork recipe. Masterwork costs what fine costs and comes from practice and luck, the same chase pottery's iridescent finish has. At 8 in 100 a resident gets a masterwork pair about every twelve fine crafts, so masterwork is for a doorway, a front window or a chimney breast, not a whole home. That is on purpose, since a town where every home is all masterwork would read the same as one where none is.

#### What does not give a grade

- Skill level. `packages/sim/AGENTS.md` says no action, coins, odds or caps read a level, and RFC 0047 turned down finish odds that rise with Making for the reason that holds here: it ties rarity to grind and gives the most-played accounts the best-looking homes.
- A recipe card. Materials are never learned (decision 0322), and a card would make the grade a purchase.
- The shop. The town never sells a material, and it does not start with graded ones.
- Upgrading in place. There is no action that turns a placed plain wall fine. You make fine material and swap the wall, which `build` already does in one call.

### Where a grade lives

A grade is a property, never part of the kind. `BLOCK_KINDS`, `STACK_KINDS`, the catalog and every frozen list stay exactly as they are.

#### In your things

```ts
interface Inventory {
  stacks: Partial<Record<StackKind, number>>;
  goods: Good[];
  /** Graded made materials (RFC 0051), past plain. Absent until the first one. */
  graded?: Partial<Record<MaterialKind, { fine?: number; masterwork?: number }>>;
}
```

`stacks.plaster` keeps meaning plain plaster, so `held(inv, "plaster")`, every recipe's needs and every caller that reads a stack today keep their meaning untouched. `graded` holds the rest. `inventorySize` counts every unit in both toward the cap, as it counts everything now. A new `heldGraded(inv, kind, grade)` reads a grade, and `addStack` gains a grade argument that defaults to plain.

#### On the ground and on the lines

One sparse record per layer, beside the blocks and edges it describes:

```ts
interface WorldState {
  /**
   * The grade of each graded wall on the ground floor (RFC 0051), keyed by `tileKey` for a block
   * and `edgeKey` for a wall between tiles. Absent until the first graded wall. Plain is never here.
   */
  grades?: Record<string, "fine" | "masterwork">;
}
// Each floor in state.floors gains the same optional record: { blocks, ground, edges?, grades? }.
```

A tile key (`"10,11"`) and an edge key (`"10,11,n"`) never collide, so one record serves both. Readers go through `gradeAt(state, key, floor)` in a new `packages/sim/src/grades.ts`, the way edges go through `edgeAt`. A grade is deleted with its wall: whatever removes a block or an edge also removes its key from `grades`, in the same commit.

#### On a roof

`PlotRoof` gains `grade?`. A roof in fine brickwork costs `blockNeeds(material)` times `ROOFS.blocks` of fine brickwork, taken when it goes up and given back at that grade when it changes or comes down.

#### Held aside, in the market, and in a present

Anywhere a material can wait for someone carries its grade:

- `Listing` gains `grade?`. A graded lot is a lot of one kind at one grade, escrowed from `graded` and given back there.
- A held-aside entry for a material gains `grade?`.
- A wrapped present and a gift kept for `decline_gift` carry `grade?`.

### Commands

Everything that names a made material takes an optional `grade`. Nothing that takes a material back does: what comes back is the grade that was there.

```json
{"type": "place", "x": 10, "y": 9, "block": "brickwork", "grade": "fine"}
{"type": "place", "x": 10, "y": 9, "side": "n", "block": "sea_glass_pane", "grade": "masterwork"}
{"type": "remove", "x": 10, "y": 9, "side": "n"}
{"type": "set_roof", "px": 3, "py": 4, "style": "gable", "material": "brickwork", "grade": "fine"}
{"type": "give", "item": "plaster", "count": 4, "grade": "fine", "to": "r_81"}
{"type": "list_item", "item": "driftwood_plank", "count": 6, "grade": "fine", "price": 40}
```

`build` takes `grade` on any entry of `blocks` and `edges`:

```json
{"type": "build", "px": 3, "py": 4,
 "removeEdges": [{"x": 2, "y": 0, "side": "n"}],
 "edges": [{"x": 2, "y": 0, "side": "n", "block": "brickwork", "grade": "masterwork"}]}
```

A plan's running view counts each kind at each grade separately, so a plan that swaps a plain wall for a fine one gives back one plain and takes one fine. The plan summary's net change and a dry run's shortfall name the grade: "This plan needs 3 fine brickwork more than you have."

`slim_walls` keeps the grade of every wall it moves: each edge the server's plan puts up names the grade of the block it replaces (`packages/server/src/slim-plan.ts` reads `gradeAt`). The sim checks the lists as it does today, counting by kind and grade.

`clear_block` gives the plot's owner back the grade that stood there. `rebuild_home` goes through `checkBuild`, so it does too.

`merge_resident` moves `graded` with the rest of the inventory and drops `from`'s `fineRun`, since the floor is a kindness to a run of crafts, not a balance.

### Events

Each carries `grade` only when it is past plain, so every event an old log made is byte for byte the same.

```json
{"type": "block_placed", "x": 10, "y": 9, "block": "brickwork", "grade": "fine", "by": "r_12"}
{"type": "edge_placed", "x": 10, "y": 9, "side": "n", "block": "sea_glass_pane", "grade": "masterwork", "by": "r_12"}
{"type": "roof_set", "px": 3, "py": 4, "style": "gable", "material": "brickwork", "grade": "fine"}
{"type": "inventory", "residentId": "r_12", "reason": "craft",
 "changes": [{"kind": "stone", "amount": -2, "count": 9},
             {"kind": "seashell", "amount": -1, "count": 2},
             {"kind": "plaster", "grade": "masterwork", "amount": 2, "count": 2}]}
```

`block_removed` and `edge_removed` need no grade: the mirror already knows what stood there. `listed` carries it inside the listing, and `listing_sold` beside the kind.

### Rejections

- `ungraded`: "Only made materials come in grades. Wood, stone, glass and leaf are always free." For a grade on anything else.
- `not_enough_items`, with the grade in its words: "You have no fine brickwork. Make some at a workbench with craft {"recipe": "brickwork", "grade": "fine"}."
- `grades_closed`: a grade before the switch (below).

### What a grade changes

A grade changes how a wall is drawn and adds counts to a plot's read. No rule reads it.

#### Looks

`wall-look.ts` gains `GRADE_LOOK`, marks laid over a wall's own `WALL_LOOK`. They are the same for every material, so a grade reads the same way on brick as on driftwood.

A fine wall gets a crisp line along the top and bottom of its face (a plinth and a cornice) and slightly darker joints. A masterwork wall gets those plus a small carved mark in the middle of the face and a lighter catch along its top, enough to pick out from across the street.

The map paints one sprite per kind and grade (10 more), both 3D views one small texture per kind and grade (10 more, within decision 0060's phone budget, measured on a dense plot before the slice ships), and plot photos and pictures by link draw the marks. A roof draws the same marks on its covering.

An item's picture in your things, the market and the build bar gets a corner mark: one dot for fine, a small star for masterwork. Its name reads "Fine brickwork" and "Masterwork brickwork" everywhere, the same words on the web and the API.

#### Counts

A plot's read (`GET /v1/plots` and `GET /v1/plots/{px}/{py}`) gains `walls: {fine, masterwork}`, the graded walls on every floor, blocks and edges together, with a graded roof counting as one. It sits beside RFC 0050's `furnished` and follows decision 0400's rules: counts only, absent when both are 0, and no rule reads it. Plots to visit can show it on the card ("12 fine walls"); nothing sorts or ranks by it.

The plot market's listing view shows the same counts, so a buyer can see what the home is made of. A plot's price stays the seller's: no rule values a plot.

#### What it does not change

- Holding up floors: `FLOORS.span` and `HOLDING_BLOCKS` read the kind, never the grade.
- Roof size: `roofShape` reads walls, never grades.
- Walking, reach, exits and design notes: no change.
- Coins and points: a fine craft earns the same `PROGRESS.craft` points as any craft and counts once against `ITEMS.craftPerDay`. A grade is not a kind, so it earns no first-time bonus and adds nothing to the collection book.
- Jobs: no job asks for a grade, as RFC 0030 said no job asks for luck.
- Designs and starter homes: they build in the free four, which have no grade, so a newcomer's first home costs exactly what it costs today.

### The plot map

A map's `legend` already gives each made material a digit. A graded material gets its own digit, and a new `grades` record beside the legend says which digits are graded:

```json
{
  "legend": {"0": "brickwork", "1": "brickwork", "2": "sea_glass_pane"},
  "grades": {"1": "fine", "2": "masterwork"},
  "floors": [{"floor": 0, "blocks": ["....", ".00."], "ground": ["....", "...."],
              "edges": ["+1+1+1+", "0. . .0", "..."]}]
}
```

`mapToPlan` turns a digit with a grade into a `grade` on the plan entry, in the protocol, before the sim sees it, so the log holds lists as it does now (decision 0280). A digit with no `grades` entry is plain, so every map an agent writes today reads the same. The legend's limit of ten digits counts graded kinds like any other.

### The switch

Nothing about grades runs until `TOWN_ACTOR` logs `open_grades`. Before it a `grade` anywhere is refused (`grades_closed`), so the server can ship the sim and the API before the art is drawn, and a world turns grades on once all of it is.

## Invariants

- Server decides. Every grade is checked in the sim: that the kind has grades, that you hold that grade, that the roll is in range. The client offers a grade only when the sim's own check would take it, as the build bar does for materials now.
- Determinism. The sim never rolls. A fine craft's `roll` is drawn by the server with `fairRoll(GRADING.outOf)` and logged with the input; the sim refuses a fine craft with no roll, a roll out of range, or a roll on any other craft. The floor is counted in state. `FINE_RECIPES` and `GRADING` are frozen once a live world logs `open_grades`; new numbers are a new table behind a new switch, as pottery's are.
- Replay. Every new field (`graded`, `grades` on each layer, `fineRun`, `grade` on a roof, a listing, a held-aside entry and a present) is absent until an input that never existed before sets it. `canonicalJson` skips absent fields, so every fixture keeps its pinned hash and `REPLAY_VERSION` does not move. New fixture: `src/fixtures/grades-log.ts`, with inputs on both sides of `open_grades`, a masterwork from the roll and one from the floor, a graded slim, a graded roof, and a graded listing sold.
- Chat is untrusted. A grade is an enum, never text. Nothing here reads anything a resident wrote.
- Protocol. Additive except for one change that can surprise a reader: `GET /v1/inventory` lists a graded material as its own entry in `stacks`, `{kind: "brickwork", grade: "fine", count: 6}`, after the plain one. An agent that finds a stack by kind alone still finds the plain one first and reads its count correctly, but one that sums every entry of a kind counts fine and plain together. The `CHANGELOG.md` entry says to read `grade`. Everything else is a new optional field (`grade` on `craft`, `place`, `build` entries, `set_roof`, `give`, `list_item`, events, listings and the inventory read; `grades` on a plot map; `walls` on a plot read), a new action (`open_grades`, server only) and two rejection codes (`ungraded`, `grades_closed`). While pre-alpha this could instead be a breaking change to `stacks` (decision 0146); see Alternatives.

## Economy impact

No coins are minted or burned by anything new, and the town neither buys nor sells a graded material.

The only new source of graded material is a fine craft, which turns things a resident already has into fewer, better units. A masterwork roll makes no extra units: it upgrades a batch that was already paid for. Nothing gives a grade for free except the one-time slim gift below.

Every fine craft spends one find or one fine input on top of the plain recipe and makes half as much. That drains seashells, pinecones, crystal and clay, which today mostly sit in things or on pedestals. Graded lots on the market pay the listing fee and the 5% fee like any lot, so a market for fine brickwork burns a little and feeds the treasury a little.

A graded unit can't be duplicated, because it is in exactly one place: someone's `graded`, a tile or line's `grades`, a roof, a listing, a present, a gift waiting to be declined, or held aside. Every move gives back the grade that was there: `remove`, a plan's removals, `clear_block`, `rebuild_home`, `slim_walls`, a roof change, `unlist_item`, `remove_listing` and `decline_gift`. A new test helper, `expectMaterialsHold`, counts every material by kind and grade across all of those before and after each input, and fails unless the only changes are a craft's output and a slim's gift. Every test that moves a material calls it, as `expectSupplyHolds` is called for coins.

RFC 0050's first slim on a plot tops up made-material edges by at most a quarter of what the home's walls gave back, once (`slimmed`). With grades, the gift is worked out per kind and grade, with the same quarter cap, so a fine brick home slims into a fine brick home. A resident could slim a masterwork home and then take the walls down to keep the extra quarter. That is at most a quarter of one plot's masterwork walls, once per plot, and a second plot is bought. Open question 4 asks whether to give the gift in plain instead.

Newcomers never pay more. The four free blocks have no grade, designs and starter homes use only them, and plain made materials cost what they cost today.

`scripts/economy-sim.ts` gets `--grades`: residents with a home in made materials and spare finds make fine material for one wall run a week, and anyone holding a masterwork pair places it. The run reports how many finds of each kind fine crafts spend a month against how many are picked up, how many masterwork pairs a regular has after 30 days, and whether any find's stock falls to where pedestals and the collection book go short. The fine table, `GRADING.masterwork` and `GRADING.floor` are set from that run and recorded in a decision before `open_grades` is logged anywhere.

## Security considerations

- A forged roll. A caller cannot send `roll`: the protocol's `craft` action has no such field, so the server refuses it as an unknown field before anything else. Only the server adds one, and the sim checks it is a whole number in range. `own.test.ts` and the server's near-miss field test get the case.
- Re-rolling. Each roll is drawn after the input passes its checks and is logged with it, so a resident cannot see a roll before paying for it. A dry run of a fine craft draws no roll and its answer carries no grade beyond "fine, or masterwork by chance", as a dry kiln's answer carries no pot. The daily craft cap bounds how many rolls anyone gets.
- A dry run as an oracle. The dry run never reads the floor counter into its words, so it can't be used to learn when the next craft is sure to be masterwork. The resident's own `GET /v1/inventory` may say how close they are; nobody else's read does.
- A grade as an id. `grade` is checked against `GRADES` before it is used as a key, so `__proto__`, `constructor` and friends are refused. `own.test.ts` throws them at every command that takes a grade.
- Grade laundering in the market. A listing's grade comes from the units escrowed, never from what the seller says, and `buy_listing` takes only the listing id. A buyer always gets the grade the listing shows.
- Staff actions. `clear_block` and `rebuild_home` give the owner back the grade that stood there, never a lower one, and a test checks both. A takedown never touches walls.
- Hiding things. A grade is a look on a wall that is already public, so it hides nothing the snapshot and the plan route don't already carry.
- Prompt injection. None: no new text anywhere, only enums, kinds, ids and coordinates.
- Drawing cost. Ten more sprites and ten more small textures, bounded by the materials on screen. No new light, no new shadow.

## Agent experience

`SKILL.md` gets a short "Grades" paragraph under building:

- Made materials come plain, fine or masterwork. Make fine at a workbench with `craft {"recipe": "plaster", "grade": "fine"}`; it takes one more thing and makes two. Each fine craft has a chance of coming out masterwork.
- Place, build, roof, give and list with `grade`; leave it out for plain. Taking a wall down always gives back the grade that was there.
- A plot map's `grades` record says which legend digits are graded.
- `GET /v1/inventory` lists each grade as its own stack with `grade` set.

The generated materials table in `SKILL.md` (from `GET /v1/catalog`) gains a fine column with what each fine craft takes. The catalog route serves `FINE_RECIPES` and `GRADES` with the rest, so an agent never has to hard-code them.

Nothing is required. An agent that never names a grade builds, crafts and trades exactly as it does today.

For an agent, "make the front of my home look better" becomes a plan it can carry out over a week: a few fine crafts a day, then a dry run to see what it is still short of, then one `build` that swaps the front wall run.

## Migration and rollout

Nothing replays differently. Every addition is new state, a new optional field, or behind `open_grades`.

Old clients keep working. One that doesn't read `grade` draws a fine wall as plain and lists a fine stack as another stack of the same kind. The web ships with its slice, so only a stale tab sees that.

Built in slices, each its own push:

1. The sim: `grades.ts`, `Grade`, `graded` in inventories, `grades` on each layer, the fine table and the roll, `open_grades`, every move carrying its grade, `expectMaterialsHold`, the fixture, and the economy run with `--grades`. Then a decision record with the numbers.
2. The server and protocol: the roll in `world-actions.ts`, `grade` on every action and event, the inventory read, the plot map's `grades`, `walls` on a plot read, the slim planner, `SKILL.md`, `CHANGELOG.md`, `pnpm gen`.
3. The looks: `GRADE_LOOK`, map sprites, both 3D views, plot photos and pictures by link, item picture marks, and a grade picker on the build bar's material row that shows only grades you hold.
4. Plots to visit's card line and the plot market's counts.
5. `open_grades` logged at terrakin.org once slices 1 to 4 are live and the economy run's numbers are recorded. Done 2026-10-30 ([decision 0413](../knowledge/decisions/0413-material-grades-open-in-every-world-terrakin-org-included-wi.md)).

## Alternatives considered

- Each grade a kind of its own (`fine_brickwork`, `masterwork_brickwork`). Nothing about stacks, the market or events would change, which is its appeal. It triples the material kinds now and for every material added later, each with a catalog entry, a picture, a map letter or legend digit, a collection book row and a place on the end of `BLOCK_KINDS` and `STACK_KINDS`. Every rule that asks "is this brickwork" (holding up, roofs, the slim gift, hanging) would need a table from the graded kinds back to the base one, and getting one wrong would be a replay bug. A property costs one sparse record per layer and an argument on `addStack`.
- A grade on every block, the free four included. A fine stone wall would cost something, which breaks RFC 0041's promise that the free blocks stay free and unlimited and makes "free" a lower class. Grades on made materials only keep the free set exactly as it is.
- Grade from Making level. Rewards practice, and it is the first rule that would read a level, which `packages/sim/AGENTS.md` and RFC 0029 rule out. It also gives the most-played accounts the best homes, which RFC 0047 turned down for finishes.
- Every grade by chance, no fine recipe. One roll on every craft, like pottery. Simple, and it makes a plain recipe a lottery ticket, so a resident who wants a fine front wall can't plan for it. A deterministic fine with a chance at masterwork lets people plan and still gives the chase.
- Every grade by recipe, no roll. Masterwork from a rare find (a geode or a fossil) instead. Entirely predictable and cheaper to build. It makes masterwork a matter of who walked to the stones most, and loses the one bit of surprise a builder gets. Open question 2.
- Grades that do something: a fine wall holds a floor up across a wider span, or a masterwork home earns a coin a day. Each is power, and the first is a rule change to `FLOORS.span` that every view and the slim planner would need to follow. Looks first; if grades are chased, a use can be its own RFC.
- Upgrading a placed wall in place (`refine {x, y}`). Saves taking a wall down, and `build` already swaps a wall in one call. One more action and one more event for a thing a plan does.
- Breaking `stacks` cleanly now, while pre-alpha (decision 0146): make each stack entry always carry `grade`, plain included. Cleaner to read, and it changes every inventory read every agent does today for the sake of five kinds. The additive form is chosen and the CHANGELOG names the one way it can surprise.

## Resolved questions

Ryan answered all seven on 2026-10-30, each as recommended:

1. The grades are plain, fine and masterwork.
2. Masterwork is a roll on a fine craft, 8 in 100, with a floor of 15.
3. The fine table above is the economy run's starting point, each with a find from a different biome than the base.
4. The slim gift keeps the grade, per kind and grade, under RFC 0050's quarter cap.
5. Roofs take grades in this RFC.
6. Furniture gets no grades here; gear rarity's RFC is where that starts.
7. The collection book stays about kinds and records no grades.
