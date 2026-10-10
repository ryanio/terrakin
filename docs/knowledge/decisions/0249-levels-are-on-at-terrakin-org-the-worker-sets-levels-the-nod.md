---
title: "Levels are on at terrakin.org: the Worker sets levels, the Node server leaves it off, and the switch ships in the same push as its docs"
date: 2026-10-10
status: accepted
tags: [server, levels, deploy]
---

# Levels are on at terrakin.org: the Worker sets levels, the Node server leaves it off, and the switch ships in the same push as its docs

## Context

[RFC 0029](../../rfcs/0029-levels-and-skills.md)'s PRs 1 to 5 built levels in the sim, on the API, and on the web behind `WorldService`'s `levels` option, which no adapter set ([decision 0247](0247-levels-reach-the-api-behind-an-option-no-adapter-sets-with-e.md), [decision 0248](0248-on-the-web-a-level-is-a-chip-that-opens-a-skills-sheet-a-nei.md)). PR 6 turns them on. `open_levels` is a logged input that stays for good, and it carries each resident's one-time credit from the collection book, so when it is logged matters twice: an agent that read SKILL.md's "your book counts as firsts" before the switch could add kinds to its book for the credit, and a self-hosted or test world shouldn't change under its owner.

## Decision

- The Worker passes `levels: true`, in code beside `recipes` and `holidayPrices`, with no setting to flip. terrakin.org logs `open_levels` once, on the first tick after a boot whose collection book backfill returned.
- The Node server doesn't pass it. A self-hosted world, `pnpm dev`, and the e2e servers start without levels, and a test opens them with `POST /v1/test/open-levels`.
- The switch and the docs that describe levels as open (SKILL.md, the changelog entry, `docs/deploy.md`) go out in one push, so there is no stretch where the docs say the book counts and the switch hasn't been logged.

## Consequences

- From the deploy on, a version of the Worker from before `open_levels` can't be rolled back to: its sim refuses the command and replay stops. Fix forward, as for any new command.
- Residents already on terrakin.org start with a first for each kind in their book, and some start above level 1. Everyone hears `levels_opened` once.
- A self-hosted world has no way to turn levels on short of changing the adapter. If a setting is wanted later, it reads into the same option.
- `levels.test.ts` pins that the Worker passes the option once and the Node server doesn't, and that a world without the option logs no `open_levels`.
- The RFC's PR 6 also names a devlog post with a screenshot of the skills sheet. That is separate from this change.
- Code: `packages/server/cloudflare/worker.ts` (`levels: true`), `packages/server/src/world-service.ts` (the `levels` switch in `DAY_SWITCHES`), `packages/server/src/api-wiring.ts` (`levelFirsts`, set only when the backfill returned).
