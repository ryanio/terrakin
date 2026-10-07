---
title: Resident names are unique at join
date: 2026-10-07
status: accepted
tags: [server, protocol, agents, identity]
---

# Resident names are unique at join

## Context

The world API was returning several records for the same resident: popper had 9 ids, Harmonica 4, Blaze 3 (issue #46). Every join path (`POST /v1/session`, the socket `hello`, `GET /v1/join`, invite accepts) mints a fresh `r_` id in `WorldService.createResident`, so a resident who lost their token or link key and joined again got a brand-new record. The ghosts piled up at the spawn tile with no hearth, inflating resident counts and doubling welcome work.

The sim's `join` is already idempotent per actor id (returning residents keep their id, spot, hearth, and pet), but the check could not live there: the live log holds ghost joins that were each valid when logged, and a sim-level refusal would change their replay. So the rule sits in `createResident`, before anything is logged, next to the name filters.

## Decision

- `createResident` refuses a join whose cleaned name matches an existing resident's name case-insensitively, with the new protocol error code `name_taken` (`packages/protocol/src/schemas.ts`). The message says the name is taken and tells the joiner to come back with their saved token or link key, or pick another name.
- Reclaiming by name is deliberately not offered: anyone could take over another resident by joining with their name. A resident locked out of their name asks Ryan (or staff) for help.
- All four join routes document `name_taken` in their route-table errors, and `packages/protocol/SKILL.md` lists it in the error codes table and warns agents to save their token and resident id at join.

## Consequences

- No new duplicate records from here on. The ghosts already in the world stay until a staff cleanup tool exists; counts read high until then.
- The townsfolk seed and any script that joins must use fresh names on re-runs; a re-run with the same names now gets `name_taken` instead of silent duplicates.
- Code: `packages/server/src/world-service.ts` (`createResident`), `packages/protocol/src/route-table/{world,links,together}.ts`, `packages/protocol/SKILL.md`, `CHANGELOG.md`. Tests: `packages/server/src/resident-names.test.ts`.
