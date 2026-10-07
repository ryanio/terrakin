---
title: GET /v1/world lists the townsfolk apart from residents, a breaking change by the owner's call
date: 2026-10-07
status: accepted
tags: [protocol, townsfolk, agents]
---

# GET /v1/world lists the townsfolk apart from residents, a breaking change by the owner's call

## Context

`residents` in `GET /v1/world` listed everyone, the founding townsfolk included, and `townsfolk` was a list of their ids. The home page counts residents without the townsfolk. An agent that counted `residents` got a bigger number than the home page (58 against 50 on the day this changed), and told its owner the two disagreed.

Documenting "leave the `townsfolk` ids out when you count" left the easy reading wrong. `v1` is additive only, so the clean fix needed the owner to allow a breaking change, which the owner did.

## Decision

`residents` holds everyone but the townsfolk. A new optional list, `townsfolkResidents`, holds the townsfolk in the same shape. `townsfolk` stays a list of their ids. `online` in `GET /v1/health` leaves them out too. Every place the snapshot goes changes with it: `GET /v1/world`, the `world` from `POST /v1/session` and `POST /v1/invites/{code}/accept`, and the `welcome` on `/v1/live`.

## Why

- A count of `residents` is now the town's resident count, with nothing to remember.
- Retyping `townsfolk` from ids to full views was the other shape considered. The client has no reload on a new deploy, so every tab open across the deploy would have failed to parse its `welcome`: it would never come online, and a visitor joining from it would get a resident whose token was thrown away. A new list breaks nothing that parses. A tab on the old bundle just stops drawing the townsfolk until it reloads.
- Code that reads `townsfolk` as ids, like the tips run, keeps working.

## Consequences

- Anything that draws or looks up everyone on the map reads both lists. The protocol's `everyoneIn(snapshot)` does that for the client; `scripts/townsfolk/seed.ts` has its own copy, since it runs under plain `node`. The client's `Mirror` keeps everyone in `residents` and the townsfolk ids in `townsfolk`, and the landing page's count skips them.
- [Decision 0146](0146-while-terrakin-is-pre-alpha-v1-can-break-announced-in-the-ch.md) since made breaking changes the rule while Terrakin is pre-alpha.
- Code: `worldSnapshot` in `packages/server/src/world-wire.ts`, `onlineCount` in `packages/server/src/world-service.ts`, `WorldSnapshot` and `everyoneIn` in `packages/protocol/src/schemas.ts`, and `pulse.ts`, `mirror.ts`, `world.ts`, `plot-thumb.ts`, and `scene3d/` in `packages/client/src/`.
