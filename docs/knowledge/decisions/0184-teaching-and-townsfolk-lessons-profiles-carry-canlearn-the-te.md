---
title: Teaching and townsfolk lessons: profiles carry canLearn, the teacher hears the lesson, blocks refuse it, specialties live in the server's lesson plan, and a townsfolk wakes to teach
date: 2026-10-07
status: accepted
tags: [sim, protocol, server, client, agents, townsfolk, items, safety]
---

# Teaching and townsfolk lessons: profiles carry canLearn, the teacher hears the lesson, blocks refuse it, specialties live in the server's lesson plan, and a townsfolk wakes to teach

## Context

[RFC 0024](../../rfcs/0024-recipes-you-learn.md) gives `teach {recipe, to}`, its limits, the refusal codes, `canTeach` on a profile, and a Teach button that shows "when someone within reach doesn't know a recipe you do". It doesn't say how a client learns what a neighbor doesn't know (the mirror carries nobody's recipes), who hears a lesson, how it meets blocks, or which code a few edge cases get.

It also says each townsfolk has a few specialties "in the townsfolk seed", and that the townsfolk run teaches one to a resident standing near that townsfolk, at most once a week per resident, as an ordinary `teach` the sim checks. It doesn't say where the server reads the specialties from, what happens while a townsfolk is away (most of the time: nobody acts as them, so they go idle like anyone), whether a townsfolk's lessons use up its own lesson of the day, or whether the week is the server's rule or the sim's.

## Decision

Teaching:

- A profile with a token carries `canLearn` beside `canTeach`: what you know that they don't, so the web can list what you could teach them. Both are absent without a token, on your own profile, across a block either way, and before recipes are learned. A profile read by handle carries them too.
- A lesson's `recipe_learned` (`how: "taught"`, `from`) goes to its teacher too, on the socket and in the action's answer, so both see it said; nobody else hears it. The learner also gets a `recipe_taught` notification through `notify()`, with its block check and caps, and the check-in names the recipe.
- The server refuses `teach` as `forbidden` across a block either way, like a gift, and to a suspended resident.
- In the sim: teaching yourself is `already_known`, a learner who isn't in the world is `not_joined`, and an unknown id is `unknown_resident`. Whether they know it comes before whether they're near, so nobody walks over for nothing.
- On the web, tapping a resident in the world opens their teach sheet once recipes are learned (with nothing to say either way, the name toast as before), and a kitchen or workbench sheet reads the profiles of up to 4 residents within reach and lists those it could teach. The Teach button is held back, with the reason, when they're out of reach.

Townsfolk lessons:

- The specialties live in `packages/server/src/lesson-plan.ts` (`SPECIALTIES`, by handle), with no imports, like `TIP_NOTES` in `tip-plan.ts`, and `scripts/townsfolk/personas.ts` reads them from there. The server needs them in both runtimes; the seed sends nothing for them.
- Every card is somebody's specialty, 2 or 3 each: Clem teaches lemonade, tomato sauce, and pumpkin pie; Juniper herb sachets and flower wreaths; Bram barrels and wells; Pip signposts and fried minnows; Otis bookshelves and pumpkin soup; Marlo campfires and fish stew; Sable lamp posts and hot cranberry punch; Ansel flower boxes and flower wreaths.
- The lessons run (`townsfolk-lessons.ts`) goes from the minute sweep, after welcome visits. It measures reach from where the townsfolk stands, or would stand coming back, and sends `teach` through `arrive` and `act`, so an away townsfolk wakes to teach the way any command of theirs brings them back. Without that, the rule that both are online would mean townsfolk almost never teach.
- In the sim, a townsfolk's lesson isn't counted against the townsfolk (`items.today.teaching`), only against the learner's lesson of the day, and the week is the sim's own check (`townsfolkTaught`, the world's day, refused as `taught_today`). The sim lets a townsfolk teach any recipe, since townsfolk know them all; only the server's run limits a townsfolk to their specialties. The server also checks the week before sending, with blocks either way and suspensions.
- A townsfolk's profile lists, as `canTeach`, the specialties the viewer doesn't know, not every recipe: those are the only ones they'd teach.
- At most 3 lessons a run. `TERRAKIN_TOWNSFOLK_LESSONS` is `off` by default and `on` in `wrangler.jsonc`, and the run does nothing until recipes are learned. `dry` checks each learner's lesson once a world day, since a check counts as the townsfolk acting and would otherwise keep an online townsfolk from going idle.

## Consequences

- A profile read with a token lets the viewer work out everything the subject knows: the base and holiday recipes, plus `canTeach`, plus what the viewer knows less `canLearn`. Teaching needs both lists, and what someone knows was never meant to be secret; a block either way hides both.
- A station sheet costs up to 4 profile reads when people stand near, once recipes are learned.
- Teaching code: `teachFields` in `packages/server/src/townsfolk-lessons.ts`, `eventsFor` in `packages/server/src/world-wire.ts`, `packages/server/src/world-actions.ts`, `packages/client/src/teach-sheet.ts`, `garden-sheet.ts`, `world.ts`.
- Lessons from townsfolk aren't limited by how many townsfolk there are: each resident gets one a week at most, however many stand near Clem.
- Renaming a townsfolk's handle drops its specialties until `SPECIALTIES` follows. A new townsfolk teaches nothing until it gets a list.
- Lessons code: `packages/server/src/lesson-plan.ts`, `packages/server/src/townsfolk-lessons.ts` (and its tests), `checkTeach` in `packages/sim/src/recipes.ts`.
