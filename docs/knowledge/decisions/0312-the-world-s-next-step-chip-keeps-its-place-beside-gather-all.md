---
title: The world's next-step chip keeps its place beside Gather all
date: 2026-10-18
status: accepted
tags: [client, onboarding, ux]
---

# The world's next-step chip keeps its place beside Gather all

## Context

The newcomer funnel read on 2026-10-18 ([handoff](../handoffs/2026-10-18-0545-crops-pages-in-editions-spring-and-summer-stock-and-the-funn.md)): all time, 24 people joined, 13 claimed a plot, 10 set a hearth, and 5 ever held a thing. Agents went 28, 27, 24, 20.

That handoff read the last step as the pantry, which comes with standing on your hearth. It isn't. `thingHolders` in `packages/server/src/newcomers.ts` subtracts `STARTER_SEEDS` and `PANTRY_STAPLES` on purpose ([decision 0141](0141-the-newcomer-funnel-counts-first-steps-from-what-the-world-a.md)), and `thing` counts a `plant`, `harvest`, `gather`, `fish`, `craft`, or `make_piece`, or holding a kind the pantry never hands out. So a resident with a hearth has the pantry already, and the step that leaks is the first deed done with it.

Walking the path at 390x844 on a test world, the claim and the home are fine: Claim plot opens the picker, the home sheet builds a design, sets the hearth, and collects the first pantry ([decision 0286](0286-after-a-claim-the-web-offers-the-designs-drawn-on-your-plot-.md)). What a newcomer meets next is the problem.

The world's one prompt is the next-step chip, which after a home says "Plant a seed" and plants one in a tap ([decision 0269](0269-a-home-leads-straight-to-a-first-seed-planted-in-one-tap-and.md)). It gave its slot up to any near-action: `style.css` hid it whenever Gather all, Pat, Fish, or the Town Hall button showed. Gather all shows whenever a branch or a stone lies within reach, which on terrakin.org's snapshot today is true for 17 of the 35 hearths in the world, 5 of the 10 people's. So about half of newcomers stand on their new hearth and see no next step at all, only a button reading "Gather all" that says nothing about being one. The e2e spec had to press Gather all first in a retry loop to get at the chip, which is the same fact written down as a workaround.

The words made it worse. The pantry's two lines, the world's toast and the note on the name sheet, both said to place a planter from Build, the six-tap route from before the chip planted in one tap.

## Decision

The chip stacks in the `.world-near` column like the job chip does, and stays away only where the button for its own step is already on screen: Claim plot while the step is a plot ([decision 0234](0234-a-newcomer-s-world-shows-walking-claim-plot-and-chat-and-the.md)), and Gather all while the step is to gather. The chip writes its step id to `data-step`, so `style.css` hides that one case the moment Gather all comes or goes, with no waiting on the next read.

The pantry's words name the button that is there: "Tap Plant a seed to start a garden." in the world's toast, and "Tap Plant a seed in the world to put one in by your hearth." on the name sheet.

## Consequences

What we expect: the share of people with a hearth who get a first thing goes up from half. That is the number to read on the staff Newcomers page, people only, in the weeks after this. If it doesn't move, the cause is somewhere after the first session, not in what the world says, and the next thing to try is the stronger version, a Plant button in the name sheet itself.

The column is a row taller where Gather all and a step left meet, 44px plus a gap at the left edge, in the slot the job chip already stacks in. No new control is added, so decision 0303's weighing of the chrome against the map is unchanged.

Presentation only. Nothing on the server or the wire changed, so agents see nothing new and there's no changelog entry.

Code: `packages/client/src/world-next-step.ts`, `style.css`, `things.ts`, `home-sheet.ts`; the step in `e2e/first-steps.spec.ts` drops its Gather all workaround and asserts the chip is visible instead, which is what fails if the broad rule comes back.
