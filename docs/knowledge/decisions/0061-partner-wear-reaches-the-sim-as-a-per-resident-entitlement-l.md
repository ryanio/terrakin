---
title: Partner wear reaches the sim as a per-resident entitlement list the server logs, and comes off when it goes
date: 2026-10-05
status: accepted
tags: [sim, server, protocol, client, partners, economy]
---

# Partner wear reaches the sim as a per-resident entitlement list the server logs, and comes off when it goes

## Context

RFC 0007 phase 3: exclusive items and promos. Wear is validated by the sim ([decision 0029](0029-looks-are-curated-themes-plus-your-own-uploaded-art.md)), so a piece only some residents may wear has to be known to the sim the same way on every replay, without the chain or the clock. Ryan chose cosmetics only: nothing granted may gate play or give an edge.

## Decision

- **Partner wear is wear.** Two new wear items at the end of the catalog, `muse_halo` (a hat) and `muse_lantern` (carried), listed in `EXCLUSIVE_WEAR`. They are drawn by the 2D figure, the item art, and the 3D peg figures like any garment, and take a `wearStyle`. They are never in anyone's things, so they can't be given, sold, listed, or bought.
- **`set_entitlements {residentId, items}`** from `TOWN_ACTOR` replaces one resident's list (`state.entitlements`, absent until the first). `join` and `profile` refuse partner wear without an entitlement (`not_entitled`), and a style on it too; clearing a style is always allowed. When a list shrinks, anything the resident has on and may no longer wear comes off in the same input, with a `profile_changed`. A no-op is refused, so the log only grows on a real change. The public event is `entitlements_set`.
- **The server decides the list** from partner config (`perks.items`) plus the partner's running promos, on the server's clock (`from` inclusive, `until` exclusive, UTC days). It logs a change whenever a link is made, ends, or is rechecked, and `tick` compares every resident at most every 5 minutes, so a promo starts and ends without anyone acting. A paused partner's wear comes off, since pausing hides perks.
- **Decorative items stay out for now.** Placed decor needs inventories and the place rules; a partner piece that is placed waits for a partner that wants one.
- **MUSEGOD** gets the halo for every verified muse. It runs no promo: one goes out under the partner's name, so it waits until they agree to it (Ryan, 2026-10-05). The muse lantern stays in the catalog for that day.

## Consequences

- Worlds that never log `set_entitlements` hash exactly as before; `sim/src/fixtures/entitlements-log.ts` pins a log that sets, wears, grows, and shrinks entitlements.
- Profiles carry `entitled`, and the look editor offers partner wear only to residents who may wear it, never locked or for sale.
- A promo item that should stay after its promo would need a `kept` flag in config and a review; none does today.
- Code: `sim/src/entitlements.ts`, `EXCLUSIVE_WEAR` in `sim/src/looks.ts`, `partnerItems` and `promoRuns` in `server/src/partners.ts`, `syncEntitlements` and `reconcileEntitlements` in `server/src/world-service.ts`, `wearChoices` in `client/src/look-editor.ts`, and the halo and lantern in `ui/src/figure.ts`, `ui/src/item-art.ts`, and `client/src/scene3d/wear.ts`.
