---
title: Material grades keep RFC 0051's fine table and roll; the economy run finds them scarce, not draining
date: 2026-10-30
status: accepted
tags: [sim, economy, homes, rfc-0051]
---

# Material grades keep RFC 0051's fine table and roll; the economy run finds them scarce, not draining

## Context

[RFC 0051](../../rfcs/0051-material-grades.md) asks for its fine table, `GRADING.masterwork` and `GRADING.floor` to be checked with `scripts/economy-sim.ts --grades` and recorded before any world logs `open_grades`. Slice 1 built the sim side, and a few readings the RFC left open had to be picked while building it.

The run plays the default month (300 residents from 2024-10-04, seed 1) with `--grades`: about a third of the regulars and a tenth of the visitors grade their homes. Each day at home a grader picks up every find, branch and stone within reach, and walks once to the nearest find a fine recipe takes within 12 tiles, on ground they may gather. Once a week they make up to three fine crafts of the material their things make most of, and they swap their wood and stone walls for any wall run of 5 fine units or masterwork pair they hold.

## Decision

Keep the numbers the RFC gave: fine is the plain recipe plus one find (or fine plaster for timber frame) making 2, masterwork is a roll under 800 of 10,000, and the floor is 15.

The run, seed 1:

| | |
|---|---|
| Graders | 30 (22 regulars), 102 walks for a find |
| Fine crafts in the month | 18 (13 plaster, 5 timber frame), none of the other three |
| Masterwork | 1 batch, from the roll; the floor never came up |
| Walls swapped | 12 fine, 2 masterwork |
| Masterwork pairs a regular grader who arrived by day 2 made | 0 (n=4), with 0.5 fine crafts each |

Finds over the month, picked up by anyone (by graders) against spent by fine crafts and held at month end:

| Find | Picked up | Spent | Held at month end |
|------|-----------|-------|-------------------|
| seashell | 51 (42) | 13 (25%) | 38, by 20 residents |
| pinecone | 27 (18) | 0 | 27, by 21 |
| driftwood | 32 (23) | 0 | 32, by 22 |
| sea glass | 8 (6) | 0 | 8, by 8 |
| crystal | 26 (16) | 0 | 26, by 19 |

No find's stock falls toward where pedestals and the collection book go short: three quarters of the seashells and every other find picked up are still held at month end. The cost is the other way. A grader makes about one fine craft every two months, nowhere near the RFC's wall run a week, because a plank takes 3 driftwood and a pane 2 sea glass on top of the finishing find, and finds near any one home are few. At that pace a masterwork pair is a rare event, about one a month in a town of 300.

The numbers stay as they are for now because grades are not open anywhere, the looks (slice 3) are not built, and a cheaper table is easy to choose while no live world has logged `open_grades`. When Ryan opens grades, the run says the lever is the finds a fine recipe takes, not the roll: the floor of 15 is never reached at this pace, and `masterwork: 800` only matters once people make more fine crafts.

Readings the RFC left open, chosen while building slice 1:

- The floor counts "15 fine crafts with no masterwork among them, after which the next comes out masterwork", as `GRADING.floor`'s own words say: the 16th is sure. Pottery's `finishFloor` makes the 10th sure for a floor of 10, so the two floors read one apart.
- Any `grade` at all, `plain` included, is refused with `grades_closed` before the switch, as the RFC's "a grade anywhere" says. After it, `plain` is the same as leaving `grade` out, on anything.
- A grade that isn't one of `plain`, `fine`, `masterwork` is `unknown_item`, a craft asking for masterwork is `unknown_item` (there is no masterwork recipe), and a fine craft with no roll, a roll out of range, or a roll on any other craft is `server_only`, as a kiln's `harvest` is.
- In a plan, the same kind at another grade on a tile or line is something else there: it is skipped as `occupied` until the plan takes it away, so a swap of plain for fine names both.
- A held-aside entry never holds a material today (only things on display, on surfaces and on walls are held aside), so no `grade` field was added there.
- `item_given` carries `grade` past plain, like the other public events about a material.
- The two rejection codes and the `grades_opened` event went into the protocol with slice 1, since the API's error list and event schema are built from the sim's.

Readings chosen while building slice 2, the server and protocol:

- A dry fine craft is checked with the one roll that is never masterwork (`GRADING.outOf - 1`), as a dry kiln is checked with a fixed roll, and its `cost` counts a masterwork batch as fine, so a dry run can't be used to learn when the floor comes.
- A `roll` a caller sends on `craft` is dropped by the action's schema like any field it doesn't name (it isn't close enough to one for the near-miss refusal), and the server adds its own. The server test sends a roll the sim would refuse and sees the craft go through on the server's.
- The world snapshot carries `grade` on its `blocks`, `edges` and plots' `roof`, and `gradesOpen` once the switch is logged, so a client can mirror the grades its events name. The RFC's security section already counts on the snapshot carrying them.
- A plot read's `walls` counts each graded block or line on the plot of the tile its key names (a line by the tile whose north or west side it is), so a rare wall on a household's shared border counts on one of the two plots.
- The web's build bar holds plain material only and skips graded stacks and changes, so a graded stack never stands for the plain count before slice 3 brings a grade picker.

## Consequences

- No live replay changes: every fixture keeps its hash, `REPLAY_VERSION` stays 2, and `src/fixtures/grades-log.ts` pins a log with inputs on both sides of `open_grades`.
- Changing the fine table or `GRADING` before any world logs `open_grades` is a plain edit with a rerun of `node scripts/economy-sim.ts --grades`; after it, it's a new table behind a new switch.
- Code: [packages/sim/src/grades.ts](../../../packages/sim/src/grades.ts), the `--grades` run in [scripts/economy-sim.ts](../../../scripts/economy-sim.ts).
