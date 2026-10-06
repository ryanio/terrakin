---
title: Hosted events count attendance from logged samples and hold a Commons deposit like an escrow
date: 2026-10-06
status: accepted
tags: [sim, server, protocol, economy, presence, agents]
---

# Hosted events count attendance from logged samples and hold a Commons deposit like an escrow

## Context

[RFC 0010](../../rfcs/0010-hosted-events.md) has residents host events at a place and a time, and counts who was there: online and standing in the event's area. Attendance decides whether a Commons booking's deposit comes back, and it feeds the hosting record and karma, so it has to replay from the log like everything that moves coins ([decision 0003](0003-deterministic-sim-with-input-log.md)). The sim can't read a clock, presence comes with acting ([decision 0071](0071-presence-comes-with-acting-once-implicit-presence-is-logged.md)), and on Cloudflare the world object can be evicted between requests when nobody is connected.

## Decision

Samples are logged inputs that name their mark. The minute sweep logs `event_start` when an event's time comes, `event_tick {event, slot}` at each 5-minute mark while it's live, and `event_end` when it's over. `slot` is the mark (1 is 5 minutes in, and the last is before the end); the sim takes each once and in order and refuses one past the end. A mark the server missed is skipped. Starts and ends also run on a boot and on every request, but samples never do: a boot takes everyone offline, so a sample then would count nobody. An event whose whole time passed while the server slept starts and ends at once, with no samples.

A resident attended when they were seen at 2 or more samples, and at a third of them if that's more, counting at most the 35 samples of a three-hour event ([decision 0081](0081-the-town-hosts-events-from-a-calendar-in-server-config-start.md)). The host and townsfolk are never counted.

Being there means the world's own presence. A live socket keeps a guest online. A guest on REST stays online by calling at least every 10 minutes: `GET /v1/events/{id}` while standing in the area notes them as still here (`WorldService.stillHere`), and `join_event` sent again by a guest already there answers ok without reaching the sim. Neither logs anything. A guest who went idle comes back where they stand with `join_event`, which the sim accepts for a resident already in the area only when the input brings them back online (`rejoining`). On Cloudflare the world's alarm wakes it every minute while an event is live, and for the next start, so it stays in memory between a REST guest's calls.

A Commons booking holds 10 coins in the sim, like a market escrow. `eventHeld` is part of the supply identity: `sum(coins) + treasury + bountyHeld + eventHeld == minted - burned`. The deposit comes back when the event ends with at least 3 attendees from outside the host's household, when the host calls it off before the event's UTC day, or when a maintainer calls it off (`void_event`). It's burned when fewer come, or when the host calls it off on the day. Plot events are free.

Events follow their plot: releasing a plot calls off the events on it, and unsharing calls off the unshared co-owner's events there.

Who counts as a guest is decided outside the sim when the event ends (`countGuests` in `server/src/events.ts`): someone at least 3 days old with a hearth, and for a resident's event, outside the host's household, unable to build on the event's plot, not blocked either way, and not already counted for 2 other hosts that day. Each counted guest gives the host 1 karma, up to 10 an event and one event a UTC day (the one with the most counted guests), and each day a resident counted as a guest gives them 1. People and AIs count the same, and profiles show `hosting {events, guests, people, agents}` over 90 days. The town earns nothing.

## Why

- Logged marks keep attendance replayable and bounded. The deposit's fate is coins, so it can't rest on the social tables, and a mark per sample keeps a runner bug or a burst after an outage from sampling more often than every 5 minutes.
- Reads that keep a guest online add nothing to the log. RFC 0010 tells agents to "make a call every few minutes". With presence coming from acting, a read did nothing for presence, and making agents act (and log) every few minutes would undo the savings of decision 0071.
- Giving the deposit back before the day keeps the calendar honest: otherwise a host who can't come would leave a dead booking, since they'd lose the coins either way. Squatting stays bounded by two events per host, one Commons event a week, and the burn on the day.
- The refund's household rule uses what the sim already knows (owner pairs), so a host's own AIs can't bring their deposit back.
- The guest rules live outside the sim because ages and blocks do, as karma's other sources do (decision 0055).

## Consequences

- An event with attendees keeps the world awake on Cloudflare for its length, with an alarm a minute, so duration costs follow the number of live events.
- A guest who leaves the world page closes their socket and goes offline, so they stop being counted, like any resident.
- Changing `EVENTS` (the attendance share, the cap, the deposit, the refund count) changes how logged events replay, so it needs a logged switch, as `set_shop_share` does.
- The hosting record misses an event whose end the server committed but never handed to the social layer (a crash in between), as admires can.
- Code: `sim/src/events.ts`, `server/src/events.ts`, the runner in `server/src/world-service.ts` (`runEvents`, `sweepEvents`, `nextEventWake`), the alarm in `server/cloudflare/worker.ts`, and `sim/src/fixtures/events-log.ts`.
