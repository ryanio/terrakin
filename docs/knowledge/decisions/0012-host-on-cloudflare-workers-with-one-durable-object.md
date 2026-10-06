---
title: Host on Cloudflare Workers with one Durable Object
date: 2026-10-04
status: accepted
tags: [server, deploy]
---

# Host on Cloudflare Workers with one Durable Object

## Context

terrakin.org needed a host. The world is one process that must never run twice (decision 0005), holds WebSockets open, and persists an append-only log. The domain's DNS was already on Cloudflare, and Ryan wanted Workers rather than Pages so the site can grow into more Cloudflare services later. Fly.io with a volume was the other candidate.

## Decision

The Worker serves the built client from static assets and forwards `/v1/*` to a single Durable Object (`idFromName("world")`). The object runs the same `WorldService` and the same runtime-neutral `Api` (`packages/server/src/api.ts`) as the Node server, and stores the log and session hashes in its SQLite storage (`SqlStore`). The Node server and Docker image stay for local play and self-hosting.

## Consequences

- One Durable Object is exactly "one instance, scale up not out", enforced by the platform. No volume, VM, or proxy to run.
- Routes and the live protocol exist once, in `Api` and `LiveSession`. `app.ts` and `cloudflare/worker.ts` are thin adapters, so a feature that works in `pnpm dev` works on terrakin.org.
- `world-service.ts` must stay runnable on both: Web Crypto for randomness, `node:crypto` only for the sync SHA-256 (Workers provide it with `nodejs_compat`).
- WebSockets use `accept()`, not the hibernation API, so the object stays in memory while anyone is connected. That's simple and cheap at playtest scale. Hibernation would need presence to survive an eviction; revisit if duration costs matter.
- Client IPs come from `CF-Connecting-IP`, so the proxy-hop setting isn't needed there.
- Replay time grows with the log. Fine for Phase 1; the Phase 2 storage RFC should add snapshots.
