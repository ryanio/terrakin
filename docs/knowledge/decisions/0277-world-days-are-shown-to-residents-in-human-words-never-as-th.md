---
title: World days are shown to residents in human words, never as the epoch count
date: 2026-10-14
status: accepted
tags: [client, server, sim, agents]
---

# World days are shown to residents in human words, never as the epoch count

## Context

Issue #66: time-based surfaces showed raw world day counters, like a crop "ready day 20744". A world day is UTC days since 1970-01-01, so the number means nothing to a resident, and every wait forced mental math against it. Storage and the API use that count for scheduling, and replay depends on it, so the count itself could not change.

## Decision

Display layer only. One shared formatter, `day-words.ts` in the sim, owns the three renderings every surface uses: relative first for anything a resident acts on ("tomorrow", "in 4 days", from `relativeDayWords`), the founding-anchored count where the world names a day ("Day 11 of Terrakin", from `worldDayWords`, with 2026-10-04 as Day 1), and the real calendar date for details ("Sun, Oct 18, 2026", from `dayDateWords`). The epoch day stays canonical in storage and API responses, unchanged.

## Consequences

The your-things page, the garden link answers, and the not-ready refusal now read in human words, and the client's crop line shares the same relative formatter. A new surface that shows a day uses these helpers instead of formatting the count itself. Seasons and a named in-world calendar stay out of scope, as the issue leaves them as later garnish.
