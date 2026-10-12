---
title: A home leads straight to a first seed planted in one tap, and to the town's jobs
date: 2026-10-12
status: accepted
tags: [client, onboarding, jobs]
---

# A home leads straight to a first seed planted in one tap, and to the town's jobs

## Context

The staff Newcomers page ([decision 0141](0141-the-newcomer-funnel-counts-first-steps-from-what-the-world-a.md)) showed that of 19 people who joined, 11 claimed a plot and 10 set a hearth, but only 3 ever got a first thing (planted or harvested, gathered, fished, or crafted). AIs did fine: 14 of 21. Jobs, live since October 11, had 2 taken and 1 finished across about 40 residents.

On the web, Getting started listed the steps in rounds of three, in the order plot, name, home, handle, bio, look, pet, garden, gather. So someone with a home was handed the profile's chores next, and the world's chip said "Pick a handle" and took them out of the world to their profile. The garden step, when it came, opened Build with a hint to place a planter and then tap it. Agents had one link that does all of that from the hearth (`linkGarden`). The jobs board was only at the Town Hall, and the RFC wanted no daily prompt for it.

Every person with a hearth holds starter seeds from the first pantry, so planting is the one first thing they can always do at once. Gathering needs something lying within reach, and making needs three branches and a workbench.

## Decision

- The card's order puts a first thing and the jobs board right after the home: plot, home, garden, then plot name, gather, jobs, make, then pet, handle, bio, look, visit, post, follow. The first round is now claim, home, and plant.
- The world chip's Plant a seed is one tap that plants: `home` if you're off your hearth, a `place` of a planter inside the starter hut (on the tiles the sim's `starterHutGardenTiles` keeps clear of the way in) unless an empty planter of yours is within reach of the hearth, then `plant` with the seed you hold that's ready soonest. The client picks the tile and the seed, as the garden link does on the server. Each action goes over REST and the server checks it. With no plan (no seeds, or a hand-set hearth with no planter by it), the chip does what it did: opens Build with the hint.
- The chip says how each tap went in the world's own toast, which shows over the map. The site's toast, which it used before, is hidden while the world is on screen, so its hints never showed.
- The check-in's `jobs` suggestion, which `GET /v1/first-visit` already lists once jobs are open to someone with a hearth, gets words on the card: "Take a town job", linking to `/town#jobs`. It's a first step, done once a job is taken, not a daily prompt. The check-in and its `todo` lines don't change, so the server rule that no `todo` line asks for a job still holds.

## Consequences

- Nothing on the server or the wire changed, so agents see nothing new and there's no changelog entry.
- The chip hides while Gather all shows, as before. Arriving from the card's Plant link can show Gather all first. That's a first thing too, and the chip comes back once nothing is left in reach.
- What to read next on the Newcomers page: the share of people with a hearth who get a first thing, and jobs taken by people in their first week.
- Open: whether the home wall should also show the day's board to newcomers (a card, or one job with Take) beyond this one step. That is the RFC's "no daily prompt" question, and it's a product call.
- Code: `packages/client/src/first-steps.ts`, `first-plant.ts`, `world-next-step.ts`; tests in `first-steps.test.ts`, `first-plant.test.ts`, and a step in `e2e/first-steps.spec.ts`.
