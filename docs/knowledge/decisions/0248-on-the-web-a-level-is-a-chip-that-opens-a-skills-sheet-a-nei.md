---
title: On the web a level is a chip that opens a skills sheet, a neighbor's bar counts levels, earned wear sits in its slot, and a level-up toasts with no button
date: 2026-10-10
status: accepted
tags: [client, ui, levels, e2e]
---

# On the web a level is a chip that opens a skills sheet, a neighbor's bar counts levels, earned wear sits in its slot, and a level-up toasts with no button

## Context

[RFC 0029](../../rfcs/0029-levels-and-skills.md)'s PR 5 puts levels on the web. Its section 9 sketches the pieces: a chip on the profile, a sheet with a row a skill, "+2 Growing" over your figure, a level-up toast with a Wear it button, and earned wear under "Earned" in the look editor. Its decisions 4 to 6 add a sparkle neighbors see, no ranked list, and titles on profiles only. Building it raised questions the RFC doesn't answer:

- A profile's `level` has levels and no points, since points are private. What does a bar on someone else's sheet show?
- The world's toast is one line of text, and the look editor is opened from a profile. Where does a Wear it button go?
- The look editor has a row of chips per slot, and one garment per slot. Does earned wear get a section of its own?
- The socket's `level_reached` is public and carries no unlocks, and the `progress` that says what a level unlocked is private and arrives after it.
- The RFC says that under reduced motion the points show "in the chip instead", but the chip is on the profile, not in the world.

## Decision

- The chip is the first of a profile's fact chips, a button reading "Level 8 · Gardener". It shows only when the profile has `level`, so a world without levels has no chip. Its metal at level 10, 25, and 50 is CSS on `data-tone`.
- The skills sheet's rows are `itemRow`s with a `progressBar`. Your own row fills from the points its level started at to the points the next one starts at, from `GET /v1/progress`, and says the points left, today's count against the cap, and the next thing the skill unlocks. Someone else's row counts levels: from the last thing the skill unlocked (or level 1) to the next, by the sim's `skillUnlocks`, and full once nothing is left. No row ever shows a neighbor's points.
- Each row's picture is the garment its skill brings, faint until that skill reaches it. Your own sheet ends with the titles you may show, as chips that send `profile` with `title`, and the earned wear that's yours with a Dress up button that opens the look editor in the sheet's place.
- A level-up in the world toasts "You reached Making 2 and level 2." and what it unlocked, with no button. The way to put a garment on is the sheet's Dress up, and the level notice links to your profile.
- The toast's words come from the protocol's `levelUps`, which the server's notice uses too. The world waits 250 ms after your `level_reached` so the same input's `progress` is in, and matches the two by `seq`.
- Anyone's `level_reached` shows the `laugh` feeling with a hop on their figure, whose sign is the sparkle. Everyone with that figure on screen sees it, in the map and in 3D. Reduced motion keeps the sparkle and drops the hop.
- "+2 Growing" is one static element, `#world-gain`, placed over your figure each frame, clear of the name tag and the sign. It rises and fades for 1.8 seconds. Under reduced motion it shows where it is, then goes.
- Earned wear sits in its own slot's row in the look editor, where a hat or a top is looked for. It is listed only once `GET /v1/progress` says levels are open. One you haven't reached is a dashed chip that reads its skill and level ("Growing 5") in place of a price and takes no tap.
- The e2e steps join `recipes.spec.ts`, which already borrows a clock spec's server for a one-time switch. Its test about the resident from before recipes opened runs last and opens levels at its end, so nothing else in the spec meets them.

## Consequences

- A neighbor's bar and your own bar mean different things: levels toward the next unlock, and points toward the next level. Each has its own line under it and its own label for screen readers.
- The toast has no Wear it button, which is one tap further than the RFC's sketch: open your profile, the chip, Dress up.
- A level-up that comes with other news from the same action joins it on one toast line, as coins and the pantry do.
- A level reached while you're away from the world shows no toast later. The notification and the check-in say it.
- No list of residents by level exists anywhere on the web, and titles show on profiles only.
- Code: `packages/client/src/levels.ts` (words, bars, and what the look editor shows, pure), `level-sheet.ts`, `world-levels.ts`, `levelReaction` in `feelings.ts`, `levelChip` in `profile-view.ts`, `wearChoices` in `look-editor.ts`, `levelUps` in `packages/protocol/src/levels.ts`, and the steps at the end of `e2e/recipes.spec.ts`.
