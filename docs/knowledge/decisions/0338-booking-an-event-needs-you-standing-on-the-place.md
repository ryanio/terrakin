---
title: Booking an event needs you standing on the place
date: 2026-10-20
status: accepted
tags: [world, sim, events, agents]
---

# Booking an event needs you standing on the place

## Context

[RFC 0042](../../rfcs/0042-actions-that-need-you-there.md) moves a chosen few remote actions onto
the map, one at a time, each behind its own logged switch. Shopping went first
([decision 0323](0323-shopping-needs-you-at-the-counter-behind-a-logged-switch.md)), then filing a
proposal ([decision 0325](0325-filing-a-proposal-needs-you-at-the-town-hall-voting-stays-re.md)).
The third action on the RFC's list is `schedule_event`: standing on the place you are booking. Its
wording leaves nothing open: you already have to own or share the place, or book the Commons, so
requiring you to be there costs a walk and makes a booked place one you have seen.

This one differs from the first two in shape. The shop and the hall each have one door to stand
near, so their check is `notAtDoor` in
[`packages/sim/src/doors.ts`](../../../packages/sim/src/doors.ts), within `config.reach` of a
point. A booking's place is a whole plot, a different one each time, and the RFC says standing on
it, not near it. A circle night's place is the circle's hall, which is a member's plot, so the
same rule covers it with no case of its own.

## Decision

**Booking an event needs you standing on the plot it names, on the ground floor**, behind the
logged switch `schedule_in_person`, like the two before it. `notAtThePlace` in
[`packages/sim/src/events.ts`](../../../packages/sim/src/events.ts) is the check: on one of the
plot's tiles and not upstairs, or it refuses `out_of_reach` with the walk to the plot's nearest
tile, around whatever is in the way, and both answers in one for someone upstairs and far off.
`checkScheduleEvent` asks it after eligibility and the bounds check, before who may host there,
the limits, and the calendar: being there is a precondition, like being eligible.

Three choices inside that are worth writing down.

**The flag is top level, not on the events state.** `state.events` is created lazily by the first
event, the trap decision 0325 recorded for the Town Hall: a switch gated on it would never become
due in a world where nobody had booked yet. The server logs `schedule_in_person` as soon as the
adapter turns it on, before any event exists.

**The town's own events are untouched.** `schedule_town_event` has no caller to stand anywhere:
the town has no body. Its calendar, the Sunday gathering included, books as it always did.

**Joining and attending never moved.** `join_event` still brings a guest from wherever they are,
in one step, which is what makes an event something a neighbor can decide to go to on the spot.
Only the host makes the trip, once, when they book.

## Consequences

What this makes easy: a booked place is one the host has stood in, and a host who means to book
the Commons walks into the square where their guests will gather. The refusal is the whole
instruction: an agent reads it, sends the `move` calls it names, and books again, which the sim
and server tests both do rather than asserting a fixed path.

What it costs: one more walk, for the host only, and a booking made from a link check-in far from
home now needs the trip first. The check-in's first-event line says so in worlds where the switch
is on, so the suggestion never sends a host somewhere the booking would refuse.

What did not change: the web's schedule sheet already shows a refusal in the sheet's own words, so
no client change was needed; the journey test walks Fern home from the Town Hall before her
booking goes through. `pick_recipe` at a station is the RFC's one remaining action, and it is not
this one's shape: the shop's Recipes shelf offers free picks in the client on purpose, so where a
pick needs you standing is a question to settle when it is built, not assumed here.

Code: [`packages/sim/src/events.ts`](../../../packages/sim/src/events.ts) (`checkScheduleInPerson`,
`notAtThePlace`), [`packages/sim/src/types.ts`](../../../packages/sim/src/types.ts) (the switch,
its state, and `schedule_in_person_set`), [`packages/server/src/world-service.ts`](../../../packages/server/src/world-service.ts)
(the option and its day switch), and the snapshot's `scheduleInPerson` in
[`packages/protocol/src/schemas.ts`](../../../packages/protocol/src/schemas.ts).
Tests: booking in person in the sim's `events.test.ts` and the server's `events.test.ts`, and the
host step of `e2e/town.spec.ts`.
