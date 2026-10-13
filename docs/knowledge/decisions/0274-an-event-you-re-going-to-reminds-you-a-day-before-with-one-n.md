---
title: An event you're going to reminds you a day before with one notice from Terrakin
date: 2026-10-12
status: accepted
tags: [server, protocol, client, events]
---

# An event you're going to reminds you a day before with one notice from Terrakin

## Context

Issue #63 says online counts sit at 1 to 3, so people log in alone. An event you said you're going to tells you when it starts ([decision 0267](0267-an-event-you-re-going-to-tells-you-when-it-starts-with-one-n.md)), and the check-in has a `todo` line for one within a day, but a person who doesn't check in that day only hears at the start, which is too late to keep the hour free.

Choices someone could question:

- How far ahead. An hour is too late to plan around; a week is too early to remember.
- Who gets it. Someone who said they're going an hour before has just looked at it.
- Where it runs. Nothing in the world happens a day before an event, so there's no logged input to hang it on, and the Worker's World object sleeps between alarms.
- How it avoids a second copy across sweeps and restarts.

## Decision

- One `event_soon` notice from Terrakin itself (`system: true`), a day (`SOON_NOTICE_MS` in `packages/server/src/events.ts`) before an event starts, to the residents `event_started` would reach: everyone in `event_going` but the host, townsfolk, and anyone blocked either way with a resident host.
- Only residents who said they're going before that day began (`goingTo(event, startsAt - SOON_NOTICE_MS)`). Someone who says so inside the day gets no reminder, only the start's notice.
- The minute sweep (`WorldService.sweepEvents`) hands each scheduled event inside its day to `onEventSoon` once per process, and again after a failure. `nextEventWake` wakes the World object at each event's mark, so the reminder goes out on time with nobody connected. Each notice's `group_key` is `event_soon:<id>`, so `systemNotice` writes none twice; a boot's first sweep asks again and sends nothing new.
- A cancelled or voided event is no longer `scheduled`, so it sends none. One called off after the reminder reads as called off, since the notice stores only the id and each read builds `event` as the event stands then (`eventNoticeView`, as for `event_started`).
- In-app only, like the start's notice: the notification list (worded "An event you're going to is coming up." with when, in the reader's own time, and a link to Coming up) and the check-in's `notifications`.

## Consequences

- A resident going to an event hears about it twice at most: a day before and at the start.
- An event scheduled less than a day ahead sends no reminder to anyone, since everyone going said so inside its day.
- The World object wakes once more per event, a day before it starts.
- Code: `SocialService.eventSoon` in `packages/server/src/social-service.ts`, `onEventSoon`, `sweepEvents`, and `nextEventWake` in `packages/server/src/world-service.ts`, `packages/server/src/api-wiring.ts`, `NOTIFICATION_TYPES` in `packages/protocol/src/social.ts`, and `eventNoticeLine` in `packages/client/src/notifications-view.ts`. Tested in `packages/server/src/events.test.ts` and `packages/client/src/social.test.ts`.
