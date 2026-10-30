---
title: Attendance counts at 10 minutes, behind the attend_at_ten switch
date: 2026-10-30
status: accepted
tags: [sim, server, protocol, events, agents]
---

# Attendance counts at 10 minutes, behind the attend_at_ten switch

## Context

The how-to-play page has always promised attendance at "about a third, at least 10 minutes", and [RFC 0010](../../rfcs/0010-hosted-events.md) set the rule as 2 samples or a third of them if that is more ([decision 0080](0080-hosted-events-count-attendance-from-logged-samples-and-hold-.md)). The third is what a resident meets in practice: an hour's gathering samples 11 times and asks for 4, about 20 minutes. The 2026-10-25 playtest read (issue #115's gathering) showed what that does to a normal visit: two residents each stayed about 10 minutes in the area and neither counted, and the same shape repeated at the first gathering and at Fool's Halloween warm-up on 2026-10-29, where the host was the only counted name. Agent residents are doubly unlikely to reach a continuous third: a routine of their own can pull them home mid-gathering. With Circle night on 2026-10-30 counting as gathered only when 3 members from 2 households attend, a member who shows up in good faith could again not register.

Ryan picked option A on 2026-10-29 (issue #126): count a resident as attended at 10+ minutes in the event area, matching the documented floor literally, and show attendance progress while an event is live if that is cheap. Options B (3+ ticks plus an interaction) and C (keep the third and fix the docs to say so) were not picked.

[Decision 0080](0080-hosted-events-count-attendance-from-logged-samples-and-hold-.md) already settled how such a change may land: changing `EVENTS` numbers changes how logged events replay, so it needs a logged switch, as `set_shop_share` does.

## Decision

From the moment the server logs `attend_at_ten`, an event counts a resident as attended once they have been seen at 2 samples, 10 minutes in its area, however long the event runs. Before it, the old rule stands (2, or a third of the samples taken, capped at 35), so events that ended before it replay as they settled.

- `attend_at_ten` is a one-time switch from the town. It sets the top-level `attendAtTen` flag (top level, like `scheduleInPerson`, so it can land before a young world's first event) and emits a public `attendance_at_ten_set`. `attendNeeded(ticks, atTen)` in `packages/sim/src/events.ts` is the one reader, and `attendedOf` and the circle night's count at `event_end` both read it, so a circle night's gathered week uses the same bar as its guest list.
- The server logs it with `attendAtTen: true`, which is in `WORLD_SWITCHES`, so terrakin.org, self-hosted, dev, and e2e worlds all take it on the next sweep after deploy. A world that never turns it on keeps the old rule and shows nothing new.
- Progress is a view, not a rule: while an event is live, `GET /v1/events` and `GET /v1/events/{id}` carry the viewer's own `attendance` (`seen`, `needed` by the end, `counted`), read from the event's samples and `attendNeeded` over its planned length, the same number the tea view's `stay` already showed a host. Nobody else's progress is shown, and the host gets none (they never count as a guest). The web's event card turns it into words ("stay about 5 more minutes", "you count as attended").
- The how-to-play page now says what the code does: stay at least 10 minutes, however long it runs.

## Consequences

- A genuine drop-in counts, which is the point: Friday's Circle night and Saturday's Harvest night are judged under the bar the docs promised. A drive-by (one sample, under 10 minutes) still does not count, and the anti-farming guards are untouched: one count per resident per event, and who counts for a host's record still goes through the hosting record's age, household, and daily rules, so 10 minutes of presence alone earns nobody points.
- Long town events get easier to attend, deliberately: Harvest night's 9 hours asked for an hour under the cap; now it asks for 10 minutes, like everything else.
- `src/fixtures/attendance-log.ts` pins a log on both sides of the switch (a guest seen at 2 of 11 samples attends only after it), and the events fixture's hash is unchanged.
- The bar can move again only behind another switch, or with an RFC and a `REPLAY_VERSION` bump.
