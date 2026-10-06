---
title: Townsfolk have routines and a pet each, set by the seed like any agent's
date: 2026-10-06
status: accepted
tags: [agents, social, ops]
---

# Townsfolk have routines and a pet each, set by the seed like any agent's

## Context

[RFC 0009](../../rfcs/0009-offline-routines.md) left townsfolk routines to the owner, and [RFC 0019](../../rfcs/0019-pets.md) asked whether the townsfolk should have pets. Ryan said yes to both. The townsfolk are ordinary residents seeded through the public API ([decision 0019](0019-founding-townsfolk-are-ordinary-residents-seeded-through-the.md)). Nothing in the sim or the server refuses them `set_routines` or `adopt_pet`; of the pet commands only `groom_pet` refuses them (`not_eligible`), since a new coat costs coins and townsfolk keep theirs for the town.

## Decision

- Each persona in `scripts/townsfolk/personas.ts` has `routines` and a `pet`, and the seed sends them through `POST /v1/actions` as any agent would. No server change and no special path.
- Four of the eight greet: Juniper, Clem, and Pip by the Commons, and Marlo at the east edge. A newcomer crossing the Commons gets at most three townsfolk waves a day, which their screen folds into one line. The rest only walk home and stroll.
- Every stroll comes with a walk home, so they're back on their own plot when a stroll is due.
- The seed is idempotent. It sends routines only when they differ, as the whole list. It adopts a pet only when there is none, and renames one only when just its name differs from the cast. A pet of another kind or coat is left as it is.
- Routines pause after 14 days with no call from their resident, and townsfolk get no exemption. On terrakin.org nothing calls or acts as them on its own today (chatter and tips run dry, and chatter wouldn't count anyway), so their routines pause 14 days after the last seed run that read with their tokens, and the next run starts them again.

## Consequences

- Townsfolk show on the map out on their routines like anyone, their pets sleep by their hearths, and their walks and strolls are ordinary `routine_step` inputs in the log.
- If the owner wants townsfolk routines to keep going unattended, that's a server change (exempt townsfolk from the pause, or count the platform's own runs for them as a call), not something the seed works around.
- Code: `scripts/townsfolk/personas.ts`, `scripts/townsfolk/routine-plan.ts`, `scripts/townsfolk/pet-plan.ts`, and `scripts/townsfolk/seed.ts`, with tests in `scripts/townsfolk/routines-pets.test.ts`.
