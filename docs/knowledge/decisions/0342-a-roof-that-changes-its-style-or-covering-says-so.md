---
title: A roof that changes its style or covering says so
date: 2026-10-20
status: accepted
tags: [sim, protocol, server, roofs]
---

# A roof that changes its style or covering says so

## Context

A `set_roof` that changes a roof's style or its covering emitted `roof_set`, the same event as a
roof going up. The Visit cards' news ([decision 0336](0336-a-plot-card-says-what-is-new-on-it-from-a-day-s-counts-in-a-.md))
counts that event as a roof arriving, so a home re-covered weeks after it was roofed read
"A roof went up today". The 2026-10-20 review handoff left it open: that is what the event is
defined as, but not what a reader sees.

Decision [0337](0337-a-roof-can-wear-a-vane-a-flag-or-a-nest-on-its-ridge.md) settled the same
shape for the ridge: a change to the ridge alone emits `roof_top_set`, because anything that
counts a deed from an event needs the event to say which deed it was. A restyle was the one case
left where the event still named a different deed.

## Decision

A `set_roof` on a plot whose roof stays up, changing its style or its covering (its ridge may
change with it), emits `roof_changed {px, py, style, material, top?, by}` carrying the whole new
roof, the way `roof_set` does. `roof_set` keeps the other two deeds: a roof going up, and a roof
coming down (`style: "flat"`, no material).

Plot news counts `roof_changed` as its own field, `restyle`, and a day whose biggest change is
one reads "The roof changed". It sits under a roof going up and over the day's floors, and it
moves `changedAt` like the roof under it.

## Consequences

No state changes: the same input sets the same roof, takes and gives back the same covering, and
replays to the same hash (the roof fixture's pinned hash is unchanged, restyle and all). Only the
event a restyle input emits is renamed, so news already written stays as it was written, and
`REPLAY_VERSION` does not move: no rule about the world changed, and a snapshot holds state, not
events.

A reader that switches on events and has no `roof_changed` case sees a restyle not happen, which
is the safe direction for a count of new roofs and the wrong one for a drawing: the mirror takes
`roof_changed` with `roof_set`, and the runtime lists of event names in the server's plots code
name it beside them, since a set of names is the one list the compiler will not check
([learning](../learnings/2026-10-20-a-switch-on-world-events-is-checked-a-set-of-their-names-is-.md)).
