---
title: The town holds a gathering in the Commons every Sunday at 19:00 UTC, generated weekly from its calendar
date: 2026-10-13
status: accepted
tags: [server, events, town]
---

# The town holds a gathering in the Commons every Sunday at 19:00 UTC, generated weekly from its calendar

## Context

Issue #63: online counts sit at 1 to 3 of 41 residents, so most people log in alone. Residents come at all hours, and a world this size only feels lived in when several of them are there at once. The town already hosts its own events from a calendar in server config ([decision 0081](0081-the-town-hosts-events-from-a-calendar-in-server-config-start.md)), but that calendar held one evening, the harvest night. One hour a week that everyone knows about gives people a reason to come at the same time, and the check-in's `town_event` suggestion, the Town Hall's Coming up, the home wall's card, and the day-before notice ([decision 0274](0274-an-event-you-re-going-to-reminds-you-a-day-before-with-one-n.md)) already point at town events.

Choices someone could question:

- The day and hour. Residents are mostly in Europe and the Americas, and no single hour is evening in both.
- How long it lasts.
- How the weeks get on the calendar without listing each one by hand, and without logging a week twice.
- What happens when a week falls on a special evening like the harvest night.

## Decision

- Every Sunday from 19:00 to 20:00 UTC, a `gathering` in the Commons titled "Sunday gathering", with Clem (the cafe host) and Pip (the courier, who introduces neighbors) as its faces. In winter 19:00 UTC is 19:00 in London, 20:00 in Central Europe, 14:00 on the US east coast, 11:00 on the west coast, and 16:00 in São Paulo; in summer Europe and North America are an hour later. On a Sunday the afternoon in the Americas is free time, and the same hour is a weekend evening in Europe. Asia and Oceania are asleep for it; a second weekly hour for them can join the list once residents there ask.
- One hour, since the point is to be there at the same time. A guest counts after a third of it (at least 10 minutes), as at any event.
- `WEEKLY_TOWN_EVENTS` in `packages/server/src/town-events.ts` holds the weekly event once, with its first start (October 18, 2026). `townCalendar(now)` turns it into one `TownEvent` per week that starts after `now` and inside the booking window, keyed `sunday-gathering-<YYYY-MM-DD>` by the UTC day it starts, so a week's key is the same whenever it's computed, and the sim's refusal of a second event with a key it has keeps a restart from logging one twice. `WorldService`'s `townEvents` option is that function, which the minute sweep asks each time (both adapters pass `townCalendar`; `TERRAKIN_TOWN_EVENTS=off` passes none).
- One-off events keep their evenings. A week that would share the Commons with one, the 15-minute gap included, is left out of the calendar rather than logged and refused. The harvest night (Saturday October 31, 18:00 to 03:00 UTC) ends 16 hours before the gathering on November 1, so both go on.

## Consequences

- The Sunday gathering is always within the next 7 days, so the check-in's `town_event` suggestion is open every week to a resident who hasn't said they're going, at most every 3 days, ahead of most other suggestions. Saying you're going closes it for that week.
- The `host_event` suggestion offers 19:00 UTC on the first evening nothing on the calendar overlaps, so it never offers Sunday evening, and residents' own events don't split the gathering's crowd.
- A resident who books the Commons on a Sunday evening first keeps it, as with any town event: that week's gathering is refused, reported once per boot, and tried again each minute until the hour passes.
- Changing the hour or the day is a change to `WEEKLY_TOWN_EVENTS` and a deploy. Weeks already logged stay as they were; a new `first` starts the new schedule under new keys.
- Code: `packages/server/src/town-events.ts`, `scheduleTownEvents` in `packages/server/src/world-service.ts`, `packages/server/src/main.ts`, and `packages/server/cloudflare/worker.ts`. Tested in `packages/server/src/events.test.ts` ("the town's calendar").
