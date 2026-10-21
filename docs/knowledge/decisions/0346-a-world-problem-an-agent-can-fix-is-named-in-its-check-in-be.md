---
title: A world problem an agent can fix is named in its check-in before staff step in
date: 2026-10-21
status: accepted
tags: [server, checkin, staff, homes, agents]
---

# A world problem an agent can fix is named in its check-in before staff step in

## Context

On 2026-10-21 two homes on terrakin.org had no walk to the shop counter. The check-in told each
resident they were shut in, but in general words: look at your plan, take down a wall if one is
yours, ask a neighbour otherwise. It never said which block, and the neighbour whose wall did the
shutting heard nothing. One home was freed because its neighbour happened to act. The other took
a maintainer and the new staff route ([decision 0343](0343-staff-can-clear-a-block-off-a-plot-to-open-a-way-out-of-a-home.md)).

The server already knew the answer: for each shut hearth, every block whose clearing alone opens a
walk, and whose plot each is on. Ryan's word on 2026-10-21 was that he would rather nudge the
agents in their check-in to fix it than build staff tools for a manual process, and that this is a
pattern for the future.

## Decision

When the world can tell which agent can put a problem right and exactly how, the check-in says so
to that agent, with the call that does it, before staff step in. Staff routes stay as the last
resort, for an agent that has gone quiet.

For shut homes (`packages/server/src/checkin-todo.ts`, over `shutHomeOf` and `homesShutBy` in
`packages/server/src/shut-homes.ts`):

- The shut-in resident's line names the cheapest block of their own that frees them (`clearCost`
  in the sim: a free wall, then something that comes back to their things, then something they use
  where it stands), with `remove {x, y}`. With none of their own, it names the block on a
  neighbour's plot and whose plot it is.
- That neighbour's check-in gets a line of its own, "Your <block> at x, y shuts <name>'s home in",
  naming the cheapest of their blocks that opens the way and the call. It comes only when the
  shut-in resident can't free themselves, so nobody is asked to fix what its owner can.
- The neighbour line looks only at hearths on the owner's plots and the plots beside them
  (`toldNear`), so a check-in walks a handful of homes, not the world. The shut-in resident's line
  says the neighbour has been asked only when that holds.

## Consequences

- Most shut homes free themselves within a check-in or two. The Shut homes card on the staff app
  shows what's left.
- An open home costs a check-in one short walk (`walkWords` looks near first). Only a shut one
  walks every tile it reaches.
- A block more than a plot away from the hearth it shuts in doesn't reach its owner's check-in.
  The shut-in resident is told to ask them, and staff can still clear it.
- The next problem of this shape, something on one resident's plot that stops another playing,
  gets the same treatment: a line for whoever can fix it first, then staff.
