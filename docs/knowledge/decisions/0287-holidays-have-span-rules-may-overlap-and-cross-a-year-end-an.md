---
title: Holidays have span rules, may overlap and cross a year end, and the wire carries holidays as a list
date: 2026-10-15
status: accepted
tags: [sim, protocol, holidays]
---

# Holidays have span rules, may overlap and cross a year end, and the wire carries holidays as a list

## Context

[RFC 0034](../../rfcs/0034-winter-holidays.md) adds Thanksgiving (the fourth Thursday of November), Hanukkah (dates from the Hebrew calendar), and New Year's (December 26 to January 1). The holiday code allowed only fixed dates inside one year and one holiday a day, and `GET /v1/world`, the check-in, and the shop each carried a single `holiday`. Hanukkah runs into Midwinter and past December 31 in some years (2027), and New Year's always overlaps the end of Midwinter.

## Decision

Each holiday in `HOLIDAY_INFO` has a span rule (`HolidaySpan` in `packages/sim/src/holiday.ts`): fixed dates, where a last date earlier in the year than the first is in the next year; the nth weekday of a month with days before and after it; or a table of first dates by year with a length. `spanIn` reads a rule for the year a run starts in, from the day number alone (`weekdayOf` counts from 1970-01-01, a Thursday), so it stays a pure function of `state.day`.

Two holidays may run on one day. `holidayOf` is gone: a rule asks `inHoliday` about its own holiday, and `holidaysOf` lists every one running, the one that started first first. `holidayRun` looks at the runs that start in the day's year and the year before, so a run that crosses December 31 is found from January.

On the wire, `holiday` became `holidays`, a list, on `GET /v1/world` and the check-in, and `shop.holiday` became `shop.holidays`, each with its `id` and `lastDay`, absent on ordinary days. Each shop item still names its one `holiday`. That's the breaking change decision 0146 allows while pre-alpha, with a Changed entry.

## Consequences

- No logged day changes: Halloween and Midwinter keep their dates, and no new holiday ships with this. `jobs.test.ts` pins every board for four years, and the jobs board's `nextEdge` now skips a holiday whose table has no next run.
- A holiday from a table has no run in a year the table lacks. `nextHolidayStart` can then be undefined, and the shop's refusal says "It's back next year". Hanukkah's table needs a test that fails before it runs out (RFC 0034).
- The web draws one holiday's evenings at a time (`eveningHoliday` in `packages/client/src/scene3d/daylight.ts`), and the shop page gives each running holiday its own shelf.
- Code: `packages/sim/src/holiday.ts`, `inWindow` and `holidaysOn` in `packages/sim/src/shop.ts`, `upOn` and `nextEdge` in `packages/sim/src/jobs.ts`, `holidaysField` in the server's world snapshot and check-in, and `shelvesOf` in `packages/client/src/shop-view.ts`.
