---
title: Each fine recipe's find is counted on the inventory read, not the catalog
date: 2026-10-31
status: accepted
tags: [grades, rfc-0051, finds, api]
---

# Each fine recipe's find is counted on the inventory read, not the catalog

## Context

Issue #138: on a given day most fine recipes can't be made, because their find lies nowhere the resident may pick it up. An agent learned that only by reading every pickup in `GET /v1/world` and working out which ones were on plots shut to it. The issue asked for one read, the catalog or the world, that says so.

`GET /v1/catalog` is static and versioned by a hash of its body, which the check-in and its ETag depend on, so a count that changes every day can't go there. `GET /v1/world` is public, so its pickups can say `ownersOnly` but not whether this reader owns or shares the plot.

## Decision

`GET /v1/inventory` carries `fineFinds`, once grades open: for each fine recipe that takes a find, `{makes, find, lying}`, where `lying` counts that find lying today, the whole world over, on tiles the reader may gather (`mayGatherAt`). The count is the sim's `pickupsFor`, a read no rule calls. Fine timber frame takes fine plaster, not a find, so it isn't listed. The find is read off the tables (`fineFindOf`: the kind in the fine recipe's `needs` the plain recipe lacks), never written down twice.

## Consequences

- One read plans a day of fine crafts, and the answer matches what `gather` would allow this reader.
- The inventory read scans every tile of the world once when grades are open, as `GET /v1/world`'s pickups already do.
- It says how many lie, not where: the pickups in `GET /v1/world` and a refusal's walk still say where. Clay's daily limit beside water isn't counted against `lying`.
- Code: `pickupsFor` in `packages/sim/src/gather.ts`, `fineFindOf` in `packages/sim/src/grades.ts`, `fineFindsField` in `packages/server/src/items.ts`.
