---
title: Levels reach the API behind an option no adapter sets, with earned wear in the wear list, one notice an input, and a make step from the day they open
date: 2026-10-10
status: accepted
tags: [server, protocol, sim, levels, checkin]
---

# Levels reach the API behind an option no adapter sets, with earned wear in the wear list, one notice an input, and a make step from the day they open

## Context

[RFC 0029](../../rfcs/0029-levels-and-skills.md)'s PR 4 puts levels on the API. PRs 1 to 3 left them in the sim, dark. Turning them on at terrakin.org is PR 6, so everything PR 4 adds has to work once `open_levels` is logged and change nothing on the wire before it. The RFC leaves several things open: how the switch gets its one-time credit, how the server decides an event "ended after the switch", what a level-up notification holds, how the new first-visit step (the RFC's decision 8) treats residents who joined earlier, and where the five earned garments live.

## Decision

- `WorldService` takes `levels: true`, a switch in the day table like `recipes`. Neither adapter sets it. A test world opens levels with `POST /v1/test/open-levels`, beside `open-recipes`: test clock only, this machine only, never in the Worker.
- The switch's credit is `CollectionBook.firstsCredit`: for each resident in the world who isn't townsfolk, the kinds in their book that the sim's `firstSkill` counts. The book is a social table, so the world gets it through a hook (`levelFirsts`) that `wireSocial` sets after the book's backfill. Until that hook is set, the switch waits: levels never open without their credit.
- `credit_event` is logged right after an event's own `event_end` has gone out, with the guests the hosting record counted (`EventsSocial.countedGuests`), less anyone the sim would refuse now (no longer in its `attended`, in the host's household, or townsfolk), so one bad guest never loses the others their points. It is logged for every ended event, with an empty list when nobody counted, which marks the event `credited`. An event that ended with no record to read is credited when the next boot wires the record. Beyond that, the boot's catch-up credits only events that ended on a later day than levels opened: an event that ended on the opening day could have ended before the switch, and its day can't say.
- `progress` is private, like `coins` (`isPrivate`). `level_reached`, `levels_opened`, and `title_changed` are public. `event_credited` stays on the server.
- A level-up is one `level_reached` notification per resident per input, from Terrakin itself, holding `levels`: each skill level and the resident's own level that input brought, with what each unlocked. The check-in writes one `todo` line for each unread level that unlocked something. A craft that reaches Making 2 and level 2 is one notice, not two.
- Profiles carry `level` (`{level, skills, title?}`) once levels are open, never points. `GET /v1/progress` is the caller's own and takes no id. Townsfolk have neither.
- The first-visit step is `make` (make something at a workbench). It is a step only in a world where levels are open, and it joins the first visit on the day they opened (`state.progress.opened`), so residents who joined before that day get it as a suggestion (decision 0129) and a world without levels lists no such step.
- The five earned garments are in `WEAR_ITEMS`, just before partner wear. The protocol's wear enum is that list, so a resident wearing one parses everywhere. They take a pattern and a color like any wear. The collection book, the join form's tops, and the look editor leave them out with `isEarnedWear`.

## Consequences

- One first is 12 points and level 2 is 20, so the `make` step alone doesn't reach level 2 on day one. Its line says a second first does (a fishing rod from three more wood), which is the honest version of decision 8's promise.
- Putting the garments in `WEAR_ITEMS` means every table keyed by wear needs them, so their drawings (the 2D figure, the item pictures, and the 3D pieces) land with the API rather than with the web: `packages/ui/src/figure.ts`, `packages/ui/src/item-art.ts`, `packages/client/src/scene3d/wear.ts`.
- SKILL.md, the OpenAPI document, and the changelog describe levels before any world has them. Each says nothing changes until `levelsOpen` is on `GET /v1/world`.
- A link-only resident hears about a level and what it unlocked, can do the `make` step by link, and gets a look link that puts an earned garment on over the rest of what they wear. Showing a title needs the API or the website: no link sends `profile` with `title`.
- PR 6 turns levels on by passing `levels: true` in the Worker. `levels.test.ts` fails when either adapter passes it, so that change is deliberate.
- Code: `packages/protocol/src/levels.ts`, `packages/server/src/levels.ts`, `world-service.ts` (`creditEvent`, `creditEndedEvents`, the `levels` switch), `collection.ts` (`firstsCredit`), `checkin-steps.ts` (`STEPS_ADDED`), `app.ts` (`TEST_OPEN_LEVELS_PATH`), and `packages/server/src/levels.test.ts`.
