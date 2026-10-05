---
title: Simple gathering is in Phase 1: wood and stone pickups, no coins
date: 2026-10-05
status: accepted
tags: [sim, protocol, server, client, agents]
---

# Simple gathering is in Phase 1: wood and stone pickups, no coins

## Context

`docs/plans/phase-1.md` lists simple gathering (pick up wood/stone) as its last unstarted item, while [RFC 0001](../rfcs/0001-phase-1-prototype.md) said "No coins or resources in Phase 1." Issue #41 asked for the scope call. Ryan's call (2026-10-05): build the right thing, don't stall on old decisions. Gathering is in.

## Decision

- **Gathering ships in Phase 1.** New action `gather {x, y}`: fallen branches (`wood`) in forests and loose stones (`stone`) on stone ground, within reach, into the gatherer's inventory.
- **The spawn is a pure function of tile and day** (`gatherableAt` in `sim/src/gather.ts`), like `biomeAt`: every client draws the same sticks and stones, and the log never carries them. One pickup per tile per UTC day; `new_day` forgets yesterday's pickups.
- **No coins move.** Wood and stone are `resource` stack kinds: they count toward the 200-thing cap, can be given and traded in the market, and neither cost nor mint coins. Picking up what the town buys is untouched: the town doesn't buy them.
- **RFC 0001's "Economy impact" now reads "no coins in Phase 1"** instead of "no coins or resources". Blocks stay free and unlimited.

## Consequences

- `GET /v1/inventory`'s catalog gains `wood` and `stone`; `GET /v1/world` gains the day's picked-clean tiles (`gathered`), and there's a public `gathered {x, y, kind, by}` event plus a private `inventory` event with reason `gather`. New error code `nothing_to_gather`.
- Old logs replay to the hash they always had: `items.gathered` is absent until the first `gather`, and `new_day` only prunes it when it's there.
- Crafting recipes don't take wood or stone yet; that's a later phase's call.
