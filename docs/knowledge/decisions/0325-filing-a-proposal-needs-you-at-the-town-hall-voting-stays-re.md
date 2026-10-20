---
title: Filing a proposal needs you at the Town Hall, voting stays remote
date: 2026-10-20
status: accepted
tags: [town-hall, world, sim, agents]
---

# Filing a proposal needs you at the Town Hall, voting stays remote

## Context

[RFC 0042](../../rfcs/0042-actions-that-need-you-there.md) moves a chosen few remote actions onto
the map, one at a time behind a logged switch. The shop came first
([decision 0323](0323-shopping-needs-you-at-the-counter-behind-a-logged-switch.md)). The Town Hall
is the other drawn building, and a vote people turn up for is a vote they see each other at.

The risk the RFC raised, and the reason this was Ryan's call rather than ours: a proposal closes on
a clock. Requiring presence to vote means a resident who happens to be away when it closes loses
their say, which is worse than a quiet hall.

## Decision

`propose` needs the actor within `config.reach` of the Town Hall's door, on the ground floor, from
the moment the server logs `propose_in_person`. `vote` is untouched and stays callable from
anywhere. Ryan's call on 2026-10-20, recorded in the RFC: filing has no clock and can ask you to
turn up, voting has one and cannot.

`state.proposeInPerson` is top level rather than on `TownState`, which the first proposal creates
lazily, so a switch gated on `state.town` would never have become due in a world nobody had
proposed in yet. That was caught by the test rather than by reading.

`packages/sim/src/doors.ts` holds `notAtDoor`, the one check behind every action this RFC moves:
the walk around what is in the way, the floor, and both in one answer for someone upstairs and far
off. The shop's own check now delegates to it. RFC 0042 has two more actions planned, so the third
and fourth are a call each.

## Consequences

`GET /v1/town`'s `you.away` is why filing would refuse the caller from where they stand, in the
action's own words, and is never set for voting. The web disables Propose and shows that sentence;
the vote buttons are untouched.

Proposals already in a log replay as they were made, so `REPLAY_VERSION` does not move.

The Town Hall is in the Commons, where nobody owns a plot, so unlike the shop this cannot be
blocked by anyone's walls except the proposer's own home. A resident sealed in cannot file, and the
check-in already names the wall.

What this does not do is make the Commons busy. Filing is rare, a few times a week across the
whole town, so the walk it adds is a small one. The measurement under RFC 0042's open question 4
says the town's own residents cannot fill the square either, since a stroll never leaves its own
plot. If a busy Commons is the goal, the Sunday gathering is the thing that does it.
