---
title: Simple gathering is in Phase 1: wood and stone pickups, no coins
date: 2026-10-05
status: accepted
tags: [sim, protocol, server, client, agents, replay]
---

# Simple gathering is in Phase 1: wood and stone pickups, no coins

## Context

`docs/plans/phase-1.md` lists simple gathering (pick up wood/stone) as its last unstarted item, while [RFC 0001](../rfcs/0001-phase-1-prototype.md) said "No coins or resources in Phase 1." Issue #41 asked for the scope call. Ryan's call (2026-10-05): build the right thing, don't stall on old decisions. Gathering is in.

## Decision

- **Gathering ships in Phase 1.** New action `gather {x, y}`: fallen branches (`wood`) in forests and loose stones (`stone`) on stone ground, within reach, into the gatherer's inventory.
- **The spawn is a pure function of tile and day** (`gatherableAt` in `sim/src/gather.ts`), like `biomeAt`: every client draws the same sticks and stones, and the log never carries them. One pickup per tile per UTC day; `new_day` forgets yesterday's pickups.
- **No coins move.** Wood and stone are `resource` stack kinds: they count toward the 200-thing cap, can be given and traded in the market, and neither cost nor mint coins. Picking up what the town buys is untouched: the town doesn't buy them.
- **Biomes now have a gameplay effect** ([decision 0045](0045-biomes-are-a-pure-function-of-position-presentation-only.md) said they had none). Where pickups fall reads `biomeAt`, so a change to `biomeAt`, `BIOME_REGION`, the spawn hash, or `GATHER`'s chances changes which logged `gather`s replay. That change needs an RFC. `gather.test.ts` pins the spawn and a gather log's hash.
- **A claimed plot's pickups are its owners'.** Ryan's call (2026-10-05, after launch): on a claimed plot, only its owner and co-owners can `gather`. The Commons and unclaimed land stay open to everyone. Anyone else is refused with `not_your_plot`, whose message names the plot's owner by id and the nearest pickup within 12 tiles they may take (decision 0044's next-step hint). The check comes after `nothing_to_gather`, so an empty tile still says it's empty. Gathering shipped first with no such rule ("a pickup belongs to whoever gets there"), and the live log may hold gathers on other residents' plots.
- **The rule starts at a logged point.** Refusing those old gathers on replay would break the world at boot, so the rule is off until the server logs `own_plot_pickups`, which sets `items.plotPickupsOwned`. `WorldService` sends it once from `tick` when items are open and it was never logged (option `plotPickups`, on in both adapters), the same way it sends `open_gifts` ([decision 0057](0057-a-gift-can-carry-a-thing-and-its-recipient-can-send-it-back-.md)). Before it, `gather` checks and hashes exactly as it did. `gather.test.ts` pins a log with a stranger's gather before the switch and the same kind of gather refused after it.
- **Clients ask the sim.** `mayGatherOn(plot, resident, ownersOnly)` is pure, so the map and the 3D world draw every pickup (they're scenery) and, when you tap one you can't take, say whose plot it is instead of walking there.
- **RFC 0001's "Economy impact" now reads "no coins in Phase 1"** instead of "no coins or resources". Blocks stay free and unlimited.

## Consequences

- `GET /v1/inventory`'s catalog gains `wood` and `stone`; `GET /v1/world` gains the day's pickups (`pickups`) and picked-clean tiles (`gathered`), and there's a public `gathered {x, y, kind, by}` event plus a private `inventory` event with reason `gather`. New error code `nothing_to_gather`.
- Old logs replay to the hash they always had: `items.gathered` is absent until the first `gather`, and `new_day` only prunes it when it's there.
- `GET /v1/world` gains `plotPickupsOwned: true` once the rule is on, and `ownersOnly: true` on each pickup on a claimed plot. There's a public `plot_pickups_owned` event when it starts.
- A plot's pickups follow its shares: `share_plot` opens them to the new co-owner, and `unshare_plot` or `release` closes or opens them again.
- Crafting recipes don't take wood or stone yet; that's a later phase's call.
