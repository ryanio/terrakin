---
title: A read a world object restart broke goes again once, and a failed chain read says why
date: 2026-10-15
status: accepted
tags: [server, cloudflare, telemetry, reliability]
---

# A read a world object restart broke goes again once, and a failed chain read says why

## Context

Sentry caught `Error: Network connection lost.` on `GET /v1/world` (TERRAKIN-API-4). A Durable Object restarts on a deploy, a move, or an eviction, and a request in flight when that happens comes back to the Worker as a broken connection, which Cloudflare marks `retryable`. The Worker didn't catch it: the resident got Cloudflare's own 500 page instead of the API's error shape, and the error arrived in Sentry as unhandled. The same minute showed its sibling in the Worker logs, `Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.` The browser polls every 20 seconds, so the next read was fine; an agent making one call saw a bare failure.

The same look at the logs found `POST /v1/agent-link` answering 503 about twice an hour, for as long as the logs go back, every one of them logging `Agent link: down at partner`. `rpcReader` collapsed every way a read can fail (no endpoint for that network, a timeout, the endpoint refusing with a status, a JSON-RPC error that isn't a revert, an answer that isn't JSON-RPC, a throw) into one result, so the line couldn't say which, and nothing in it told us whether to fix our code, our config, or wait.

## Decision

The Worker asks the World object through `askWorld` (`packages/server/src/pages.ts`). A read whose connection broke that way goes again once: a GET or HEAD that isn't a socket upgrade, which the client reopens itself. A write never repeats, since the object may have applied it. Anything still unreachable is answered `unavailable` with the API's `{ error: { code, message } }` and 503, and reported once with `where: "world.fetch"`; a retry that worked is a `world.lost` count with `outcome: "retried"` and no report. An error the object threw itself is not a broken connection and goes on through, so a bug stays a bug and keeps its own report.

A chain read that doesn't come back carries `why`, one of `no_rpc`, `timeout`, `http` (with the `status`), `rpc_error`, `answer`, or `threw`. `Agent link: down at <where> (<why>)` prints it and the `agent_link.check` count carries `why` and `status` beside `where`. Codes and statuses only, as decision [0037](0037-server-error-reports-traces-and-breadcrumbs-carry-templates-.md) requires: no URL, no id, no text.

## Consequences

- A deploy no longer costs whoever was reading at that moment a 500: the read goes again against the restarted object. A write in flight still fails, and `Idempotency-Key` is how an agent sends it again safely.
- `world.lost` says how often the object restarts under live traffic. A rise in `outcome: "refused"` is a real problem; `retried` is the cost of a deploy.
- The next `Agent link: down at partner` says whether the endpoint refused us (`http 429`, `http 403`), was too slow (`timeout`), or answered something odd (`rpc_error`). `TERRAKIN_CHAIN_RPC` points the reader at another endpoint without a deploy of new code.
- The default endpoint for Robinhood Chain in `CHAINS` answers in about 120 ms from a laptop, so a read failing from the Worker is about what the endpoint does with Cloudflare's egress, not about the request we build. The reason code is how the next occurrence proves it.
