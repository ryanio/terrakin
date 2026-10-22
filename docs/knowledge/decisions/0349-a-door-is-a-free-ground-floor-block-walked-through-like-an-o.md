---
title: A door is a free ground-floor block walked through like an open tile, and new starter homes hang one from a logged switch
date: 2026-10-22
status: accepted
tags: [sim, building, walking, homes, replay]
---

# A door is a free ground-floor block walked through like an open tile, and new starter homes hang one from a logged switch

## Context

A doorway was only a gap between walls. On the map and in 3D a gap looks like a missing block, so residents filled it, walled themselves in, and nobody could see the way into anyone's home. Two live homes were shut this way in October 2026 ([decision 0346](0346-a-world-problem-an-agent-can-fix-is-named-in-its-check-in-be.md)).

`packages/sim/src/doors.ts` already uses the word: its doors are the tiles in front of a Town Hall or a shop counter where an action needs you to stand ([RFC 0042](../../rfcs/0042-actions-that-need-you-there.md)). That is a place, not a thing you build, so the block is a second concept with the same everyday name. It lives in `packages/sim/src/front-doors.ts` to keep the two apart.

## Decision

`door` is a block on the end of `BLOCK_KINDS`, free like a wall, ground floor only, and with stairs one of the two blocks `blocksWalkers` lets anyone onto. Every walk reads `blocksWalkers` (`move`, putters, routines, the walk a refusal names, the design notes, and the server's shut-home walk in `packages/server/src/shut-homes.ts`), so a door is open to all of them with no change of their own. It draws as a wall with a door in it, in 2D and 3D, from the sim's `DOOR_LOOK`.

It is free and not a catalog entry. A catalog entry is a thing someone holds, and `remove` hands a held block to whoever takes it up, so a door the starter home places from nothing would be a free source of doors. A cost would also make a door dearer than a gap, the opposite of what it is for. Nothing is sold, so the economy run is unchanged.

From the server's `starter_doors` on (both adapters set `starterDoors`), `build_starter_home` puts a door in the hut's doorway. The designs carry one too (`+` in a map), except the hill house, whose front is open onto its deck. Homes already standing are never changed: the check-in suggests a door for a doorway a home has (`tryToday: "door"`), and its lines for a shut-in home say a door can go where the freeing block stood.

There are no locks. If they come, a lock opens for whoever the plot's owner allows, and a locked door never counts against a plot's way in: a home is as open as its doors are walkable, and anything a lock adds is owner-only.

## Consequences

Replay is unchanged and `REPLAY_VERSION` stays at 2 ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)). No log before this one names a door, so making the new kind walkable moves nothing, and no existing block's walkability changed. The starter home's door is behind the logged switch because `build_starter_home` computes its blocks during replay: without the switch, every logged starter home would replay with a sixteenth block. `packages/sim/src/fixtures/doors-log.ts` pins a log with a home on each side of the switch.

A door holds nothing up (`HOLDING_BLOCKS` leaves it out), so flooring over a doorway leans on the walls beside it, which a starter hut's always has. A roof still covers a door, since a roof covers the box around a home's walls. The Town Hall can't place one in the Commons, and a plot's theme never recolors one. The work "every plot keeps an opening" can count a door as an opening, because a door is walkable wherever `blocksWalkers` is asked.
