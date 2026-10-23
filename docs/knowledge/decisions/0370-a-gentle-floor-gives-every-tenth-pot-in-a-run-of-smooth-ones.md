---
title: A gentle floor gives every tenth pot in a run of smooth ones a finish, counted in the sim
date: 2026-10-23
status: accepted
tags: [sim, economy]
---

# A gentle floor gives every tenth pot in a run of smooth ones a finish, counted in the sim

## Context

A fourth agent played pottery cold, still switched off, and scored it 6 out of 10. The collecting loop felt slow: four pots in five come out smooth, so a run of a dozen smooth pots is common, and a new potter could go a week with nothing to put on the Finishes page. A pond's two springs also gave 2 clay a day, short of a vase's 3.

Every finish is rolled by the server and logged with the `harvest`, so replay never draws a number. Any change to the odds has to keep that.

## Decision

- **A floor in the sim, by count.** `items.potters` keeps each resident's pots fired, the smooth ones in a row since their last finish (`smoothRun`), and their best pot (the first with their rarest finish). When a pot's roll says smooth after 9 smooth pots in a row, `floorFinish` makes it speckled (`POTTERY.finishFloor`, 10). The server still rolls every pot, and the count is state, so a logged roll replays the same.
- **Three springs a pond.** `POTTERY.springsPerPond` is 3, so one pond gives a vase a day, one fewer on a day a branch, stone, or find lies where a spring would be.
- The book's `potter` shows the count and the best pot, and the web's Finishes page ends with both.

## Consequences

- No potter goes ten pots without a finish. The odds of crackle and iridescent are unchanged: the floor only lifts a smooth pot to speckled.
- The economy run with `--kiln` after both changes: 297 coins per active resident against 301 without pottery (-1.3%), supply 40,839 against 41,368 (-1.3%), 340 coins burned on cards, and the town paid 13,913 for goods against 13,871 (+0.3%). Engaged potters picked up 4.38 clay a day near home (3.56 before) and took out 1.00 pot a day.
- `merge_resident` adds `from`'s pots fired to `into`'s and keeps the better best pot (`mergePotters`).
- Once `open_clay` is logged on terrakin.org, this floor is frozen with the rest of pottery: a new floor is a new rule behind a switch.

Code: `packages/sim/src/pottery.ts` (`floorFinish`, `potterOf`, `mergePotters`, `POTTERY.finishFloor`, `POTTERY.springsPerPond`), `packages/server/src/collection.ts` (`withPotter`), `packages/client/src/collection-view.ts`.
