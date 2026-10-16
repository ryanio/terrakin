---
title: A card that sits in both the sidebar and the main column sizes its rows from its own width
date: 2026-10-16
status: accepted
tags: [client, ui]
---

# A card that sits in both the sidebar and the main column sizes its rows from its own width

## Context

The "Say hi to <name>" card on a profile (`togetherCard` in `packages/client/src/profile-view.ts`) laid out its two rows of controls with viewport media queries. A profile is a `.layout`, so the card fills the column on a phone and sits in the 360px sidebar from 1000px ([decision 0191](0191-every-page-is-a-sidebar-layout-a-wide-card-grid-or-a-column.md)). Those are two different widths, and the viewport is a poor stand-in for either: the card is 343px wide on a 375px phone and 360px in the sidebar on a 1200px desktop.

So the rule `@media (min-width: 560px)` put the letter, coins and thing buttons in three columns on every desktop, where the card had only 320px of room for them. Each pill is `white-space: nowrap`, so the words ran past their backgrounds and the three buttons visually merged. Nothing caught it: the e2e suite runs on a phone viewport, where the query never fires.

The gesture row had the mirror of the same problem. It was a grid of equal columns, so the widest label set the width every button had to live in, and "High five" wrapped to two lines at five buttons and at six, taking the whole row to 76px for a 64px tile. Its `@media (max-width: 480px)` shrink-the-labels rule didn't reach the sidebar at all, and wouldn't have been enough there: at six buttons in a 320px card there are 41px for a word that needs 46.

## Decision

`.together` is `container-type: inline-size`, and both rows query the card, not the window.

- The gesture buttons are a wrapping flex row. Each is as wide as its own word and then grows to share what is left, so a label is never crushed and the row stays one line wherever one fits. Under about 420px the labels drop a size; six go three and three; under about 300px they all do, so a last button never stretches alone across the card.
- The send buttons keep two columns with the letter spanning until the card itself is 420px wide, which is the width three of them need.
- The buttons' corners are `--r-md` inside the card's `--r-card`, rather than matching it.

Copy and weight followed from the same pass: the nudge before a streak starts is one short line in the surrounding weight ("No streak yet. Say hi today to start one."), and only a streak that is running turns bold and clay.

Considered: keeping viewport queries and picking numbers that work for both places. The sidebar is narrower than a phone, so the two want opposite answers at the same viewport width. There is no pair of numbers.

Considered: shortening "High five" to fit the grid. It buys this label and breaks on the next one.

## Consequences

- Any card drawn in both a `.layout` sidebar and a main column should query its own width the same way. A viewport query in a sidebar card is a bug waiting for a wide window.
- The card's styles are all in `packages/client/src/profile-view.css` now; the `.gesture` button rules moved out of `style.css`, which is for what the first load can show ([decision 0264](0264-a-lazy-view-s-styles-load-with-its-module-and-the-first-load.md)).
- Buttons in that row no longer share one width, so a long gesture label costs the row width rather than a second line. A seventh gesture would push a phone to two rows.
