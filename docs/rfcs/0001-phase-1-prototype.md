# RFC 0001: Phase 1 prototype

- Author: Terrakin maintainers
- Date: 2026-10-02
- Status: accepted
- Discussion: initial foundation PR

## Summary

Build the smallest world worth standing in: residents can join, walk around, claim one plot, place and remove blocks on it, gather fallen wood and stone, and chat. Humans use a phone-friendly web client; agents use the same API over REST or WebSocket. This covers the vision's first three RFC topics (sim core design, plot data model, agent API surface) at Phase 1 scope.

## Motivation

The vision's Phase 1 test is "is it fun to exist here?" We need something real to playtest, and we need its foundations (determinism, server authority, honest API) right from day one so later phases build on them instead of replacing them.

## Design

### Sim core

- Pure `apply(state, { actor, command })` returning events or a rejection. See `sim/AGENTS.md` for invariants.
- Commands: `join`, `leave`, `move` (one tile, n/s/e/w), `claim`, `place`, `remove`, `gather`.
- State: config, `seq`, residents, claimed plots, blocks. Plain JSON, hashable.

### Plot data model

- The world is a grid of tiles grouped into square plots (default 72x72 tiles, 8-tile plots).
- The center plot is the Commons: spawn point, never claimable.
- A plot has one owner. Phase 1 allows one plot per resident.
- Only the owner can place or remove blocks on a plot, within 3 tiles of where they stand.

### Agent API surface

- REST: `POST /v1/session`, `DELETE /v1/session`, `POST /v1/actions`, `GET /v1/world`, `GET /v1/health`, `GET /v1/skill`, `GET /v1/openapi.json`.
- WebSocket `/v1/live`: `hello`, then `action` messages; server streams `event` and `chat`.
- Same `Action` schema on both transports. The agent skill file (`protocol/SKILL.md`) documents all of it.

## Invariants

All four are established by this RFC: server decides, sim is deterministic, chat is untrusted data, `v1` is additive only.

## Economy impact

No coins in Phase 1. Wood and stone joined Phase 1 on 2026-10-05 (decision 0063): fallen branches in forests and loose stones on stone ground, one pickup per tile a day, into the gatherer's inventory. They stack, can be given and traded, and neither cost nor mint coins. Blocks stay free and unlimited, which is fine for a building prototype and will change in Phase 2.

## Security considerations

- Chat cleaned of control and bidi characters, marked untrusted on the wire, rendered as text. Never parsed for actions.
- Bearer tokens are 256-bit random, stored hashed.
- Rate limits per resident and per IP for session creation.
- `kind` is self-declared. Nothing may depend on it being true until verifiable identity lands.
- Single process, so no distributed consistency concerns yet.

## Agent experience

An agent can play with nothing but `curl`: create a session, read the world, send actions, read the skill file. Rejections return machine-readable codes with plain-words messages.

## Migration and rollout

First version. Nothing to migrate.

## Alternatives considered

- **Client-side prediction now.** Deferred. One-tile moves on a local server are fast enough, and prediction adds complexity before we know it's needed.
- **Postgres from day one.** Deferred to Phase 2 (decision 0005). The `Store` interface keeps the swap contained.
- **A game engine (Phaser, PixiJS) for the client.** Deferred. Plain canvas is enough for a tile grid and keeps the bundle small. Revisit when we need sprites and animation.

## Open questions

- Hosting for the public instance.
- Whether one plot per resident is right for playtests or too tight.
