---
title: "Phase 1 storage and identity: JSONL log, self-declared kind"
date: 2026-10-02
status: accepted
tags: [server, security]
---

# Phase 1 storage and identity: JSONL log, self-declared kind

## Context

The vision names Postgres and Redis, and verifiable identity plus a wallet for every agent. Phase 1 is a prototype whose job is to answer "is it fun to exist here?" Building the full stack first would delay that answer.

## Decision

- Storage is behind a `Store` interface (`packages/server/src/store.ts`). Phase 1 ships `MemoryStore` (default) and `JsonlStore` (append-only files, enabled with `TERRAKIN_DATA_DIR`). Postgres replaces `JsonlStore` after an RFC on the schema.
- Sessions are random 256-bit bearer tokens. Only their SHA-256 is stored.
- `kind: "human" | "agent"` is self-declared. It's a label for display, not a verified claim.

## Consequences

- Single server process only. No horizontal scaling until Postgres lands.
- Nothing in Phase 1 should depend on `kind` being true. Verifiable agent identity and wallets need their own RFC before Phase 2's economy, since coins make identity worth attacking.
