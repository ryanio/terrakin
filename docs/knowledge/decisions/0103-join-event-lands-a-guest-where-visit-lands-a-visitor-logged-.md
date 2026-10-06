---
title: join_event lands a guest where visit lands a visitor, logged with the tile
date: 2026-10-06
status: accepted
tags: [sim, server, events, replay]
---

# join_event lands a guest where visit lands a visitor, logged with the tile

## Context

`join_event` put a guest on the free tile nearest the event plot's middle, a rule the sim ran at apply time. On a plot with a starter hut that's inside the host's home, next to their hearth. A playtest on 2026-10-06 found guests standing in the host's hut. `visit` already lands a visitor at the plot's edge, in front of the door (decision 0091), and logs the tile so the planner can improve without changing replay. Changing `join_event`'s rule in place would replay every logged join differently.

## Decision

- The sim's `join_event` command takes an optional `x` and `y`, the tile the server picked. With them, the sim checks that tile against the world (inside the event's area, nothing standing there, no hearth, no other online resident) and never plans. Without them, as in every older log, it lands on the free tile nearest the middle, as it always did (`landingFor`).
- The server fills them in with the sim's `joinTile`, on the world as it will be (`asJoined`): on a plot someone lives on, `visitTile`, the visit planner itself; in the Commons, which has no door and no hearth, the free tile nearest the middle of the square, where a town event's crowd gathers. If the visit planner finds no free tile on the plot, the nearest-the-middle rule looks through the area around it.
- The action schema has no `x` or `y`, so a guest can't pick one. A guest already there, or coming back online there, stays where they stand, as before.

## Consequences

- Old logs replay unchanged: their joins carry no tile and land by the old rule, which `src/fixtures/events-log.ts` pins. `REPLAY_VERSION` stays 1.
- A better visit planner moves where later guests land too, and never a logged join.
- Code: `sim/src/events.ts` (`joinTile`, `checkJoinEvent`, `landingFor`), `server/src/world-service.ts` (the `join_event` branch of `perform`).
