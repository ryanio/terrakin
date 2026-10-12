---
title: Newcomers plant a first seed, event reminders, and what to measure next
date: 2026-10-12
tags: [onboarding, events, jobs, analytics]
---

# Newcomers plant a first seed, event reminders, and what to measure next

## Done

- A usage pass on the live world (counts only, kept privately) found that people stall after setting a hearth: of 19 people who joined, 10 set a hearth and 3 ever got a first thing (planted, gathered, fished, or crafted). AIs did not stall. Market buying, bounties, events, teaching, and Town Hall proposals had no use; jobs had 2 taken and 1 finished.
- `1ccb1e10`: Getting started leads with plot, home, and a first seed, and the world chip plants one in a tap; once jobs are open the card points to the board ([decision 0269](../decisions/0269-a-home-leads-straight-to-a-first-seed-planted-in-one-tap-and.md)).
- `c8261436`: an `event_started` notice when an event you're going to starts ([decision 0267](../decisions/0267-an-event-you-re-going-to-tells-you-when-it-starts-with-one-n.md)). In-app only, on purpose.
- `ac7c427a`: the check-in's `tryToday` can be `town_event` in the week before a town event, at most every 3 days, until you're going.
- `fdc01f80`, `df917092`: Halloween QA fixes (the November 1 knock suggestion, and the household-door refusal on the web). The rest of Halloween was walked on a test world from October 24 to November 2 and works.
- `#60`: a giver's chatter may say it has a job up or quote the board's words exactly, never restate it ([decision 0266](../decisions/0266-a-giver-s-townsfolk-chatter-can-mention-the-day-s-job-in-the.md)).
- `#61`: Marlo's spring and summer find jobs, with a pin on every board terrakin.org has logged from October 11 to the end of winter ([decision 0268](../decisions/0268-spring-and-summer-jobs-are-marlo-s-seasonal-finds-filled-in-.md)).

## State of things

- All of the above is on main with `pnpm verify` and `pnpm e2e` green.
- The plant chip shares its spot with Gather all and hides while Gather all shows. Gathering is a first thing too, so nobody is stuck.
- The event toast's Go on the home wall was not tapped successfully in a browser test (the toast moved as it was tapped); the same helper works from the On now card. Worth one real tap on a phone.

## Next

1. Around 2026-10-19, read the Newcomers page in the staff app: of people with a hearth, the share with a first thing (3 of 10 before), first jobs taken in a first week, and whether plot names and handles still get set now that they come later.
2. Then decide whether the home wall shows newcomers a job (Ryan chose to measure first).
3. Look into why 37% of townsfolk chatter answers are refused ("answer turned away (target)" is the most common line).
4. Write the Halloween devlog near October 24.

## Open questions

- Whether the market and the unused systems (bounties, events, teaching) need a push or a pause before more systems are added.
