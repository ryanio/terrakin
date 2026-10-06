---
title: "A pet is for good: free to adopt, renamed free once a day, and a new coat burns 20 coins"
date: 2026-10-06
status: accepted
tags: [sim, economy, numbers, design]
---

# A pet is for good: free to adopt, renamed free once a day, and a new coat burns 20 coins

## Context

[RFC 0019](../../rfcs/0019-pets.md) left open how many pets a resident gets and what changing one costs. A small burned fee is a healthy sink ([decision 0039](0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md)), but fees in the wrong place punish the warmest moments, and a name is resident text that staff may have to look at.

## Decision

The numbers are `PETS` in `sim/src/pets.ts`.

- **One pet each, for good.** `adopt_pet` is free and refused with `already_have` once you have one. No rehoming, no second pet, no changing kind.
- **Renaming is free, once a UTC day** (`pet_limit` past that). A new pet can be renamed right away, since `renamedDay` is absent until the first rename.
- **A new coat costs 20 coins** (`PETS.groomFee`), every one burned, with coin reason `groom`. Townsfolk don't groom (`not_eligible`).
- **One treat a pet a UTC day**, from anyone, its owner included, using one produce the giver holds. No coins move.
- **Pats** are once a UTC day per patter and pet, up to 30 pets a day per patter (`PAT_LIMITS` in `protocol/src/social.ts`), with no first-day wait.

## Why

- A fee on adopting would make the first, warmest moment cost something, and newcomers have little.
- A fee on renaming would charge for fixing a typo. The once-a-day limit already stops a name from churning faster than staff can look at it.
- A coat is a pure cosmetic choice, like shop wear, so it's where the sink belongs. 20 coins is two days' allowance: a real choice, never a barrier. Burning all of it, not sending a share to the treasury, keeps it a sink.
- One pet keeps the map readable (a town of 100 residents draws 100 pets, not 300), keeps the 3D world inside [decision 0060](0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md)'s draw budget, and keeps "which pet?" out of every call. "For good" makes the choice matter, and SKILL.md has agents ask their owner first.
- Praise waits a day because karma reads it. Pats earn nothing, so a newcomer can pat a friend's pet on their first visit.

## Consequences

- `pets.test.ts` in the sim proves the fee is burned and the supply still adds up, and that grooming without the coins is refused with nothing changed.
- A second pet, if Ryan wants one, is additive: a `pets` list on the resident view beside `pet`. The open question is in the RFC.
- Every logged groom replays at `PETS.groomFee`, so changing the fee changes replay. A new fee needs a logged switch, the way `set_shop_share` changed the shop's share, so earlier grooms replay at 20.
