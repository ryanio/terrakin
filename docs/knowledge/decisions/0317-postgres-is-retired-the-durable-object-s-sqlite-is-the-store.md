---
title: Postgres is retired; the Durable Object's SQLite is the store
date: 2026-10-19
status: accepted
tags: [server, storage, docs]
---

# Postgres is retired; the Durable Object's SQLite is the store

## Context

[Decision 0005](0005-phase-1-storage-and-identity.md) put storage behind a `Store` interface, shipped `MemoryStore` and `JsonlStore` for Phase 1, and said "Postgres replaces `JsonlStore` after an RFC on the schema". It also tied horizontal scaling to that: "Single server process only. No horizontal scaling until Postgres lands."

That is not what happened. [Decision 0012](0012-host-on-cloudflare-workers-with-one-durable-object.md) put terrakin.org on Cloudflare Workers behind one Durable Object named `world`, and the log and session hashes live in that object's own SQLite through `SqlStore` (`packages/server/src/sql-store.ts`), replayed on boot like the JSONL files. Phase 2's economy, Phase 3's seasons, levels, jobs and kindreds all shipped on it. No RFC on a Postgres schema was ever written and nothing has been built toward one.

Meanwhile two places still promise it: `packages/server/README.md` says "Postgres and Redis come with Phase 2", and the doc comment on `JsonlStore` says "Postgres replaces this once an RFC settles the schema". A reader who believes them is waiting for a database nobody is building.

## Decision

- Postgres is retired as a plan. The store for terrakin.org is the Durable Object's SQLite.
- The `Store` interface stays, with its three implementations: `MemoryStore` for tests and dev, `JsonlStore` for a Node server or a self-hosted container, and `SqlStore` for the Durable Object.
- Horizontal scaling is not pending on a database. One Durable Object holds the single authoritative world on purpose (decision 0012), and the replay check in CI depends on there being one log.
- A different store later, Postgres included, needs its own RFC that argues for it from a problem. It does not inherit decision 0005's promise.

## Consequences

- The Postgres sentences come out of `packages/server/README.md`, the `JsonlStore` comment and `docs/plans/phase-1.md` item 2, which is the same drift in a third place.
- Decision 0005 keeps its other two parts, which are still true and still load-bearing: sessions are random 256-bit bearer tokens with only their SHA-256 stored, and `kind` is self-declared.
- A self-hoster who wants a real database has `JsonlStore` and the `Store` interface, and now knows that is the supported shape rather than a stopgap.
- Redis was named in the same breath in the server README and is retired with it. Nothing in the server uses or needs it.
