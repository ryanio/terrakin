---
title: The kiln is built behind open_clay, which no adapter sets until the playtest is read
date: 2026-10-22
status: accepted
tags: [sim, server, protocol, client, economy]
---

# The kiln is built behind open_clay, which no adapter sets until the playtest is read

## Context

[RFC 0047](../../rfcs/0047-trades-and-your-mark.md) adds trades beyond the garden, and its first phase is pottery: clay on the ground, a kiln, and three pots fired overnight with a finish the server rolls. The 2026-10-25 playtest measures the step from claiming a plot to setting a hearth, and anything new in the world the week of it would muddy that read. Ryan's call on 2026-10-22: build phase 1 now, kiln first, with the town buying no pottery, and switch it on only after the playtest has been read, in a push of its own.

Clay changes which logged `gather`s the sim accepts, so it needs a logged switch whatever else happens. The kiln, the pots and the `glaze` field are new kinds a world refused before, which could have gone without one, as fishing did. That would have left them usable on terrakin.org the moment this shipped: a kiln for stone, a bowl from clay bought or given.

## Decision

One switch, `open_clay`, from `TOWN_ACTOR`, gates all of pottery: clay on the ground, placing a kiln (`place` and a `build` plan), crafting a pot or sending a glaze, the vase's and teapot's cards on the Recipes shelf, and knowing any pot at all. Before it each is refused with `pottery_closed`, a new code, since an agent can meet it.

The server logs the switch only with `WorldService`'s `clay` option, and neither the Worker nor the Node server sets it. A test world opens it with `POST /v1/test/open-clay` (loopback, test clock only), and `pnpm persona --open-clay` calls that.

The RFC's open questions take its recommended answers: the kiln first; no town buy order for pots; the finish odds as written (speckled 15%, crackle 5%, iridescent 1%, the rest plain), frozen in `FINISHES`; clay at 0.25 a meadow or sand tile a day, only where no find would lie, finds out or not.

## Consequences

- A world without the switch reads as it does today: no clay in `pickups`, no `clayOpen` or `kilns` in the snapshot, no `kilns` on the inventory, no pot in `recipes` or on the shelf, and no Pottery group in the collection book. `packages/server/src/pottery.test.ts` pins it, and every fixture hash before `kiln-log.ts` is unchanged, so `REPLAY_VERSION` stays.
- The catalog is static, so `GET /v1/catalog`, the inventory's `catalog` and SKILL.md's tables list clay, the kiln's pots and the glazes from now on. SKILL.md's Pottery section says pottery isn't open yet and how to tell when it is.
- Switching it on is one line in `packages/server/cloudflare/worker.ts` (`clay: true`) and the jobs-style test that expects it, plus a devlog post, in the push Ryan approves.
- The bowl is everyone's once the switch is logged (`CLAY_BASE` in `recipes.ts`), which is a frozen list like `BASE_RECIPES`: it reaches what everyone knows only through the logged input.
- The finish is rolled by the server with Web Crypto and rejection sampling when it logs a real `harvest` at a kiln; a dry run sends a roll of 0 and the answer carries no events, so it draws nothing.
- The link pages don't load or open a kiln yet: `/v1/act/{key}/craft` refuses a pot and says it takes the API.
- The townsfolk teach no pot yet: their specialties don't cover the vase or the teapot.
- The economy run with `--kiln` (39 potters in 300) ends at 294 coins per active resident against 301 without, 2.3% lower, almost all from the 870 coins the vase's and teapot's cards burn. The town paid 13,696 for goods against 13,871. Making's days to level 5 for earnest makers stay at 18.

Code: `packages/sim/src/pottery.ts`, `packages/server/src/world-service.ts` (the `clay` switch in `DAY_SWITCHES`, `testOpenClay`), `packages/server/src/world-actions.ts` (the finish's roll), `scripts/economy-sim.ts` (`--kiln`).
