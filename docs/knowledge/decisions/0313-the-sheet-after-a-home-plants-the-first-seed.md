---
title: The sheet after a home plants the first seed
date: 2026-10-18
status: superseded
tags: [client, onboarding, ux]
---

# The sheet after a home plants the first seed

Superseded by [decision 0380](0380-a-newcomer-walks-the-town-as-a-guest-first-and-moves-in-with.md): nothing opens after a home, and the next-step chip plants the first seed in one tap.

## Context

Of the 13 people who have ever claimed a plot, 5 have ever had a first thing. The step is a deed done with the pantry, not collecting it ([decision 0312](0312-the-world-s-next-step-chip-keeps-its-place-beside-gather-all.md) has the reading, and why the funnel's `thing` never counts the pantry).

Decision 0312 made the world's next-step chip keep its place beside Gather all, so "Plant a seed" is on screen for everyone rather than half. That still asks a newcomer to notice a small pill at the left edge of the map, seconds after a sheet closed over it, with no reason yet to care about seeds.

The moment before that is better. Building a home sets the hearth, collects the first pantry, and opens the name sheet with a note saying what arrived: 10 seeds of 5 kinds, a bag of sugar, a jar. It is full screen, every newcomer with a new home reads it, and it is the only place where the seeds are the thing being talked about. Its one action was "See your things", a link out of the world to a list.

The planting itself has been one tap since [decision 0269](0269-a-home-leads-straight-to-a-first-seed-planted-in-one-tap-and.md): `home` when you're off your hearth, a planter on the tiles the sim keeps clear inside the hut, then the seed that ripens soonest, each sent over REST and checked like any action.

## Decision

The first pantry's note gets Plant a seed as its first button, beside See your things. It runs the same `sendFirstPlanting` the chip taps, now in `first-plant.ts` beside the pure `planFirstPlanting` that decides where the seed goes, so there is one copy of the sequence and the chip and the sheet can never drift.

The sheet stays open, because the plot still wants a name. The button has one turn: what it did, or how to do it by hand, replaces the note's line and the button leaves. The line is a `role="status"`, so a reader hears it, and focus moves to See your things when the button it was on goes.

Only the first pantry offers it. A later day's pantry brings no seeds, so there would be nothing to plant.

## Consequences

What we expect: nearly every person who builds a home plants a seed in the same minute, and the share of people with a hearth who have a first thing goes from half toward the agents' 83%. Read it on the staff Newcomers page, people only. If decision 0312 and this both land and the number doesn't move, the first session isn't the lever and the next reading belongs after it, not inside it.

While the button is up the sheet shows two filled buttons, Plant a seed in its inset note and Save name below. They read as the note's action and the sheet's, and the second is alone again as soon as the first is used.

The one-tap plan can fail (no room for a planter by the hearth, which a design other than the starter hut could leave), and then the note says to place one from Build. That's the honest fallback, and it costs the rare case a sentence rather than everyone a dead button.

Presentation only. Nothing on the server or the wire changed, so agents see nothing new and there's no changelog entry. Agents already have the same thing in one call, the garden link.

Code: `packages/client/src/home-sheet.ts` (`pantryNews`), `first-plant.ts` (`sendFirstPlanting`, moved out of `world-next-step.ts`), `world.ts`; the step in `e2e/claim.spec.ts`.
