---
title: Server error reports, traces, and breadcrumbs carry templates and codes only
date: 2026-10-04
status: accepted
tags: [server, client, privacy, telemetry]
---

# Server error reports, traces, and breadcrumbs carry templates and codes only

## Context

The Worker had no error tracking (issue #22). A thrown error became a polite 500 and a line in Workers Logs, and nothing tied a client error to the request that caused it. Agents investigating production need the error, what led up to it, and how long each step took. The server sees more than the client does: bearer tokens, link keys in `/v1/act/<key>` paths, owner and invite codes, IPs, and every body. None of that may leave.

## Decision

The Worker and the World object report to Sentry's `terrakin-api` project through `@sentry/cloudflare`. Shared server code calls `packages/server/src/telemetry.ts`, which uses `@sentry/core` and does nothing until the Worker starts a client, so Node and the tests send nothing.

The server may send:

- Errors, including ones we catch and answer with `internal` (`world.fetch`, `world.persist`, `live.message`, `social.sweep`), with stack traces and the deploy's version id as the release.
- Spans for a quarter of requests, named by route template (`POST /v1/posts/{id}/like`) with the route id as `terrakin.route`. Inside: `api.handler`, `world.run` with the sim command type, `card.serve`, `page.meta`, and the SDK's own storage and fetch spans. A request whose `sentry-trace` header says it was sampled is traced too, up to 60 a minute per isolate: anyone can send that header, and without the cap a script could spend the span quota. The minute sweep and actions sent over a live socket start their own traces at 2%.
- Breadcrumbs: `api` (route template, status, error code) and `world` (command type and outcome).
- Metrics: `api.response` by route id, status, and error code, and `world.command` by command type and outcome.
- The request's user agent, which tells an AI assistant's calls from a browser's. Not the timezone Cloudflare derives from the IP: the scrubber drops it.

The browser now traces a fifth of page loads and the API calls they make, named by template, and sends `sentry-trace` and `baggage` only to our own `/v1/` paths, so a client error links to the server's trace. Web vital and interaction spans lose the element descriptions Sentry builds from `alt`, `aria-label`, and `title`, which hold names. It adds `api` crumbs (method, templated path, status, error code) and `live` crumbs (socket state and error codes), and reports a response that fails its schema with the route template and the failing field names.

Every event, span, breadcrumb, log, and metric goes through a scrubber before it leaves (console output becomes breadcrumbs, which are dropped; logs are scrubbed in case they're ever turned on): paths become templates, query strings go, ids, handles, codes, link keys, and anything token-shaped are replaced, and keys like `authorization`, `cookie`, `token`, `ip`, `headers`, and `body` are dropped. `dataCollection` is all off. `packages/server/src/telemetry.test.ts` and `packages/client/src/telemetry.test.ts` pin this.

## Consequences

- `node scripts/sentry.ts issues`, `issue <id>`, and `trace <id>` read it all from the terminal, and `resolve <id>` closes an issue once its fix is live.
- A new span, crumb, or metric takes only templates, route ids, codes, command types, and counts. Never an id or resident text, even though the scrubber would catch most of them.
- Reports can say which route failed and how often, never for whom. To follow one resident's trouble, reproduce it.
- The Worker grew by about 250 KB gzipped.
- Client stacks are minified until source maps are uploaded at deploy time.
- `pnpm cf:dev` runs with an empty `SENTRY_DSN`, so local runs never report to the production project.
- Decision [0015](0015-ga4-and-sentry-and-what-they-may-receive.md) still governs what the browser may send; it now allows the tracing above.
