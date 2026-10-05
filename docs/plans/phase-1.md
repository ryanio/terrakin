# Phase 1: Prototype

**Goal:** prove it's fun to exist here. A tiny playable world, usable on a phone.

## What ships

- Walk around a small persistent map (touch + keyboard).
- See other residents, spatial chat.
- Claim a plot, place and remove blocks on it.
- Day/night, a few biomes, simple gathering (pick up wood/stone).
- Honest API from day one: every number the client shows comes from the server.

## What explicitly doesn't ship

Economy, crafting, combat, clans, seasons, accounts beyond a simple identity. Those are later phases (see `founding-plan.md`).

## Work items

1. [x] `sim/`: deterministic core. Grid, residents, movement, claim, block place/remove. Tested, with replay.
2. [x] `server/`: REST `/v1` and WebSocket presence + chat. Storage is an append-only log for now; Postgres moves to Phase 2 ([decision 0005](../knowledge/decisions/0005-phase-1-storage-and-identity.md)).
3. [x] `client/`: touch-first renderer + UI. Walk, chat, claim, build.
4. [x] `protocol/`: OpenAPI for `/v1` and the agent skill file, which doubles as the onboarding for AI assistants ([RFC 0002](../rfcs/0002-muse-onboarding.md)).
5. [x] `docs/`: [RFC 0001](../rfcs/0001-phase-1-prototype.md) covers the plot data model, the sim, and the agent API surface. (The sim is event-driven, not ticked, so far.)
6. [x] Spatial chat: the server relays a message only to residents within earshot (12 tiles), with an opt-in world channel.
7. [x] Day/night cycle: the snapshot carries the server's time anchor and the client renders a night tint. The sim never sees a clock, so replay stays deterministic.
8. [x] Biomes: `biomeAt` is a pure deterministic function of position, presentation-only ([decision 0045](../knowledge/decisions/0045-biomes-are-a-pure-function-of-position-presentation-only.md)).
9. [x] Simple gathering (pick up wood/stone): `gather {x, y}`. Fallen branches in forests, loose stones on stone ground, one per tile a day, into the inventory. On a claimed plot, only its owner and co-owners gather; the Commons and unclaimed land are open. In scope per decision 0063 (Ryan, 2026-10-05).
10. [x] Deploy at terrakin.org (Cloudflare Workers, see [deploy.md](../deploy.md)).

## Done when

Two people (or one person and one agent) can walk around on their phones, chat, claim neighboring plots, and build something together. Then we devlog it and start Phase 2.
