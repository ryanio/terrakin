---
title: Pets live on the resident in the sim, where they are is drawing only, and pats are social rows
date: 2026-10-06
status: accepted
tags: [sim, protocol, server, client, social, design]
---

# Pets live on the resident in the sim, where they are is drawing only, and pats are social rows

## Context

[RFC 0019](../../rfcs/0019-pets.md) gives every resident a pet. Three parts of a pet could each live in the sim, in the social tables, or only in the client: what the pet is (kind, coat, name), where it is and what it's doing, and pats from visitors. The sim and its log are where rules and history live and what replays ([decision 0003](0003-deterministic-sim-with-input-log.md)); praise is a social row ([decision 0047](0047-praise-is-once-a-day-per-pair-kept-row-by-row-for-karma-with.md)); facing and motion are drawing only ([decision 0067](0067-facing-and-motion-are-drawing-only-kept-out-of-the-sim-and-the-l.md)).

## Decision

- **What a pet is lives in the sim**, as `pet` on its owner's resident record, absent until `adopt_pet` (`packages/sim/src/pets.ts`). Its name is logged resident text, a new coat burns coins, and a treat uses up produce, so all three must replay. Keeping it on the resident, not in a separate record, puts it in `/v1/world`, `joined` events, and the client's mirror with nothing extra; `joining` in `packages/sim/src/apply.ts` carries it over when someone comes back.
- **Where a pet is, and what it's doing, is drawing only.** Each client works it out from the owner's position and presence, their hearth, the server clock's day and night, and a hash of the owner's id (`packages/client/src/pets.ts`, shared by the map and both 3D views). A pet is never in the sim, never in the log, and never blocks a step.
- **Pats are social rows, like praise**: `pet_pats` (patter, owner, UTC day, time) in `packages/server/src/pets.ts`, once a day per patter and pet, never across a block, and counted as distinct patters on the owner's profile. The owner's `pet_pat` notification groups a day's pats on their pet.
- **The pictures are presentation data in the sim** (`packages/sim/src/pet-art.ts`), like the world's palette, so the map, the sheets, the profile, and the plot photo drawn at the edge share one drawing.

## Consequences

- Old logs replay unchanged: no resident has `pet` until a new input gives them one, and no `REPLAY_VERSION` bump was needed. `packages/sim/src/fixtures/pets-log.ts` pins a log that uses every pet command.
- Pats never grow the log, and the sim never needs to know about blocks to refuse one. Their counts can't be replayed, which is fine: nothing in the world depends on them.
- Two screens can show a pet a tile apart, and a restart can move one. Nobody relies on where a pet stands.
- The sim holds some drawing data now, as it does colors. It's pure data with no rules reading it; change it freely without touching replay.
