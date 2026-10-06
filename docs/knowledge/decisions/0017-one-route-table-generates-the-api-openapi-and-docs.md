---
title: One route table generates the API, OpenAPI, and docs
date: 2026-10-04
status: accepted
tags: [protocol, server, docs, agents]
---

# One route table generates the API, OpenAPI, and docs

## Context

The REST API was described four times: a `switch` in `packages/server/src/api.ts`, a hand-built OpenAPI document, endpoint lists in `packages/protocol/SKILL.md`, and the API section of `llms.txt`. Rate limits lived as numbers in the server and as prose in the docs. Every new route meant editing all of them, and nothing checked that they agreed. Agents learn the API from the docs, so a stale line costs real calls.

## Decision

`packages/protocol/src/routes.ts` holds one `as const` table of every REST route: id, method, path, auth, summary, tags, zod schemas for params, query, and body (or a binary upload marker), responses by status, error codes, and rate limits. Everything else comes from it:

- The server compiles a path matcher from the table. For each request it authenticates, rate limits, and parses params, query, and body with the route's schemas, in that order, then calls a typed handler. Handlers sit in one object keyed by route id, and its type makes a missing, unknown, or wrongly shaped handler a compile error.
- `buildOpenApi()` generates the document from the table, with every exported schema as a named component and the WebSocket messages under `x-websocket`.
- `pnpm gen` writes the API block in `SKILL.md`, the API block in `packages/client/public/llms.txt`, and a committed `packages/protocol/openapi.json` snapshot. `pnpm gen:check` runs in `pnpm verify` and CI and fails when any of them is stale.
- Server tests pass an `onResponse` hook that checks every response against the route's schema for its status, including undeclared fields and undeclared error codes.

## Consequences

- Adding a route is: add it to `routes.ts`, write its handler (the compiler points at the gap), run `pnpm gen`. A GET route with query parameters is one entry with a `query` object whose fields accept a missing value.
- The OpenAPI diff in review shows every API change, since the snapshot is committed.
- Handler return types catch missing fields and undeclared statuses at compile time. Extra fields slip past TypeScript's checks on union return types, so the test hook is what catches those.
- Prose in `SKILL.md` still explains how to use the API. Keep endpoint lists and limit numbers out of it, and point to the generated reference instead.
- `scripts/gen.ts` runs on plain Node with a small resolve hook so the workspace's extensionless imports load. If the packages ever switch to explicit `.ts` imports, the hook can go.
- The daily caps and rate limits the docs quote are the same constants the server uses (`RATE_LIMITS`, `DAILY_LIMITS`).
