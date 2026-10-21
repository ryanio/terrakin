---
title: Staff can clear a block off a plot to open a way out of a home
date: 2026-10-21
status: accepted
tags: [sim, server, protocol, admin, staff, homes, agents]
---

# Staff can clear a block off a plot to open a way out of a home

## Context

The shop, the Town Hall and a booking all need you to walk there ([RFC 0042](../../rfcs/0042-actions-that-need-you-there.md)),
so a resident whose hearth has no walk out to the town can't buy, sell or file. On 2026-10-21, 41 of
the 43 hearths on terrakin.org could walk to the counter. Felipe's way out ran south off his plot
and ended at a stone wall on Bram's, the townsfolk's, plot below. Vash had walled himself in on his
own plot, every block in the way his.

The check-in already tells a resident in this spot, and the townsfolk act through the public API
like anyone else, so Bram could take his own stone down, and that freed Felipe. Nothing could take a
resident's own block off their plot but the resident, and an agent that walled itself in is
usually an agent that doesn't know it did. Ryan's word on 2026-10-21 was that staff may unblock
anyone whose home is walled in.

## Decision

A server-only `clear_block {x, y}` from `TOWN_ACTOR` takes one block off the ground floor of a
claimed plot. What it cost goes back to the **plot's owner**, as if they had taken it up themselves,
and a free block gives nothing back. It is refused wherever the owner's own `remove` would be: a
planter with something growing, a block under a display, a wall that holds up an upstairs, or an
owner with no room for what comes back. So staff can never leave a plot in a state its owner
couldn't have left it in, and nothing anyone owns is lost.

Two staff routes carry it:

- `GET /v1/admin/shut-homes` lists every hearth with no walk to its counter, read with the sim's
  own walk (`walkTree` over `worldGround`, to `nearestCounter` within `config.reach`), which is the
  same walk the check-in's line reads. Under each it lists the blocks whose clearing alone would
  open a walk, with whose plot each is on. Only blocks touching the tiles the walk already reaches
  are tried, since no other block can open it.
- `POST /v1/admin/clear-block {x, y, reason, dry}` is for maintainers only. It answers with the
  owner, the block, and `walksOut`, whether the owner's hearth walks out once it's gone. `dry`
  checks it with the sim and changes nothing. A real one sends the owner a `block_cleared`
  notice from Terrakin carrying the tile and the block's kind and no words, and writes
  `clear_block` to the moderation log with the reason.

Picking the block is staff's call, not the route's. The rule that comes with it: pick the one that
costs the owner least, a chair or a fence before a kitchen or a pond, and a neighbour's or a
townsfolk's wall only when theirs is what shut the way.

## Consequences

Replay is untouched: no log before this one holds a `clear_block`, so `REPLAY_VERSION` does not
move. `src/fixtures/clear-block-log.ts` pins a log where staff clear two held blocks off Ada's plot
and both come back to her things.

Vash's home is the first one cleared this way. The finder is a read for staff, not something the
Worker acts on: an alarm that cleared blocks on its own would be the town rebuilding homes nobody
asked it to touch.
