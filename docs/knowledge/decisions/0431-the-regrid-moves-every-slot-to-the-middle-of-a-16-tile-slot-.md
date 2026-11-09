---
title: The regrid moves every slot to the middle of a 16-tile slot, carries ways and bridges across the yards, and waits for a dry run on a copy
date: 2026-11-09
status: accepted
tags: [sim, server, protocol, building, rfc-0052, switches]
---

# The regrid moves every slot to the middle of a 16-tile slot, carries ways and bridges across the yards, and waits for a dry run on a copy

## Context

RFC 0052 doubles every plot slot from 8 tiles to 16 in one logged `regrid` from the town, so a lot can grow from 8 by 8 to the whole slot. The RFC fixes the rule for a tile (everything on a slot moves to its middle 8 by 8, 4 tiles in) but leaves open what happens to whatever joined two slots across their border, which the new 4-tile yards now part: walls on that border line, public ways that ran from one slot into the next, bridges, and things hung on a wall from the far side. A dry run of the transform against the live world (2026-11-09) found that the first rule for ways, carrying a way only toward another way or a bridge, left every way unjoined to the Commons and 48 plots with no exit.

## Decision

1. **Tiles.** A tile at `(x, y)` moves to `moveCoord` of each axis: `slot*16 + 4 + local` (`packages/sim/src/grid.ts`). Every keyed record moves with it: blocks, lines, grades, turns, ground and each floor's, crops, displays, pots, tops, firings, today's gathered tiles, the town's built tiles and proposals, game tables, residents and hearths. `config`, `lands.home` and each land's bridge double. A test lists every field of `WorldState` and fails on one nobody placed.
2. **Lines on a slot border** (two touching plots of one household) can't stay between both tiles, so each stays beside its north or west tile, on that tile's far side.
3. **Public ways.** Every step a walker could take from a way tile across its slot's edge before the regrid (`stepFrom` on the old ground) is carried across that way's own yard to the slot's edge: toward another way, a bridge, the Commons, a street, a free slot, or a plot that stepped out onto it. So every way still joins the Commons and every plot whose exit was a way still has one. Live, that takes 381 way tiles to 2,157 and leaves no plot landlocked.
4. **Bridges** are carried across the yards along their run and on to the land at each end, never sideways into the sea.
5. **Hung things** on a wall face whose tile and wall are on different slots go back to whoever hung them (held aside when their things are full), with an `inventory` event each.
6. **Lots** are kept on the world by slot (`state.lots`), not on the plot, so a sale or a release keeps one.
7. **The switch waits for a dry run.** The server logs `regrid` only after `regridCheck` (`packages/server/src/regrid-check.ts`) applies it to a clone and finds the coin supply identity holding, every keyed count unchanged and things in hand up by exactly what came off the walls, every online ground-floor resident who stood on open ground still on it, and every hearth a walk from the spawn tile reached still reached. Otherwise it logs nothing, reports codes and counts only, and tries again the next world day.

## Consequences

- The regrid is one more input: logs before it replay at plot size 8, and `REPLAY_VERSION` stays. Rules 2 to 5 change only what a `regrid` produces, and no live log holds one yet.
- Plans, maps, design notes, `GET /v1/plots/{px}/{py}/plan`, `rebuild_home` and the town's slims count from the lot's corner, which is the slot's corner before the regrid, so nothing logged before it reads differently. A design (drawn 8 by 8) stands in the middle of a bigger lot and `replace` reads only its square.
- Carried ways take up yard tiles a lot may later grow over; a way holds no block there, as on any plot.
- Code: [packages/sim/src/regrid.ts](../../../packages/sim/src/regrid.ts), [packages/sim/src/lots.ts](../../../packages/sim/src/lots.ts), [packages/server/src/regrid-check.ts](../../../packages/server/src/regrid-check.ts), `regridIfSafe` in [packages/server/src/world-service.ts](../../../packages/server/src/world-service.ts).
