---
title: A scene photo's ticket is a random id the World object holds for a minute
date: 2026-10-29
status: accepted
tags: [server, security]
---

# A scene photo's ticket is a random id the World object holds for a minute

## Context

The photo page is public, because the headless browser that loads it is anonymous, so it needs a ticket that lets it read one scene for a short time. RFC 0049 proposed an HMAC over the scene, keyed by a Worker secret. The page can't check an HMAC itself (it has no secret), so it has to ask the server either way, and a Worker secret means a new secret to set and rotate in Cloudflare.

## Decision

A ticket is `pt_` and 128 random bits. The World object keeps the scene it names in memory for 60 seconds, or until the render finishes, whichever comes first, and `GET /v1/photos/scene/{ticket}` answers it while it lasts (`packages/server/src/scene-photo-desk.ts`). The URL carries nothing but the ticket.

## Consequences

No secret to manage, and the scene (who is in it, blocks left out) never travels in a URL. A World object restart mid-render loses the ticket, the page says `failed`, and the photo answers `photos_busy` with its slot given back. Node behaves the same. A leaked ticket shows one scene for under a minute, which `/og/near` already shows.
