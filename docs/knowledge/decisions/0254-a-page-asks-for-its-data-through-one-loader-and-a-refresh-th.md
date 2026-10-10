---
title: A page asks for its data through one loader, and a refresh that fails leaves the page as it is
date: 2026-10-10
status: accepted
tags: [client, design]
---

# A page asks for its data through one loader, and a refresh that fails leaves the page as it is

## Context

Sixteen pages each wrote the same lifecycle by hand: a `destroyed` flag, an `async load()` that awaits a request, checks the flag, puts an error card with Try again in a region, and paints. Each also used `load` as its refresh, after an action and on a timer.

That second use had two faults. A refresh that failed replaced a page that was showing fine with "That didn't load": a game table mid-round on one dropped request, the shop right after a buy that worked. And nothing kept two asks apart, so a slow answer could draw over a newer one.

Around the lifecycle, the same pieces were copied: the block that picks which of two requests failed and whether it was a 404 (the collection book and the people lists), the shop's and the market's load with your things beside it, the card for someone with no character (four pages, with two button styles), and the "isn't open yet" card (five pages).

## Decision

`pageData` in `packages/client/src/page-data.ts` owns the lifecycle. A page gives it `ask` (one promise of a `Result`), `paint`, and `fail`, and gets back `ready`, `refresh`, `gone`, and `leave`. It has no DOM in it, so its rules are tested directly:

- An answer for a page that was left is dropped.
- Until something is drawn, a failed ask goes to `fail` with a retry. Once something is drawn, a failed refresh is ignored, unless the answer is a 404: then the thing is gone and the page says so.
- One ask at a time. An ask made while another is out goes right after it and resolves once its own answer is drawn, so the refresh after an action never settles on an answer from before it.

`both` joins two answers a page needs together and gives the first failure. `withOptional` joins an answer with one the page can do without. `failed` is a failure in the page's own words.

The cards are in `view.ts`: `failInto(region, missing?)` makes the `fail` that most pages want, `joinCard` is the card for someone with no character, `notOpenCard` the one for a part of the world that isn't open here, and `staticView` a page with nothing to load. `errorCard`'s button is busy while a retry that returns its promise runs.

Considered: caching answers or sharing requests in `api.ts`. The only repeat found in one page's load is your own profile, asked for once as the page and once as you, and a cache needs a rule for when each answer goes stale. Not worth it yet.

Considered: cancelling requests with `AbortController` when a page is left. The answers are small and dropping them costs nothing a person sees; threading a signal through every `api` call is a larger change for no visible gain.

## Consequences

- The feed, the profile, and the Town Hall keep their own loads. The feed waits for several pieces before its first paint ([decision 0243](0243-the-home-wall-s-first-paint-waits-for-its-pieces-behind-one-.md)), the profile fills its sidebar from late requests, and the Town Hall's refresh redraws only what changed. Each already tells a first load from a refresh.
- A page that was left stops through `loader.gone()`, so a view has no `destroyed` flag of its own unless it has other work to stop.
- A refresh that fails says nothing. The page shows the last answer until the next one works, so an action has to say how it went itself: `actFromButton` toasts, and Come home now says "You're home."
- Try again leaves the error card up with its button busy until the answer comes. The claim, invite, and post pages and the letter thread drew a placeholder in its place before, and the letters list cleared it ([decision 0251](0251-a-page-loads-behind-placeholders-in-its-own-layout-and-shows.md) listed the first two).
- `refresh` must not be called from `paint` or `fail`: each answer would ask again.
- The letters page's card for someone with no character now has the same button as the others, full size with an arrow.
- A game table that's gone said "GET /games has the tables now." It says "The games page has the tables now.", and the page stops asking about it.
- `packages/client/src/shared-components.test.ts` fails on a hand-built `staticView` or "Check back soon." card.
