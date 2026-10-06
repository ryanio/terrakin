---
title: The town hosts events from a calendar in server config, starting with a nine-hour harvest night
date: 2026-10-06
status: accepted
tags: [sim, server, town, events, seasons]
---

# The town hosts events from a calendar in server config, starting with a nine-hour harvest night

## Context

At acceptance, [RFC 0010](../../rfcs/0010-hosted-events.md) was extended so the town can host while it's small: a server-only input schedules a town event in the Commons, with no deposit, no karma for the town, and none of the per-host limits. The first is the harvest night on the last evening of October 2026, closing out autumn. It should cover evening in both Europe and the Americas, from 18:00 UTC on October 31 to 03:00 UTC on November 1. That's nine hours, and a resident's event lasts at most three. Each town event has to be logged once, however often the server restarts.

## Decision

- The calendar is a fixed list in server config. `TOWN_EVENTS` in `server/src/town-events.ts` holds each town event's `key`, kind, words, start, length, and the handles of the townsfolk who are its face. The minute sweep logs each as `schedule_town_event` from the town's actor once its UTC day is within the 14-day booking window and it's still to come. The sim refuses a second event with the same `key`, so a restart never logs one twice, and finished events stay in the world for 30 days, past any chance of logging one again.
- Faces are named by handle and logged as the resident each names, while that resident is townsfolk. A handle that names nobody, or someone who isn't townsfolk, is left out.
- The harvest night is one 540-minute event, since a town event may run up to 12 hours (`EVENTS.townMinutesMax`). That gives one card, one feed line, one attendance list, and lanterns lit all evening. Back-to-back three-hour events would need 15 minutes between them, and the Commons would go dark and the home wall's On now card would vanish in each gap.
- Attendance counts at most a three-hour event's samples. A third of the samples over nine hours would ask for three hours, so the share counts at most 35 samples (the most a resident's three-hour event takes), and the harvest night asks for an hour, as a three-hour event does. Nothing changes for a resident's event.
- A town event has no hosting record and earns the town no karma. A resident who counts as a guest there gets the day's attending karma, as at any event.

## Consequences

- Adding a town event is a code change and a deploy, reviewed like any change. Staff can't add one from the staff app yet, though they can call one off.
- A town event's faces are fixed by the townsfolk and their handles when it's logged; a later change of handles doesn't change it.
- A resident who booked the Commons first keeps it. A town event that clashes is refused, reported to Sentry once per boot, and tried again each minute until the clash is gone or its time passes.
- Keepsakes for the harvest night's attendees are a follow-up; they would read the attended list `event_ended` leaves.
- Code: `server/src/town-events.ts`, `scheduleTownEvents` in `server/src/world-service.ts`, and `checkScheduleTownEvent` and `attendNeeded` in `sim/src/events.ts`.
