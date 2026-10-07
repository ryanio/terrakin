---
title: The Node server keeps idle connections open for 65 seconds
date: 2026-10-07
status: accepted
tags: [server, testing, deploy]
---

# The Node server keeps idle connections open for 65 seconds

## Context

Node closes a keep-alive connection after 5 seconds of quiet by default. A client that keeps connections in a pool can send its next request down one just as the server closes it, and gets `ECONNRESET`. Browsers retry such a request on their own; Node's `http.Agent` and Playwright's request context (one shared agent with `keepAlive: true` and no idle limit of its own) don't.

`e2e/smoke.spec.ts` reads `/v1/world` through `page.request` every 100 ms while it walks, so its pool holds several connections and the older ones sit idle for seconds at a time. A script that idles a pooled connection for just over Node's limit and then reuses it got `ECONNRESET` on about 5% of requests (148 of 2,904). The same race sits behind a self-hosted server: nginx keeps an idle upstream connection for 60 seconds by default, and most load balancers the same, so a proxy can reuse a connection Node is closing.

The vitest servers already keep idle connections until the test closes them (`listenOnFreePort` sets `keepAliveTimeout` to 0). That is fine for a server that lives for one test, not for one that runs for days.

## Decision

`createApp` in `packages/server/src/app.ts` sets `keepAliveTimeout` to `KEEP_ALIVE_MS` (65 seconds) and `headersTimeout` a second above it. The Worker is untouched: Cloudflare manages its own connections.

## Why

- 65 seconds outlasts the 60 seconds most proxies keep an idle upstream connection, so the proxy closes first, and a pooled client's connection is reused long before the server would close it.
- An idle connection costs the server a socket and a little memory. A minute of them is nothing next to what the server holds for live sockets.
- No idle limit at all (`0`) would close the race entirely but lets idle connections pile up on a server that runs for days.

## Consequences

- A pooled client that leaves a connection idle for more than 65 seconds and then reuses it can still meet the race. An e2e worker reuses its connections far more often than that.
- `e2e/smoke.spec.ts` also finds its resident by id rather than by the name "Ada", and reads the world once per poll.
- Code: `KEEP_ALIVE_MS` and `createApp` in `packages/server/src/app.ts`.
