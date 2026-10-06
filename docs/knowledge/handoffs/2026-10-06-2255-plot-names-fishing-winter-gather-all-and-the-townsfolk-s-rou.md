---
title: Plot names, fishing, winter, gather all, and the townsfolk's routines and pets
date: 2026-10-06
tags: [process, roadmap, sim, client, server, economy, townsfolk]
---

# Plot names, fishing, winter, gather all, and the townsfolk's routines and pets

Continues [the earlier handoff from today](2026-10-06-1847-seasons-pets-building-events-games-and-more-and-the-move-to-.md). Each item went to main through `pnpm verify` and the full e2e suite.

## Done

- Plot names: an owner or co-owner names a plot (1 to 40 characters, resident text through the edge filters, once a day), asked for right after claiming; it shows on the map, the visit card, /visit, profiles, plot photos and the 3D title, and staff can take one down ([decision 0121](../decisions/0121-a-plot-s-name-lives-on-the-plot-in-the-sim-set-by-its-reside.md)). Walking onto someone's plot now counts as a visit (RFC 0020, decision 0092).
- Fishing ([RFC 0023](../../rfcs/0023-fishing.md)): ponds for 2 stone, a rod from 3 wood, 10 casts a day, 13 fish and a boot by season, time of day and weather, two dishes, and one fish a season the town buys. The server rolls each cast and logs the roll.
- Winter (RFC 0017's winter section, [decision 0124](../decisions/0124-winter-s-numbers-cranberries-hot-cranberry-punch-winter-deco.md)): cranberries and their jam, hot punch, a snowman, string lights, a little fir and a sled from December 1, and a Midwinter week (December 21 to 31) with candy canes.
- Gather all within reach in one call, with a button and a link (decision 0125). Trick-or-treating runs October 31 and November 1 (UTC) and has a link. Town Hall builds keep the four game table spots clear from a logged `keep_table_spots` (decision 0126); the live Commons had no blocks on them.
- The townsfolk have routines and a pet each, set by the seed through the public API and run against the live world by Ryan (world seqs 3355 to 3370). Townsfolk routines never pause ([decision 0113](../decisions/0113-townsfolk-have-routines-and-a-pet-each-set-by-the-seed-like-.md)).

## State of things

- Nothing of this session is in flight. The stranded `emote` worktree belongs to another session and was left alone; emotes stay a plan (RFC 0013 phase 2) until Ryan asks.
- Running a script against terrakin.org (like the townsfolk seed) needs Ryan at the keyboard: the auto mode classifier refuses production reads with credentials.
- Parallel e2e suites on one laptop flake under load (feed reactions, smoke's ECONNRESET, the notice board's "newest 40"). A rerun of the failed spec alone has passed every time; check the load average before calling a branch red.

## Open questions

- Ryan: fishing raised winter's possible town pay to 17 coins a day (autumn is 15 with fish 19). Keep it?
- Ryan: a plot's first name counts toward the once-a-day limit, so a typo waits a day. Keep it?
- Ryan: every resident with a plot now gets the `plot_name` first-visit step, so existing agents' check-ins stop answering `unchanged` until they name their plot. Fine as a launch nudge?
- Each RFC and decision from today lists the calls made at acceptance; any can be overruled.
