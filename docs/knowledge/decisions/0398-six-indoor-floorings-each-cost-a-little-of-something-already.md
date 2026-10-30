---
title: Six indoor floorings each cost a little of something already in the world
date: 2026-10-30
status: accepted
tags: [sim, protocol, economy, numbers, design]
---

# Six indoor floorings each cost a little of something already in the world

## Context

Residents want more ways to make the inside of a home their own. Paths and flooring are `ground` kinds ([decision 0075](0075-paths-and-floors-are-a-second-layer-that-never-blocks-and-fu.md)), and the only indoor ones were `planks` and `rug`. A new kind goes on the end of `GROUND_KINDS`, and its cost is fixed once it's live, since `lift` gives back the kind's current cost.

## Decision

Six kinds join `GROUND_KINDS` at its end, each costing a tile's worth of a stack kind that already exists:

| kind | one tile takes |
|------|----------------|
| `carpet` | 1 cushion |
| `checker_tiles` | 1 stone and 1 clay |
| `parquet` | 2 wood |
| `terracotta` | 1 clay |
| `woven_mat` | 1 ear of corn |
| `stone_tiles` | 2 stone |

## Why these numbers

- Every new kind costs something, so the free four stay the ones anyone can lay on a first visit.
- Each draws on a different part of the world: gathering (wood, stone, clay), the garden (corn, sold as seed all year), and the shop (a cushion, 5 coins). A room of carpet is a coin sink, like the cushion it's made from, which the town never buys back.
- Parquet and stone tiles are cut and fitted, so they take twice what planks and cobbles do. Checker tiles take two things for their two colors.

## Consequences

- No frozen list changes: the pantry, the shop, the town's buys, and the Town Hall's `commons_build` (which lays any ground kind from nobody's things) are untouched. A visitor's landing still prefers only the outdoor `PATHS` in `packages/sim/src/visit.ts`.
- Old logs replay unchanged: a `lay` of these kinds was refused before.
- The 3D ground atlas grows from 4 cells a side to 5 (320 pixels square), and its side now follows the number of kinds (`packages/client/src/scene3d/paths.ts`).
- Code: `packages/sim/src/ground.ts`, `GROUND_LOOK` in `packages/sim/src/palette.ts`, `GROUND_CHAR` in `packages/sim/src/map.ts`.
