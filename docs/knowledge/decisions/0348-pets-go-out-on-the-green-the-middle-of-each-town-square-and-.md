---
title: Pets go out on the green, the middle of each town square, and a meeting earns 2 Hosting points
date: 2026-10-22
status: accepted
tags: [pets, levels, commons, lands]
---

# Pets go out on the green, the middle of each town square, and a meeting earns 2 Hosting points

## Context

Pets stayed at home ([RFC 0019](../../rfcs/0019-pets.md)), and Ryan asked for a shared place on the Commons to take them out, with something for the owner and limits that hold up on new lands. The Commons already holds the Town Hall, the shop, four game tables, and whatever Town Hall builds put there, and no resident's block or plot may move. Where a pet stands is drawing only ([decision 0089](0089-pets-live-on-the-resident-in-the-sim-where-they-are-is-drawi.md)).

## Decision

The green is the ground floor within `config.reach` of the middle of each town square (`parkTile`), checked with RFC 0042's `notAtDoor`, so it is worked out rather than built and every land's square has one. `walk_pet` takes a pet out once a UTC day and meets the pets out today whose owners are online on the same green. The first meeting of a pet's day with a pet from another household, neither of them a townsfolk's, earns its owner `PROGRESS.petMeet` (2) Hosting points, on both sides; a walk makes the pet happy until midnight UTC. No coins, no karma, and no cap on pets out at once ([RFC 0045](../../rfcs/0045-the-green-where-pets-go-out.md)).

## Consequences

- Nothing on the map moved and no log replays differently: the pet's `walkedDay` and `metDay` are absent until a walk sets them, and `src/fixtures/pet-park-log.ts` pins a log with walks and meetings.
- The points sit inside Hosting's daily cap of 20, so a resident who plays Hosting in earnest earns no faster, and one who only walks a pet reaches Hosting 5 in 100 days. `scripts/economy-sim.ts` was rerun; it plays no pets, so the walk adds nothing to its month, and the cap above is the check for the points.
- The sim can't see blocks, so a meeting across a block counts. Nothing reaches the other owner but the public `pet_walked`, which names ids of residents standing on the same square.
- Ryan's open questions are in the RFC: a notice for a meeting, blocks stopping one, townsfolk walking their pets, and drawing the green.
- Code: `packages/sim/src/pets.ts` (`checkWalkPet`, `notAtTheGreen`, `onGreen`), `parkTile` in `world.ts`, `nearestPark` in `doors.ts`, `petMeetEarns` in `levels.ts`, and `PetMotion` and `walkLine` in `packages/client/src/pets.ts`.
