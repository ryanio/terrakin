---
title: "Christmas and New Year's numbers: presents wrapped from December 1, the town's three candy canes, a Santa hat at 30 and a stocking at 6, and fireworks at 2 each"
date: 2026-10-15
status: accepted
tags: [sim, economy, numbers, holidays, client, server]
---

# Christmas and New Year's numbers: presents wrapped from December 1, the town's three candy canes, a Santa hat at 30 and a stocking at 6, and fireworks at 2 each

## Context

[RFC 0034](../../rfcs/0034-winter-holidays.md)'s last slice is Christmas inside Midwinter and New Year's, on the holiday machinery of [decision 0287](0287-holidays-have-span-rules-may-overlap-and-cross-a-year-end-an.md). The RFC priced the Santa hat at 50 and the stocking at 12, before Halloween's costumes and decor were halved ([decision 0210](0210-halloween-s-costumes-and-decor-cost-half-from-a-logged-lower.md)), and sold fireworks in packs of five. It named a new refusal for fireworks over someone else's ground, where the sim already has `not_your_plot`.

## Decision

- Presents: `give` with `wrapped: true` from December 1 to 25 (UTC), under every cap `give` has. The thing leaves the giver and waits in `items.presents` (`present_1`, ...) until its recipient sends `open_present` from December 25 (`not_yet` before, `unknown_present` for anyone else's, `inventory_full` when it won't fit). A present can't be sent back and carries no note: the server refuses one (`invalid_gift`), since a note would be resident text kept in the world. `GET /v1/inventory` lists who each is from, never what. Presents left wrapped open themselves at the first `new_day` of the new year, oldest first, as many as fit.
- The town's present: on December 25 the server logs `town_presents {to}` from `TOWN_ACTOR`, once a year, listing every resident with a hearth who isn't townsfolk and has no present waiting. Each gets 3 candy canes, new like Halloween's town candy.
- Midwinter's shop adds the Santa hat (wear, hat slot) at 30, the price of Halloween's witch hat after decision 0210, and the stocking (decor) at 6, the bat bunting's.
- New Year's runs December 26 to January 1. Fireworks are a stack at 2 coins each, the RFC's pack price per firework, bought by count. `set_off_firework {x, y, color}` on December 31 and January 1: the tile is within 3 tiles of you and on your own plot, one shared with you, or the Commons (`not_your_plot` otherwise, the code the sim has), wherever you stand. Six colors, 20 a night, counted in `items.today.fireworks`. Fireworks sit in the Tools family, not the Pantry, so the pantry's badge still means sugar and jars.
- The town's New Year's Eve gathering is a holiday town event at 23:00 UTC on December 31 for two hours, so midnight UTC falls inside it.
- The check-in suggests `wrap_presents` from December 15 to 24 (the ten days before, so it doesn't crowd out winter's first suggestions), `open_presents` every day one is ready, and `fireworks` on both nights.
- A present's made thing is still its giver's until it's opened: `everyGood` lists it with the giver as its holder, so a staff takedown of a piece's picture reaches a wrapped piece too. `merge_resident` refuses while a present names the record to merge, given or to open, so no present is left addressed to a record that's gone.
- A block made after a present was wrapped doesn't stop it. Wrapping a gift across a block is refused like any `give`, but the sim knows nothing of blocks, so a present wrapped before one still opens, by hand or at the new year. A present can't be sent back, and it carries no note, so what arrives is a thing and its maker's name.
- The map draws at most 12 bursts at once, dropping the oldest.
- Left for later, and built in [decision 0293](0293-presents-show-as-boxes-under-the-tree-from-a-count-on-the-sn.md): presents drawn under the fir or by the hearth, a `present_received` notice and a `present_opened` notice to the giver, the "For Christmas" shelf name on December 24 and 25, bursts in 3D, and link pages for opening presents and setting off fireworks.

## Consequences

- No new duplication path: a present's thing is in one place at a time, and the supply identity holds through wrapping, opening, and the town's present (`christmas.test.ts`, `newyear.test.ts`).
- Midwinter's stock is now candy canes, the stocking, and the Santa hat; decision 0124's test records the addition.
- Code: `packages/sim/src/christmas.ts` and `packages/sim/src/newyear.ts`, the `wrapped` branch of `give` in `packages/sim/src/items.ts`, `leaveTownPresents` in `packages/server/src/world-service.ts`, the `new_year` entry in `packages/server/src/town-events.ts`, the three suggestions in `packages/server/src/checkin-suggest.ts`, and `packages/client/src/render/fireworks.ts`.
