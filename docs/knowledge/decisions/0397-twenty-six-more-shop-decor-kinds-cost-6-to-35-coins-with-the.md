---
title: Twenty-six more shop decor kinds cost 6 to 35 coins, with the paintings and the record player at the top
date: 2026-10-30
status: accepted
tags: [sim, economy, design]
---

# Twenty-six more shop decor kinds cost 6 to 35 coins, with the paintings and the record player at the top

## Context

[Decision 0392](0392-things-on-surfaces-and-walls-are-kept-by-tile-and-face-shop-.md) opened two shop-only roles, `trinket` and `wall_decor`, with eight and seven kinds. The owner asked for many more things people would want in a home, art among them, so everyone can hang a painting without uploading one. Each new kind needed a price.

## Decision

Prices follow the first fifteen: a small, everyday thing costs about what a teacup or a pennant does, and a thing that takes craft to make costs what the globe, the music box and the wall clock do. Nothing goes above 35, under the 40 the request set.

| Kind | Coins | Kind | Coins |
|------|------:|------|------:|
| `fruit_bowl` | 6 | `bunting` | 6 |
| `photo_frame` | 6 | `coat_hooks` | 6 |
| `toy_boat` | 8 | `dried_flowers` | 8 |
| `ceramic_cat` | 10 | `plate_rack` | 12 |
| `candlesticks` | 10 | `star_chart` | 15 |
| `snow_globe` | 12 | `quilt_hanging` | 18 |
| `hourglass` | 12 | `tapestry` | 22 |
| `tea_set` | 14 | `guitar` | 28 |
| `terrarium` | 15 | `cuckoo_clock` | 30 |
| `lava_lamp` | 16 | `still_life_painting` | 32 |
| `chess_set` | 18 | `landscape_painting` | 35 |
| `bonsai` | 20 | `portrait_painting` | 35 |
| `radio` | 22 | | |
| `record_player` | 35 | | |

`candlesticks` and `lava_lamp` glow after dark on the map, as `candle`, `table_lamp` and `sconce` do (`roomThingGlows` in `packages/client/src/render/decor.ts`).

## Consequences

- These are more coin sinks at fixed prices with no source and no buy-back, so they can only lower supply; the economy run was not changed, for the reason 0392 gives.
- `packages/sim/src/shop.test.ts` pins every price. A price changed later is a shop number like any other.
- Each kind is drawn in `packages/ui/src/item-art.ts`, and the map, both 3D views and the room sheet draw from that picture, so a new kind needs no other drawing.
