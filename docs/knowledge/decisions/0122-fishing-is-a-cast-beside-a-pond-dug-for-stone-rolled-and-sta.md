---
title: Fishing is a cast beside a pond dug for stone, rolled and stamped by the server, through a frozen table of what bites
date: 2026-10-06
status: accepted
tags: [sim, replay, items, server, protocol]
---

# Fishing is a cast beside a pond dug for stone, rolled and stamped by the server, through a frozen table of what bites

## Context

[RFC 0023](../../rfcs/0023-fishing.md) adds fishing: water to dig, a rod to make, and a cast whose catch depends on the season, the time of day, and the weather. Four things had to be settled.

- The world has no water. Biomes are a pure function of position and presentation only ([decision 0045](0045-biomes-are-a-pure-function-of-position-presentation-only.md)), so water couldn't come from the land without moving every plot's tiles.
- A catch needs chance, and the sim takes no randomness and no clock (rule 4 in `AGENTS.md`). The weather ([decision 0073](0073-weather-is-a-pure-function-of-the-world-day-and-the-utc-hour.md)) and the time of day ([decision 0011](0011-day-and-night-is-presentation-anchored-by-the-server-clock.md)) are worked out from the server's clock and never entered the log.
- Whatever the sim reads has to replay: a logged cast must catch the same thing forever.
- Fair play: a resident shouldn't be able to choose their luck, and casting fast or first shouldn't pay.

## Decision

- Water is a block, `pond`, on the end of `BLOCK_KINDS`, dug a tile at a time for 2 stone and given back as 2 stone to whoever takes it up. What a block costs is one function, `blockNeeds` in `packages/sim/src/items.ts` (decor and furniture take one of themselves, a pond its stone, the rest nothing), read by `place`, `remove`, `build`, and the starter home's check. The Town Hall can dig ponds in the Commons (`pond` joins `COMMONS_BLOCKS`), from nobody's things like every Commons block.
- A fishing rod is a good made at a workbench, in a new family, Tools. Fishing needs any one in your things, and it never wears out.
- Residents send `{"type": "fish"}`. The server fills in `roll` (a whole number below 10,000 from Web Crypto, by rejection sampling, so every value is as likely), `weather` (`skyAt(now)`), and `timeOfDay` (`timeOfDayAt(now)`) and logs all three with the cast. The sim reads only those and the season of the logged day. It refuses, as `server_only`, a cast whose fields the server would never log.
- The time of day is four quarters of the map's day and night cycle, centered on dawn, noon, dusk, and midnight. The cycle's length (`DAY_LENGTH_MS`) and `timeOfDayAt` moved from the server into the sim (`packages/sim/src/time-of-day.ts`) so the server, the snapshot, and every client agree; the sim's rules never call them.
- What bites is one frozen table, `CATCHES` in `packages/sim/src/fishing.ts`: each kind with its chance out of 10,000 and the seasons, times, and weather it bites in. A cast keeps the rows biting under its sky, in order, and the roll picks the first whose running total covers it; past them all, nothing. The boot comes first in every sky, and under every sky the chances leave room for nothing. A new fish or new numbers is a new table behind a logged switch, never an edit.
- A cast needs, in order: items open, a rod, water in one of the eight tiles around you (the line goes into the first, north first and on round clockwise), a cast left today (`cast_limit`), and room for one more thing. Every cast counts, whatever it brings up. A fish goes in your things with an `inventory` event, reason `caught`; a boot is thrown straight back; everyone sees `fished`.
- Fish never run out. No pond holds a stock, so a cast takes nothing from anyone, and who casts first, how fast, or how often within the cap changes no catch.
- Water is open to anyone beside it, like a plot's door, and the server refuses a cast into the pond of anyone blocked either way, or of a suspended owner, as it refuses a visit (`closedDoor`).
- Fish are a new role, `fish`, in a new family Food › Fish, drawn from a new look template, `fish`, by body shape and markings. Two dishes from fish are a new family, Food › Dishes. The collection book counts both with no change, from `inventory` events.
- No switch. `fish` is a new command, a pond a block `place` refused before, and the rod and dishes recipes `craft` refused before. The town's season buys only gain kinds on the end, so every logged `sell_to_town` sees what it saw. `items.today.casts` is absent until the first cast. `REPLAY_VERSION` stays 1.

## Consequences

- A logged cast replays exactly: the roll, the weather, and the time of day are in the log, and `CATCHES` is frozen. `fishing.test.ts` pins the table, every refusal, the catch at the edges of each running total, and that the same rolls catch the same fish whoever casts and whenever. `packages/sim/src/fixtures/fishing-log.ts` pins a log with ponds dug, moved with a plan, and taken up, a rod made, a day of casts under different skies, fish sold, cooked, and given, the Town Hall digging in the Commons, and a winter char, and `replay.test.ts` replays it from every split point. Every older fixture keeps its hash.
- The weather now changes something: what bites. It stays a pure function of the day and the hour, and only a cast's logged copy of it reaches the sim. `weather` on the world and the check-in says so, and both now carry `timeOfDay` beside it.
- Nobody can know a catch before it's made. A dry run checks that you could cast and draws nothing. Sending your own roll, weather, or time does nothing: the schema drops them and the server sets its own.
- Clients offer Fish and the pond with the sim's own `waterBeside` and `blockNeeds` ([decision 0052](0052-the-client-holds-back-actions-the-sim-would-refuse-using-the.md)), so they hold back only what the server would refuse.
- Whether owners may close their ponds, fish as pet treats or on pedestals, and bait or a second table of fish are each a decision of their own.
- Code: `packages/sim/src/fishing.ts`, `packages/sim/src/time-of-day.ts`, `POND` and `blockNeeds` in `packages/sim/src/items.ts`, the fish and dishes in `packages/sim/src/catalog.ts`, `castRoll` and `fish` in `packages/server/src/world-actions.ts`, `linkFish` in `packages/server/src/links/making.ts`, `packages/client/src/fishing.ts`, `paintPond` and `paintCast` in `packages/client/src/render.ts`, `pondMeshes` in `packages/client/src/scene3d/plot.ts`, `pondSvg` in `packages/cards/src/plot.ts`, and the fish template in `packages/ui/src/item-art.ts`.
