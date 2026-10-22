---
title: A public way is tiles of a plot that hold no block, laid by the town and counted as open ground, amending decision 0351
date: 2026-10-22
status: accepted
tags: [sim, server, protocol, walking, homes]
---

# A public way is tiles of a plot that hold no block, laid by the town and counted as open ground, amending decision 0351

## Context

Downtown's 80 slots are fixed, 18 of 53 claimed plots had no way out on 2026-10-22, and the Commons was closed in by claimed slots on every side. [RFC 0046](../../rfcs/0046-streets.md) Option 1 proposed a public way: tiles of a plot that nobody may block, so the town gets a walk nobody can take back with a wall while the plot stays its owner's. Ryan accepted it on 2026-10-22.

## Decision

`state.ways` (absent until the first) holds the way tiles. The server-only `open_way {tiles}` adds tiles and `close_way {tiles}` takes them up, both from `TOWN_ACTOR`, sorted north to south then west to east, at most `WAYS.tilesMax`. `open_way` is refused whole unless every tile is on land, on no town square or street, not a way yet, with no ground-floor block and no hearth, and on no plot for sale (it joins the freeze table of [decision 0344](0344-plots-are-sold-frozen-as-they-stand-downtown-only-behind-ope.md)).

A way holds no block on the ground floor: `place`, `build` and `build_starter_home` refuse one with the new code `public_way`, and a dry run says so. A door and the seats you walk onto would pass walkers, but a door may one day lock and stairs make a stairwell, so a way takes none. Paths, flooring and building upstairs over a way are the owner's, which makes a covered passage.

`openings.ts` counts a step onto a way as open ground, on anyone's plot. That amends decision 0351, whose way out was a step onto ground nobody had claimed. A claim beside a way keeps its neighbors' steps onto it (`claimWaysFrom`), and `scripts/landlocked.ts` reads `ways` off the snapshot.

The snapshot carries `ways` once there are any, and `ways_opened`, `ways_closed` and `home_rebuilt` are public events.

## Consequences

No log before this holds an `open_way`, so every fixture replays as it did and `REPLAY_VERSION` doesn't move. `src/fixtures/ways-log.ts` pins a log that clears a wall, opens a way through it, rebuilds the home with a door, walks out onto the way and takes one tile back up.

A way is a fact about tiles, not plots, so it survives a plot changing hands, a release and a later claim of a free slot it crosses.
