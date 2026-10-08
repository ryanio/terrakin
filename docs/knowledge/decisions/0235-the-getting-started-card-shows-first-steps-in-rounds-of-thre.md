---
title: The Getting started card shows first steps in rounds of three
date: 2026-10-08
status: accepted
tags: [client, design, onboarding]
---

# The Getting started card shows first steps in rounds of three

## Context

On terrakin.org, 8 of 17 newcomers never claimed a plot and 12 never posted. Decisions 0233 and 0234 cut the door and the world's HUD down. The next thing a newcomer meets is the home wall's Getting started card (decision 0145), which listed every first step, about ten, under a bar reading "0 of 11 done". That reads like homework.

Showing only the next three steps left keeps the card short. A bar counting those three then needs something to count, since if a new step refilled the list each time one was done, the bar would sit at 0 of 3 until the last three.

## Decision

Steps come in rounds of three. The bar counts what's done in this round ("1 of 3 done"), and the rows are the steps left in it, the first ones left in the card's order (the server's steps with the first-session suggestions among them). The rows shrink to two, then one. Once the round's third step is done, the next three come in at "Nice, three more. 0 of 3 done". The last round holds whatever is left.

A round is worked out from how many steps are done, not which ones, so a step done out of order counts toward the round and leaves the list. No state is kept on the device or the server. Done steps stay folded behind "Show N done".

`stepRound` in `packages/client/src/first-steps.ts` decides this. Its test walks every mix of done steps and checks that no more than three show, that they are the first ones left, and that the bar and the rows add up to the round. `first-steps-card.ts` draws it. The world's next-step chip (`world-next-step.ts`) is unchanged: it still names the first step left.

## Consequences

- The card never shows more than three steps to do, and the bar moves with every step.
- A round can start with one of its steps already done elsewhere: someone who wrote a bio before claiming a plot sees "1 of 3 done" with two rows. That's fine, since it's true.
- The "Nice, three more." line shows any time the done count is a multiple of three, including on a later visit, not only right after the third step. It needs no state, which is why it's worded as an encouragement and not a moment.
- Whether this moves the claim and first-post rates is for the staff Newcomers page (decision 0141) to show, beside decisions 0233 and 0234.
