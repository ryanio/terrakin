---
title: Things on surfaces and walls are kept by tile and face, shop-only, and come back when their wall does
date: 2026-10-30
status: accepted
tags: [sim, protocol, client, economy, design]
---

# Things on surfaces and walls are kept by tile and face, shop-only, and come back when their wall does

## Context

Slice 1 of [RFC 0050](../../rfcs/0050-roomier-homes.md) lets a surface hold one small thing and a wall face hold one hung thing. Building it forced four choices the draft left loose.

## Decision

1. `put_on` and `hang` take one `item`, exactly as `display` does: a made thing or a pot by its id, a find by its kind, or a trinket (`put_on`) or wall thing (`hang`) by its kind. The draft's separate `kind`, `item` and `flower` fields, and its `hung_frame` kind, are gone: a made thing or a piece hung on a wall is drawn framed, so no frame needs buying. A vase keeps the flower it was set down with.
2. Two new catalog roles, `trinket` and `wall_decor`, both stacks that never place as a block. They are sold at the shop (the decor section) and have no recipe, so they are pure coin sinks and add nothing to `craft` or what a level counts. The draft's `fish_mount` waits until there's a way to make one.
3. A spot's key is the tile with its floor, as a pot's is (`topKey` is `potKey`), and for a wall the tile you stand on plus the side the wall is on (`faceKey`), so one key works for a wall block and, later, for a wall between tiles.
4. A wall that comes down by `remove`, a plan, the town's `clear_block` or a rebuild gives back what hung on its faces in the same input, held aside when the owner is full. A surface with something on it refuses to come up, as a pedestal does. A tile with something hung facing it takes no block, so the face stays seen.

Each of `put_on`, `take_off`, `hang` and `unhang` goes through the same where-checks as `place` (reach, a plot you can build on, not listed, the floor), and joins `reach.test.ts`, `own.test.ts` and `plot-market.test.ts`. Whoever put a thing there takes it back from within reach even once they can't build on the plot, as a display is taken down. `hang` also refuses a wall on a plot for sale, and staff's `remove_display` takes a reported made thing off a surface or a wall as it does off a pedestal (`shownOfItem`). Merging a record and listing a plot refuse while it has something on a surface or wall. `src/fixtures/surfaces-log.ts` pins a log with all four.

## Consequences

- No coins are minted and no stack is duplicated: each thing is in exactly one of someone's things, a surface, a face, or held aside, and `everyGood` and the collection book count the new spots.
- The desk, the side table and the dresser are three new workbench cards, taught by Marlo, Sable and Ansel. Holding one of every made kind is now worth level 8 in making from firsts alone, up from 7.
- The economy run was not changed for decorators: these are new sinks at fixed shop prices and no source, so they can only lower supply. If a price is ever tuned, run `scripts/economy-sim.ts` with a decorator who buys them.
- In the world, a tap on your own table, bookshelf, barrel, desk, side table or dresser opens the room sheet, and so does a tap on your own solid wall, at the face toward you (`wallFace` in `packages/client/src/room-spots.ts`). The kitchen stays a station; its top is reached through the API.
