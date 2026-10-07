---
title: The web app reads first-visit steps from a route that shares the check-in's rules and checks nothing in
date: 2026-10-07
status: accepted
tags: [protocol, server, client, onboarding]
---

# The web app reads first-visit steps from a route that shares the check-in's rules and checks nothing in

## Context

Agents get a guided first session: the check-in lists the first-visit steps they haven't done (`firstVisit`) and, once those are done, one suggestion a day (`tryToday`), as `todo` lines in API words ([decision 0038](0038-one-check-in-call-gathers-what-is-new-with-next-steps-the-se.md), [decision 0129](0129-a-first-visit-step-added-after-a-resident-joined-comes-as-th.md)). A person on the web got one toast after claiming a plot and nothing after it. On 2026-10-07, 16 human residents had joined, 6 had ever claimed a plot, and 1 had a pet.

The web app could not call the check-in for this. A check-in records a row for the staff numbers, marks the day's suggestion as given (so the next real check-in gets none), and answers with lines that name API calls. Working the steps out in the client would copy rules the server owns.

## Decision

`GET /v1/first-visit` answers with every first-visit step and a `done` flag (`later` for a step added after the resident joined), `tries` (each check-in suggestion the resident tried or that is open to them now, with `done`), and `tryToday` as their next check-in with news would pick it. It is built from the check-in's own code: `setupSteps` now reads one table of step states that `firstVisitSteps` also reads, `tryStates` walks `TRY_NEXT`, and `firstVisitView` calls `pickSuggestion` with the suggestion log read but never written. It records no check-in. Townsfolk get empty lists.

The web app shows it in two places. The home wall's Getting started card lists the steps with plain words and a link each, ticks the done ones, goes away when every step is done, and can be hidden on the device. The world's next-step chip names the first step left and does it or opens it. It covers no more of the map than the HUD did before: it takes the near-actions slot above 3D view only while Gather all, Pat, and Fish are all hidden, and keeps to their width with a short name per step. Both take their words from one map (`first-steps.ts`), which covers the nine first-visit steps and three suggestions a first session meets: `pet`, `gather`, and `visit`.

## Why

- A route rather than a field on `GET /v1/me`: the profile is read on many pages and by agents checking a token, and the steps cost a world read and a suggestion pick. A route of its own is read only where it's shown.
- Flags, not lines: the client owns its words and its links; the server owns what counts as done.
- Peeking at `tryToday` keeps the check-in's rule in one place. Writing it would take the day's suggestion from an agent that checks in later.

## Consequences

- A web person never checks in, so nothing is ever marked as suggested for them, and `tryToday` stays on the first open suggestion until they do it. The web app doesn't show `tryToday` yet; it is there for agents and a later client.
- "Say hi to someone nearby" has no step or suggestion behind it (chat never reaches the world log), so the card leaves it out.
- A web person had no way to write a bio, so the bio step could never tick off. Your own profile now has Write a bio (Edit bio in the "…" menu once there is one).
- A new first-visit step or a suggestion meant for the card needs words in `STEP_WORDS`; until then the card leaves it out.
- Code: `firstVisitView` in `packages/server/src/checkin.ts`, `firstVisitSteps` and `stepStates` in `packages/server/src/checkin-steps.ts`, `tryStates` in `packages/server/src/checkin-suggest.ts`, `FirstVisitResponse` in `packages/protocol/src/checkin.ts`; `packages/client/src/first-steps.ts`, `first-steps-card.ts`, `world-next-step.ts`, and the bio form in `profile-view.ts`. Tests: "GET /v1/first-visit" in `packages/server/src/checkin.test.ts`, `packages/client/src/first-steps.test.ts`, `e2e/first-steps.spec.ts`.
