---
title: A resident holds 400 things from a logged raise_inventory, and stacks still count by the unit
date: 2026-10-29
status: accepted
tags: [sim, items, numbers, server]
---

# A resident holds 400 things from a logged raise_inventory, and stacks still count by the unit

## Context

[Decision 0051](0051-items-open-with-a-logged-input-grow-by-the-world-s-day-and-s.md) capped what a resident holds at 200 things, counting every unit of a stack and every made thing. On terrakin.org a resident who gardens reaches that within a couple of weeks. One case from October 29: a resident at 200 had both gifts sent to them refused, and the resident sending them held 179, of which 173 were 13 garden stacks (40 herbs, 39 tomatoes, 35 strawberries, 34 flowers, and the rest sugar, jars, and fish) and 6 were made things. At the cap, gifts, catches, opened presents, pots coming out of a kiln, and things taken off display are all refused or held aside. So the cap limits produce far more than it limits treasures, and it lands on the residents who play the most.

Many rules fill up to the room left: a `gather` with no tile, the pantry, the town's presents, and things held aside coming back. Raising the number in place would change what those logged inputs did on replay, so the change needs a logged switch.

## Decision

From the moment the server logs `raise_inventory`, a resident holds up to 400 things (`ITEMS.raisedInventoryMax`). Before it, 200 (`ITEMS.inventoryMax`).

- `raise_inventory` is a one-time switch from the town, taken once items are open. It sets `items.inventoryRaised` and emits a public `inventory_raised {max}`.
- Every rule reads the cap through `inventoryMaxOf(state)` in `packages/sim/src/items.ts`, never the constant. `harvestFits` takes the cap as an argument, so the web passes `rules.inventoryMax` from `GET /v1/inventory`, which the server fills from the world.
- The server logs the switch with `raisedInventory: true`, which is in `WORLD_SWITCHES`, so terrakin.org and every Node world take it.
- Stacks still count by the unit. Counting a stack as one slot, or a slot per so many units, is the fix that matches the problem, but it changes what the cap means and every refusal's words, so it gets an RFC of its own.

## Consequences

- A gardener has about twice the time before the cap bites. Hoarding grows into the new number too, so 400 buys time rather than ending the problem.
- `src/fixtures/raised-inventory-log.ts` pins a log on both sides of the switch: the pantry gives 1 of its 2 bags of sugar at 199 before it, and in full after.
- The cap can go up again only behind another switch, or with an RFC and a `REPLAY_VERSION` bump.
