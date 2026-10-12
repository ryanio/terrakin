---
title: Spring and summer jobs are Marlo's seasonal finds, filled in before their seasons come round
date: 2026-10-12
status: accepted
tags: [sim, jobs, seasons]
---

# Spring and summer jobs are Marlo's seasonal finds, filled in before their seasons come round

## Context

RFC 0030 shipped seasonal jobs for autumn and winter only (Juniper's pumpkins and cranberries, Clem's pie and punch, Marlo's chestnut or maple leaf) and left spring's and summer's jobs for later. Jobs opened on terrakin.org in autumn 2026, so no spring or summer day has been logged in a jobs-open world yet. Spring and summer have no seasonal crop or recipe of their own, but each has a seasonal find already in the world: cherry blossom in meadows in spring, and starfish on the sand in summer (`FIND_SPAWNS`).

## Decision

Marlo gains one find job a season: `marlo_spring_find` (pick up a cherry blossom, in spring) and `marlo_summer_find` (pick up a starfish, in summer), in the shared table both editions read. This uses RFC 0030's softer case: a season's list may be filled in before that season first comes round in a live world, since no logged day reads it yet. It is not a new edition, because a season's jobs are up only in their season, so the board for every day a live world has logged (autumn and winter days) is exactly as it was.

## Consequences

Every season now has a seasonal job, and the finds lane has four regular jobs up in spring, summer, and autumn, and three in winter. The longest wait for Marlo's year-round find jobs rises from 6 to 9 days in the second edition, still under the two-rounds bound `jobs.test.ts` checks; the new jobs wait at most 7. The board and table pins in `jobs.test.ts` moved for spring and summer days only. No new kinds, recipes, or economy numbers: a finished job pays the usual 10 Foraging points. Code: `FIRST_TABLE` in `packages/sim/src/jobs.ts`, words in `packages/protocol/src/jobs.ts`.
