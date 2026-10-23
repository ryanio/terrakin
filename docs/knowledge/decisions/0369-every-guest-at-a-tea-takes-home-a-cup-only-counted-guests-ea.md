---
title: Every guest at a tea takes home a cup, only counted guests earn Hosting, and pottery opens after levels
date: 2026-10-23
status: accepted
tags: [sim, server, economy]
---

# Every guest at a tea takes home a cup, only counted guests earn Hosting, and pottery opens after levels

## Context

A third agent played pottery cold, still switched off, and scored it 6 out of 10. Round four had tea refuse to pour unless a counted guest was there, so a newcomer who came to a friend's tea went home with nothing, which read as a rule against them. Tea also went nowhere in a world where levels were closed, because its cups go out with `credit_event`, which levels open. And the RFC's first economy check (the money supply per active resident within 2% of a month without pottery) failed, because the vase and teapot cards burned 20 and 25 coins each.

## Decision

- **A cup for everyone there.** Serving tea records who is at the event as it goes out (`teaFor`). The server's `credit_event` carries `cups`: those people and everyone who attended by the samples, never the host or townsfolk, and never anyone blocked either way with the host, which the sim can't see. The sim checks each is someone who was there. Hosting points still come only from counted guests, by the hosting record's rules. Serving is refused only while nobody is there to pour for.
- **Pottery opens after levels.** The day table logs `open_clay` only once `state.progress` exists, and the test route opens levels first. Tea's credit has nowhere else to go, so a world can't have one without the other.
- **The pot cards cost 6 and 8.** They are `POTTERY.potCards`, set apart from `recipeCardPrice`'s rule, which would make them 20 and 25.

## Consequences

- A newcomer gets the keepsake for coming, which is the point of tea. Hosting can't be farmed with it: the points still follow the counted-guest rules.
- The economy run with `--kiln` and the cheaper cards: 297 coins per active resident against 301 without pottery (-1.3%), a supply of 40,858 against 41,368 (-1.2%), 340 coins burned on cards (8.3 a potter, against 1,095 at 20 and 25). The town paid 13,938 for goods against 13,871 (+0.5%), a hair over the RFC's "no higher".
- Once `open_clay` is logged on terrakin.org, changing any of this replays differently, so it moves `REPLAY_VERSION` or goes behind a switch ([learning](../learnings/2026-10-23-a-test-world-s-log-written-under-earlier-pottery-rules-no-lo.md)).

Code: `packages/sim/src/thanksgiving.ts` (`checkServeTea`), `packages/sim/src/levels.ts` (`checkCreditEvent`'s `cups`), `packages/sim/src/pottery.ts` (`POTTERY.potCards`), `packages/server/src/world-service.ts` (`creditEvent`, the `clay` switch, `testOpenClay`), `packages/server/src/events.ts` (`teaRefusal`).
