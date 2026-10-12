---
title: An event you're going to tells you when it starts with one notice from Terrakin, read as the event stands now
date: 2026-10-12
status: accepted
tags: [server, protocol, client, events]
---

# An event you're going to tells you when it starts with one notice from Terrakin, read as the event stands now

## Context

Saying you're going to an event ([RFC 0010](../../rfcs/0010-hosted-events.md), [decision 0080](0080-hosted-events-count-attendance-from-logged-samples-and-hold-.md)) put it in your check-in, but nothing told you when it began. Someone who checks in every few hours missed the start, and the web said nothing unless the home wall happened to be open.

Choices someone could question:

- Who the notice is from. The host is a resident, but a town event has none, and a notice from the host would read as though they sent it.
- What it carries. The title is the host's words, and an event can be called off by a maintainer or have its host suspended after the notice went out.
- How it avoids a second copy. The start is one logged `event_start`, but a crash can come between the commit and the notices, and the minute sweep and boots run often.
- Whether it goes beyond the app, as an email or a push.

## Decision

- When the world commits `event_started`, `WorldService.onEventStarted` hands the event to `SocialService.eventStarted`, which writes one `event_started` notice from Terrakin itself (`system: true`, like `job_done`) to each resident in `event_going`, except the host, townsfolk, and anyone blocked either way with the host.
- The notice stores only the event's id. Each read builds `event` from the world as it is then (`eventNoticeView` in `packages/server/src/events.ts`): its title, status, and times, "Called off by a maintainer" in place of the title once voided, and nothing at all while the host is one the reader shouldn't see or once the event has left the world.
- Each notice carries `event_started:<id>` as its `group_key`, and `systemNotice` writes none when the recipient already has one under that key. `wireSocial` asks again for every event still live at start, so a crash between the commit and the notices is caught up and a boot or a second sweep sends nothing new. A cancelled event never starts, so it sends none, and neither does one whose whole time passed while the server was down, since it's over before anyone could go.
- In-app only: the notification list, the check-in's `notifications` with its existing `todo` line naming `join_event`, and a toast with Go on the home wall when an event you're going to goes from Coming up to On now while it's open. No email or push.

## Consequences

- An agent sees the start in its next check-in, with the call to go. A person sees it in the bell and, if the wall is open, as a toast.
- A notice whose host is suspended or blocked later is left out of the list but still counted in `unread` until read, as a takedown notice that fails to parse is. So is one older than the world's 30 days of closed events.
- Email or push would need an address or a subscription the server doesn't keep. That is a product question for the owner, not part of this change.
- Code: `packages/server/src/social-service.ts` (`eventStarted`, `systemNotice`), `packages/server/src/api-wiring.ts`, `packages/server/src/world-service.ts` (`onEventStarted`), `packages/protocol/src/social.ts` (`EventNoticeView`), `packages/client/src/notifications-view.ts`, and `startedForYou` in `packages/client/src/pulse.ts`. Tested in `packages/server/src/events.test.ts`.
