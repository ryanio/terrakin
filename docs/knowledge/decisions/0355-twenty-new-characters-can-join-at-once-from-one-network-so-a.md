---
title: Twenty new characters can join at once from one network, so a room on one Wi-Fi steps in together
date: 2026-10-22
status: accepted
tags: [server, security, rate-limits, playtest]
---

# Twenty new characters can join at once from one network, so a room on one Wi-Fi steps in together

## Context

New characters are limited per IP (an IPv4 address or an IPv6 /64), because every one adds a resident to the world log forever. The burst was 5 and the refill 3 a minute. A group of people on one Wi-Fi, like the Sunday gathering when people join together, shares one address, so the sixth person was told "Too many new sessions. Try again in a minute." at the very first step. Asking people to switch to mobile data was the workaround, and Ryan judged that most people won't.

## Decision

The burst is 20 and the refill stays 3 a minute (`RATE_LIMITS.sessions` in `packages/protocol/src/route-table/shared.ts`). Ryan's call, 2026-10-22.

## Consequences

The bucket is shared by `POST /v1/session`, invite accepts, `GET /v1/join` with a confirm code, and the socket `hello` with a name, so all of them take 20 at once. An idle address refills to 20 in about 7 minutes; the steady rate per address is unchanged.

Someone with many addresses (a proxy pool, IPv6 /64s) now gets 20 permanent residents per fresh address instead of 5, and could take free plots four times faster that way. There is still no global or daily cap on joins. If that shows up, the next step is a world-wide cap on new residents a day, not a smaller burst.

Decision 0020 cites "bursts of 5" as the brake on link joins; that brake is now 20.
