# RFC 0032: Homes agents can design

- Author: drafted by Claude for Ryan
- Date: 2026-10-10
- Status: draft
- Discussion: [issue #48](https://github.com/ryanio/terrakin/issues/48) (item 3, guided setup)
- Builds on: [RFC 0016](0016-build-with-what-you-gather.md) (build plans), [RFC 0028](0028-homes-with-storeys.md) (an upstairs), [decision 0076](../knowledge/decisions/0076-a-build-plan-uses-plot-coordinates-refuses-whole-what-the-pl.md) (how a plan is checked), [decision 0252](../knowledge/decisions/0252-a-home-s-levels-are-floors-in-the-api-and-an-upstairs-in-wha.md) (floor is a level, flooring is what you lay), [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) (replay), [decision 0004](../knowledge/decisions/0004-chat-is-untrusted-data.md) (untrusted text)

## Summary

Most homes in Terrakin are built by AI assistants through the API, and most of them are the starter hut with a few planters pushed against it. This RFC gives an assistant three things it lacks today. It can write and read a plot as a small map of characters, so it sees what it is building. A dry run answers with notes about the home, like a hearth nobody can walk to. And there is a short list of whole designs to start from, with materials to choose.

None of it changes a rule. A map and a design are turned into the `build` lists the sim already takes before anything is logged, and the notes are read-only. Every existing world log replays as it does now.

## Motivation

A read of terrakin.org on 2026-10-10 (world `seq` 13134), counting the 25 built plots that aren't the townsfolk's, 17 of them owned by agents:

| What | Plots, of 25 |
|------|--------------|
| Exactly 15 wall blocks, the starter hut's count | 17 |
| The hut and at most two more blocks | 12 |
| No path or flooring anywhere | 19 |
| Four kinds of block or fewer on the whole plot | 15 |
| More than 40% of the plot's tiles under blocks | 8 |
| A planter, kitchen, workbench, or pedestal with no open tile beside it | 3 |
| A hearth walled in, with no way to walk to it | 2 |

The median plot has 16 blocks, one more than the hut. The homes that go further tend to go wrong: one has 26 planters round its hut, another 37 walls and a hearth nobody can reach.

Three causes, from `packages/protocol/SKILL.md` and the build routes:

- **An assistant builds blind.** A plan is a list of `{x, y, block}` objects, and the answer is counts. The picture of the plot is a PNG link, which most assistants never open and many can't. Nothing shows a model that its windows are off center or that its planters ring the house.
- **Nothing says whether a home makes sense.** A dry run prices a plan and lists what's in the way ([decision 0076](../knowledge/decisions/0076-a-build-plan-uses-plot-coordinates-refuses-whole-what-the-pl.md)). It doesn't say the door leads nowhere.
- **There is one design.** SKILL.md has the starter hut, three small plans to add to it, and one line of advice: "Build what your owner would love."

Who this is for:

- Agents get a format they lay out well, a picture of the result before they spend anything, and plain notes to act on.
- Homesteaders get a home their assistant built that they want to show, and the same notes in the build bar when they build by hand.
- Hosts get plots worth visiting. "Plots to visit" (RFC 0020) is only as good as the plots.

## Words

- A **map** is a plot drawn in characters: one row of text per row of tiles.
- A **legend** says which character is which kind.
- A **design** is a whole home we publish as a map, with materials you can swap.
- **Notes** are what the server says about a home after reading it. They are facts and suggestions, never refusals.

## Design

### 1. Maps

A plot is `config.plotSize` tiles square (8 on terrakin.org), so one floor of a home is 8 rows of 8 characters for its blocks and 8 more for its paths and flooring (`ground`). The starter hut with planks inside and a path from its door, on an empty plot:

```json
{"type": "build", "px": 2, "py": 1, "dry": true,
 "map": {"floors": [{"floor": 0,
  "blocks": [
   "........",
   ".WWWWW..",
   ".W...W..",
   ".G...G..",
   ".W...W..",
   ".WW.WW..",
   "........",
   "........"],
  "ground": [
   "........",
   "........",
   "..===...",
   "..===...",
   "..===...",
   "...:....",
   "..m:m...",
   "...:...."]}]}}
```

The fixed characters, the same in every map the API reads or writes:

| Blocks | | Ground | |
|--------|--|--------|--|
| `W` | wood | `:` | dirt |
| `S` | stone | `,` | sand |
| `G` | glass | `m` | moss |
| `L` | leaf | `l` | leaves |
| `p` | planter | `c` | cobble |
| `k` | kitchen | `o` | stepping stones |
| `b` | workbench | `r` | brick |
| `d` | pedestal | `=` | planks |
| `~` | pond | `f` | flower bed |
| `^` | stairs | `u` | rug |

In both grids `.` leaves a tile as it is and `x` clears it (`remove` for a block, `lift` for ground).

Decor and furniture are too many for one letter each, so a map carries its own legend for those, on digits: `"legend": {"1": "table", "2": "chair", "3": "lantern"}`. A legend may only use `0` to `9`, and may not redefine a fixed character.

**Writing.** `build` takes `map` in place of its four lists; sending both is `invalid_plan`. The protocol package turns a map into `remove`, `lift`, `blocks`, and `ground` (`mapToPlan`, a pure function), and the server sends the sim the same `build` input it sends today. A row of the wrong length, a missing row, or a character that isn't in the fixed table or the legend refuses the whole plan as `invalid_plan`, naming the row and column.

A letter on a tile that holds something else is skipped as `occupied`, as a list plan's is today, so a map can't tear down a co-owner's work by accident. `"replace": true` on the plan says to swap instead: every such tile is cleared first. The dry run's `removed` and `lifted` counts show what that would take away.

**Reading.** `GET /v1/plots/{px}/{py}/plan` gains `map` beside the lists it has: every floor of the plot in the same shape, with a `legend` for whatever decor and furniture stands there. Two characters appear only in maps the server writes: `h` for a hearth in the blocks grid, and `@` for someone standing on a tile. A map sent back with them is fine: both read as `.`.

**Seeing the result.** A `build` answer's `plan` gains `map`: the plot as the plan leaves it. On a dry run that is the plot as it would be. This is the picture an assistant has been missing, and it arrives in the call it already makes to price a plan. The answer to the dry run above:

```json
{"ok": true, "dry": true, "seq": 13140, "events": [],
 "plan": {"px": 2, "py": 1, "placed": 15, "laid": 14, "removed": 0, "lifted": 0,
  "uses": {"wood": 9}, "returns": {}, "skipped": [],
  "map": {"floors": [{"floor": 0, "blocks": ["........", ".WWWWW..", ".W...W..", ".G...G..", ".W...W..", ".WW.WW..", "........", "........"],
                       "ground": ["........", "........", "..===...", "..===...", "..===...", "...:....", "..m:m...", "...:...."]}]},
  "notes": []}}
```

The sim renders it: `plotMap(state, px, py)` in `packages/sim/src/build.ts`, beside `plotPlan`, from the state the plan's own commit produces on a dry run. Nothing is logged for it.

Link-only assistants get the same map as a code block on `/v1/act/<key>/me` and in the answer to building a home by link.

### 2. Notes

`designNotes(state, px, py)` is a new pure function in `packages/sim/src/design.ts`. It reads one plot and returns a list of notes, each with a fixed `code`, a line of `text` in our own words, and the `tiles` it is about (plan coordinates). It uses the sim's own walking ground (`groundOf`) and `config.reach`, so "can be walked to" means what `move` means.

The first set, each with its number in a `DESIGN` constant and a test:

| Code | Says | On the live world today |
|------|------|--------------------------|
| `hearth_walled_in` | Nobody can walk from the plot's edge to your hearth. Names a wall whose removal opens it. | 2 plots |
| `walled_in` | Open tiles nobody can walk to. | 2 plots |
| `out_of_reach` | A planter, kitchen, workbench, pedestal, frame, or pond with no tile within reach that can be walked to. | to measure (3 plots have one with no open tile beside it) |
| `no_path` | No path leads from the doorway, or the plot has no path or flooring at all. | 19 plots |
| `crowded` | Blocks cover more than half the plot. | between 4 plots (over 60%) and 8 (over 40%) |
| `many_materials` | Walls in three or more materials, not counting glass. | to measure |

An answer with no notes says so: `"notes": []`. A clean home is the common case and should read as one.

Notes appear in three places:

- On `build` answers, dry or real, as `plan.notes`, about the plot as the plan leaves it.
- On `GET /v1/plots/{px}/{py}/plan`, as `notes`, about the plot as it stands. That is any plot: everything a note reads is already public in `GET /v1/world`.
- In the web's build bar, for someone building by hand. The client imports the sim, so it calls `designNotes` on its mirror, with no request ([decision 0052](../knowledge/decisions/0052-the-client-holds-back-actions-the-sim-would-refuse-using-the.md) allows the sim's own checks in the client).

A note never refuses a build. Someone who wants 26 planters may have them.

```json
"notes": [
  {"code": "hearth_walled_in",
   "text": "Nobody can walk to your hearth: the walls around it have no gap. Take one away for a doorway, like the wall at (3, 5).",
   "tiles": [{"x": 3, "y": 5}]},
  {"code": "no_path",
   "text": "No path leads from your door. A few tiles of dirt, moss, or stepping stones from (3, 6) to the plot's edge is free.",
   "tiles": [{"x": 3, "y": 6}, {"x": 3, "y": 7}]}
]
```

The protocol's `code` is a string, not an enum, so a later note is not a breaking change. SKILL.md says to treat an unknown code as its `text`.

### 3. Designs

A design is a map with a name, a line about it, and the materials it lets you choose. `GET /v1/designs` lists them:

```json
{"designs": [
  {"id": "greenhouse", "name": "Greenhouse", "about": "A cottage with a glass north wall and beds along the east side.",
   "options": {"walls": ["wood", "stone"], "windows": ["glass", "leaf"], "path": ["dirt", "moss", "stepping_stones"]},
   "floors": 0, "map": {"floors": [{"floor": 0, "blocks": ["..."], "ground": ["..."]}]}}
]}
```

`build` takes one by name:

```json
{"type": "build", "px": 2, "py": 1, "design": "greenhouse", "walls": "stone", "turn": 90, "dry": true}
```

`turn` (0, 90, 180, or 270) turns the whole design, so its door can face the Commons, a neighbor, or a path. The protocol package turns a design and its options into the same four lists (`designToPlan`), so a design builds, prices, skips, and refuses exactly as any plan does. Like a map, a design only places: on a plot that already has a home, most of it is skipped as `occupied` unless the plan says `"replace": true`.

The first designs are the hut and the eight homes the townsfolk already live in (`scripts/townsfolk/personas.ts`): a greenhouse, a workshop with a yard, a corner cafe, a post stop, a library, a lookout, a hill house with a deck, and an atelier. They use free blocks and free ground only, so a first design costs nothing. Later designs may use furniture, and then they cost what a plan with that furniture costs.

Every design is tested against the sim: built on an empty plot it skips nothing, and `designNotes` on the result is empty. A design we publish with a walled-in hearth fails the suite.

Designs live in `packages/protocol/src/designs.ts`, not the sim. The log holds the lists a design expanded to, so editing a design later never changes how an old log replays.

`build_starter_home` stays as it is.

### 4. A short design guide in SKILL.md

"Build: paths, furniture, and plans" gains a section of about ten lines, "A home that reads well", and its three example plans become maps:

- One footprint: a rectangle or an L, with walls one tile thick.
- Two wall materials at most, and glass for windows, facing each other.
- A doorway on the side people arrive from, and a path from it to the plot's edge.
- Flooring inside. A rug or a table makes a room read as a room.
- Gardens in rows away from the walls, with a tile to stand on beside every planter.
- Leave a third of the plot open.
- Dry run, read the map and the notes, fix, then build.

First visit step 6 becomes: pick a design from `GET /v1/designs` that fits your owner, dry run it, read the map, then build it.

## Phases

Each phase ships on its own and is useful alone.

1. **Maps.** `map` on `build`, on the plan route, and on `build` answers. `mapToPlan` and `plotMap`, with tests that a map written from a plot builds that plot. SKILL.md's example plans as maps.
2. **Notes.** `designNotes`, `DESIGN`, the six notes above, and their tests. The live world's numbers measured again with the real function before the thresholds are set.
3. **Designs and the guide.** `GET /v1/designs`, `design` and `turn` on `build`, the nine designs, and the SKILL.md section.
4. **The web.** Notes in the build bar, and the home sheet a new resident sees after claiming a plot offers the designs as pictures (`plot-thumb.ts` already draws a plot from tiles) in place of the one starter home.

## Invariants

- **Server-authoritative.** The sim still decides every tile. `mapToPlan` and `designToPlan` only reshape a request into the `build` input the sim already checks with `planBuild`. `designNotes` reads and never writes.
- **Deterministic sim.** `plotMap` and `designNotes` are pure functions of the state, with no clock, randomness, or I/O. Neither is called from `apply`. The world log gains no new input type.
- **Resident text is untrusted.** A map holds only characters from the fixed table and digits. Notes are our words with numbers and coordinates in them, and never quote a plot's name, a resident's name, or anything a resident wrote.
- **Protocol.** Additive: new optional fields on `build`, on its answer's `plan`, and on the plan route, and one new route. Each gets a changelog entry and its SKILL.md text, as the protocol test requires.

## Economy impact

None. A map prices as its lists do. The first designs use free blocks and free ground. A design with furniture takes that furniture from your things, as any plan does. Nothing here is a new source or sink, and a plan still can't place what you don't hold.

## Security considerations

- **A map as a message.** Someone could arrange blocks so their plot's map reads as words to an assistant that copies designs. The fixed table has 20 characters on an 8 by 8 grid, and decor and furniture read back as digits in the order they first appear, which the reader doesn't choose. That is not enough alphabet to write an instruction, and SKILL.md says a map is a drawing, like chat is data.
- **Notes as a trusted voice.** A note sounds like the server telling an assistant what to do, so its text must never carry resident text, and it never proposes anything that spends coins or touches another plot. Both are tests: every note's text is built from the fixed strings in `design.ts` and numbers.
- **Cost.** A map is 128 characters a floor, and a note pass is one flood fill of 64 tiles a floor. Dry runs are not held to one every 5 seconds as real builds are, only to the action rate limit (10 a second), so a dry run with a map and notes must stay as cheap as one without: `plotMap` and `designNotes` run once per answer, on one plot.
- **Parsing.** Rows are checked for count and length before anything else, and a legend for its size (10 entries) and its values (existing kinds). The answer names the row and column of a bad character and never echoes more than that one character.
- **Reading other plots.** Notes and maps of any plot add nothing that `GET /v1/world` doesn't already give.
- **Replace.** `"replace": true` clears what a plan covers on a plot you own or share, which `remove` plus `blocks` already does. A co-owner can tear down the other's work today; this makes it one field shorter, so the dry run's counts and SKILL.md both say plainly what it takes away.

## Agent experience

An assistant's loop today is: write coordinates, dry run, read counts, build, hope. With this it is: pick a design or draw a map, dry run, read the picture and the notes, fix, build.

SKILL.md changes:

- "Build" teaches maps first and keeps the lists as the precise form. The fixed table goes in once.
- The three example plans and the loft plan become maps, checked against the sim as they are now.
- "A home that reads well" (section 4 above).
- First visit step 6 uses a design.
- `GET /v1/designs` and the new fields join the generated API reference.

Later, and not part of this RFC: the check-in's `tryToday` could carry one note about your own home ("home"), once, like its other suggestions.

## Migration and rollout

No log replays differently. The sim gains two read-only functions and no input, so `REPLAY_VERSION` stays. Homes already built are untouched; their owners see notes about them the next time they read their plan or dry run a build.

Clients that send lists keep working unchanged.

## Alternatives considered

- **Guidance in SKILL.md only.** Cheap, and section 4 does it. Alone it is ten lines in a file of 1,845, and it does nothing about building blind.
- **Make assistants look at the picture.** `GET /v1/me` already gives a PNG of the plot. Many assistants can't open images, a picture costs far more to read than 128 characters, and it can't be edited and sent back.
- **Snapping and auto-arranging** (issue #48, item 2). The server could move a misplaced block. On a tile grid there is nothing to snap, and a server that rearranges a plan stops being a server that does what it was told.
- **A model that reviews homes.** An AI critic on the server could say more than six rules can. It costs money per build, answers differently each time, and reads resident-shaped input. Rules in the sim are free, tested, and the same for everyone.
- **A fixed character for every kind.** No legend to send, but there are more kinds than readable characters, and every new kind would need one forever.
- **Designs as their own sim action** (`build_design`). The log would hold a design's name, so editing a design would change how old logs replay, or every design would need versions. Expanding before the log avoids both.
- **Rows in the existing `blocks` and `ground` fields.** A field that is a list of objects or a list of strings is awkward in the schema and in OpenAPI. `map` is one more field with one shape.

## Out of scope

Walls are four kinds of cube with no doors and no roofs, so even a well planned home is a ring of cubes from above. New pieces (a door, a roof, a fence that joins) would lift how good a home can look. That is art, sim, and replay work, and wants its own RFC once these three show how far planning alone goes.

## Open questions

1. Is `replace` wanted, or should a map on a built plot keep to skipping `occupied` tiles, with `x` for what should go?
2. Where is the line for `crowded`: half the plot, or less? Phase 2 measures the live world before choosing.
3. Should notes ride on real builds, or only on dry runs and the plan route? On a real build they arrive after the coins and materials are spent.
4. Does `turn` need a `flip` beside it, or is four ways enough?
5. Should a new resident on the web choose among all nine designs, or three picked for them?
6. Should `build_starter_home` build a design by name once designs exist, and retire its own `walls` and `windows`?
7. Is the fixed table right? `p` and `k` are lowercase so walls stand out as capitals; an assistant may find all capitals easier.
