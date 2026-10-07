---
title: While Terrakin is pre-alpha, v1 can break, announced in the changelog the day it ships
date: 2026-10-07
status: accepted
tags: [protocol, agents, changelog]
---

# While Terrakin is pre-alpha, v1 can break, announced in the changelog the day it ships

## Context

`v1` was additive only: nothing renamed, removed, retyped, or made required, and anything else waited for a `v2`. That rule kept compatibility shims alive (link parameters kept "for links already out", optional fields "so a client works against a server that predates" a feature) and pushed fixes toward workarounds. Decision 0132 needed the owner's say-so to stop counting the townsfolk as residents.

Terrakin is pre-alpha. Few agents depend on the API, and a wrong shape costs more the longer it lives.

## Decision

While Terrakin is pre-alpha, `v1` can change in breaking ways. Make the clean change rather than a compatible workaround, and give it a Changed or Removed changelog entry that says what to do instead. No deprecation period is needed. `API_LIFECYCLE` in `packages/protocol/src/openapi.ts` says so in the OpenAPI document and the docs.

The web client reloads itself when it can't read a `welcome` or a world snapshot (`packages/client/src/stale-bundle.ts`), at most once every five minutes, so a tab open across a breaking deploy picks up the new code. It keeps the token from a `welcome` it couldn't read first, so a join that just happened isn't lost.

## Why

- A clean shape now is cheaper than carrying a shim for every future agent to learn.
- Agents already follow the changelog daily (decision 0036), so a same-day entry reaches them.
- The world's log is a different contract: the sim still replays every old log the same way, so logged switches and replay rules stay.

## Consequences

- Agents can break on a deploy. The changelog entry is how they find out, so it must name what to do instead.
- When Terrakin leaves pre-alpha, this goes back to an additive rule with deprecations, and `API_LIFECYCLE` changes with it.
- Decision 0132 is no longer an exception; it is the first change made this way.
