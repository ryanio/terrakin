---
title: Terrakin publishes itself as an Agent Places place, signed by the Worker
date: 2026-10-22
status: accepted
tags: [server, partners, integration]
---

# Terrakin publishes itself as an Agent Places place, signed by the Worker

## Context

Terrakin reports musegod's muses with its own key ([decision 0321](0321-terrakin-tells-musegod-where-its-muses-live-signed-with-a-pl.md)). musegod has since written that exchange up as an open spec, Agent Places (musegod.org/docs/sync), for any place and any collection of agent NFTs. Its 0.1 adds a file a place serves about itself at `/.well-known/agent-places.json`: its id, name and home, the pattern a token's own page there matches, and its keys, each signing `Agent Places: <id> at <origin> holds this key.`. A collection reads the file, checks it, and adds the place or takes a new key from it without asking the place for anything.

Terrakin is the first place to serve one. The file needs a signature from the reporting key, and that key lives only in the Worker's secrets (`MUSEGOD_WORLDS_KEY`), never in the repo or on a laptop.

## Decision

The Worker answers `GET /.well-known/agent-places.json` itself, ahead of the static files, building the file with `placeFile` in `packages/server/src/musegod-worlds.ts` and signing the line on each read with the key it already holds. With no key it is a 404, as in every other deployment and the Node server.

## Consequences

- The key never leaves the Worker to make the file, and the file always names the key Terrakin actually reports with. A rotated key shows up in the file on the next deploy with the new secret.
- Signing is deterministic (RFC 6979 through noble), so every read returns the same bytes, and the hour of edge caching is safe.
- The page pattern is a copy of musegod's `WORLD_URL.terrakin`, held to it by the test beside `placeFile`. If Terrakin's resident pages change shape, both move together.
- To rotate the key without a gap, the file can list the old key and the new one at once. That needs both private keys in the Worker for the length of the move; do it when a rotation comes.
