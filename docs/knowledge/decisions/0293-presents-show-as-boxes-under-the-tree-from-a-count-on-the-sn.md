---
title: "Presents show as boxes under the tree from a count on the snapshot, notices name who and never what, the town's present sends none, and the firework link lights your own tile"
date: 2026-10-15
status: accepted
tags: [client, server, protocol, holidays]
---

# Presents show as boxes under the tree from a count on the snapshot, notices name who and never what, the town's present sends none, and the firework link lights your own tile

## Context

[Decision 0291](0291-christmas-and-new-year-s-numbers-presents-wrapped-from-decem.md) built Christmas and New Year's and left five pieces of [RFC 0034](../../rfcs/0034-winter-holidays.md) for later: presents drawn on the map and in 3D, notices about presents, fireworks in 3D, link pages, and the Christmas name on the shelf. Each needed a small choice about what the wire carries and who is told.

## Decision

- The world snapshot carries `presents`, how many presents wait for each resident, never who from or what. The mirror keeps it with `present_given` and `present_opened`, which were public already. A pile sits under the little fir on the resident's home plot nearest their hearth, else beside the hearth, and residents who share a tree share a pile, at most three boxes drawn (`presentPiles` in `packages/client/src/presents.ts`). Plot photos leave presents out.
- A present a resident wraps sends its recipient a `present_received` notification, and opening it sends the giver `present_opened` (not when the new year opens it), through `notify()` with its caps and block check, each grouped per recipient per UTC day. They say who, never what. The town's present has no resident to name, so it sends none; the check-in's `open_presents` and `presents` in `GET /v1/inventory` say it's there. The check-in counts each kind in a `todo` line.
- Fireworks in 3D are one point cloud of soft round sparks, each with its own fade, so a burst reads over a bright daytime sky as well as the night, on the map's timeline, at most `BURSTS_MAX` at once (`packages/client/src/scene3d/fireworks.ts`).
- `/v1/act/<key>/open-present` lists presents with who each is from and the day it opens, and opens one with `present`. `/v1/act/<key>/firework` sets one off over the tile you stand on, since a link reader has no map to pick a tile from; `color` defaults to gold. Both join the "Next" list while they'd work.
- Midwinter's shop shelf reads "For Christmas" on December 24 and 25, and the check-in's lines say Christmas Eve and Christmas Day. No new holiday id.

## Consequences

- A present's count is public, as `present_given` already was; its contents stay in the recipient's private `inventory` event.
- A block made after a present was wrapped stops the notices (the block check), not the present (decision 0291).
- Code: `presentsWaiting` in `packages/sim/src/christmas.ts`, `presentsWaitingField` in `packages/server/src/world-wire.ts`, `presentNews` in `packages/server/src/social-service.ts`, `linkOpenPresent` and `linkFirework` in `packages/server/src/links/neighbors.ts`, `paintPresents` in `packages/client/src/render/decor-winter.ts`, `packages/client/src/scene3d/presents.ts`, and `shelfName` in `packages/client/src/shop-view.ts`.
