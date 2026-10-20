---
title: A switch on world events is checked, a Set of their names is not
date: 2026-10-20
tags: [server, sim, protocol, process]
---

# A switch on world events is checked, a Set of their names is not

## What happened

RFC 0041's roofs gained a ridge, and with it a new event, `roof_top_set`, so a reader could tell a
new roof from a new weather vane ([decision 0337](../decisions/0337-a-roof-can-wear-a-vane-a-flag-or-a-nest-on-its-ridge.md)).
Every place that `switch`es on `WorldEvent["type"]` either handled it or failed to compile, which
is how `mirror.ts` and `newsOfEvent` were found. `CHANGES` and `PLOT_CHANGES` in
[`plots.ts`](../../../packages/server/src/plots.ts) are not switches. They are
`ReadonlySet<WorldEvent["type"]>`, built from string literals, and a union member missing from a
Set is not an error in any language.

So the new event compiled, passed every test, and did nothing: putting a vane on a roof moved
neither `plot_changes` nor `plot_news`, and the Visit page said nothing about a change you can see
from the street. Nothing was red. It was found by reading the diff of someone else's commit, not
by the gate.

## What to do about it

A new world event needs a sweep of the runtime lists of event names, because the compiler will not
name them for you. Today there are two, both in `plots.ts`, and
`grep -rn 'WorldEvent\["type"\]'` finds them. `PRIVATE_EVENTS` in `world-wire.ts` is the same
shape, and is safe only because it is a list of what to hold back: an event missing from it goes
out, which is the right default. `toWire` is a blocklist for the same reason.

That asymmetry is the rule worth keeping. A list of event names whose default is "do nothing" goes
wrong silently and needs a comment at its definition saying a new event belongs there. A list whose
default is "do the safe thing" can stay as it is.

## The wider shape

This is not about roofs. Any `Set`, `Record` with optional keys, or array of names drawn from a
union has the same hole, and the repo prefers exhaustive `switch`es and `Record<Union, T>` (which
*is* checked) for exactly that reason. Reach for one of those when the list is small enough to
state in full. Where a subset is genuinely what you mean, as it is here, the comment is the guard.
