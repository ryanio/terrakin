---
title: Seasons, pets, building, events, games and more, and the move to packages
date: 2026-10-06
tags: [process, roadmap, sim, client, server, economy, agents, deploy]
---

# Seasons, pets, building, events, games and more, and the move to packages

## Done

Ryan asked for the world to be more fun and more customizable. Each item below shipped to main through `pnpm verify` and the full e2e suite, and the riskier ones also through the `reviewer` agent.

- Autumn and seasons ([RFC 0017](../../rfcs/0017-seasons.md)): pumpkins, pumpkin pie and soup, hay bales and scarecrows, seasonal shop stock and town buys, frozen starter seeds and rotation.
- Hair: ten styles and thirteen colors, under hats, in 2D and 3D ([decision 0074](../decisions/0074-hair-is-a-style-and-a-color-on-the-look-drawn-under-hats-in-.md)).
- One catalog of things ([RFC 0018](../../rfcs/0018-one-catalog-of-things.md)): every kind is one entry in a family, jam is a family recipe, `GET /v1/catalog`, pomegranates and pomegranate jam, the jack-o'-lantern.
- Away residents asleep at their hearths, and weather and seasons drawn on the map, in 3D and in plot photos (decisions 0086 and 0073).
- Build with what you gather ([RFC 0016](../../rfcs/0016-build-with-what-you-gather.md)): paths and floors, furniture from the workbench, `build` for a whole plan in one call.
- Offline routines ([RFC 0009](../../rfcs/0009-offline-routines.md)), hosted events with the harvest night ([RFC 0010](../../rfcs/0010-hosted-events.md)), party games ([RFC 0011](../../rfcs/0011-party-games.md)), pets ([RFC 0019](../../rfcs/0019-pets.md)), plots worth visiting ([RFC 0020](../../rfcs/0020-plots-worth-visiting.md)), collections and foraging ([RFC 0021](../../rfcs/0021-collections-and-foraging.md)), holidays with Halloween ([RFC 0022](../../rfcs/0022-holidays.md)).
- Sound made with code, off until the speaker is tapped (decision 0097), and evenings and nights in 3D (decision 0098).
- Town Hall builds lay paths and place decor and furniture in the Commons (decision 0101).
- A playtest by two AI residents following only SKILL.md, then fixes for what it found: plain-word parse errors with `did_you_mean` for every field (decision 0108), guests landing at the door (decision 0103), and links for pets, visits, admiring, making and events (decision 0104).
- The devlog is published at /devlog, in `GET /v1/devlog`, once in the check-in, and on the home wall cut short with Show more (decision 0105). Today's post is `docs/devlog/2026-10-06.md`.
- RFC 0013 phase 2 (emotes) is now a plan to build from. Nothing for emotes was built.
- Every workspace package moved into `packages/` (decision 0111).
- CI had failed on main since 39b9888 because a docs e2e step waited 5 seconds for a page the rest of the spec gives 20. Fixed in 1bee7c7; main has deployed green since.

## State of things

- Dates the world will reach on its own: the harvest night enters the town calendar on October 17 and runs October 31 18:00 UTC to November 1 03:00 UTC. The Halloween shelf opens October 24, and trick-or-treating is October 31 (UTC). Winter starts December 1 and autumn's stock leaves the shop.
- On its first boot after these deploys, the World object logs `open_finds`, so finds start spawning. Old gathers replay as before.
- Sessions with branches from before the move rebase across it in two steps: `git -c merge.directoryRenames=true rebase <the move commit>`, then `git rebase origin/main`, then `pnpm install --frozen-lockfile --offline`. Afterwards `git ls-files -- client server admin sim protocol ui cards` must print nothing.
- Parallel sessions took the same decision number several times today. Check `git ls-tree --name-only origin/main docs/knowledge/decisions/` right before committing one.
- An e2e suite needs ten ports from `TERRAKIN_E2E_PORT`. Give each parallel suite its own range, and never reuse a range while its first owner might still run.
- A push of several commits runs no CI if the head commit's message mentions skip ci anywhere, even in its body.
- The `emote` worktree holds another session's uncommitted emote work. It was left untouched.

## Next

Ready to start when Ryan says go:

1. Plot names: an owner names their plot. It is resident text (filtered, capped, reportable) and shows on the map, the visit cards, plot pages and plot photos, by API and by link.
2. Fishing: ponds you can lay, fish by season and weather that fill a new family in the collection book, and fish to cook.
3. Winter: a crop, recipes and decor for December through February on the seasons machinery.
4. Gather everything within reach in one call.
5. A trick-or-treat link for link-only residents, before October 31.
6. Emotes from RFC 0013 phase 2, when Ryan wants them.

## Open questions

- Ryan: turn on routines and pets for the townsfolk? That means running the townsfolk seed against the live world.
- Ryan: should November 1 (UTC) also count for trick-or-treating, so the US evening of October 31 counts?
- Ryan: a Commons build can place a bench or lamp on a game table's spot. Skip table spots in Commons builds?
- Ryan: pumpkin pie needs no flour (decision 0079), standing on a plot is enough to admire it, and sound plays as ambient on iPhone (silent with the silent switch on). Keep these?
- Each RFC built today lists the calls made at acceptance under its own heading; Ryan may overrule any of them.
