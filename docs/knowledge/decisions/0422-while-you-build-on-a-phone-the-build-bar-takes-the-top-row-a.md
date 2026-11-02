---
title: While you build on a phone, the build bar takes the top row and the HUD keeps only what building needs
date: 2026-11-02
status: accepted
tags: [client, design, mobile]
---

# While you build on a phone, the build bar takes the top row and the HUD keeps only what building needs

## Context

On a 390 by 844 phone with the build bar open, 41% of the screen was controls, and the widest strip of map with nothing over it was 230 pixels tall. The bar sat under the top row of pills (Feed, Invite) and was four rows deep: the tabs, a row of floor, roof, and walls chips, the palette, and a help line that ran to two or three lines. Under it were Places with + and - up the right side, Gather all and the next-step chip over the d-pad, and the actions in the corner. The owner's phone photo showed a band of world in the middle and little else.

Out of building, Places and the zoom buttons stood in a column up the right edge, so the clear middle of the map was 438 pixels tall.

## Decision

While you build, Invite, Places, and the column of chips over the d-pad (Gather all, the next step, the job, Fish, Pat) step aside, at any width. Under 480 pixels the Feed link steps aside too and the build bar moves up into the top row's place; Feed comes back when building ends. The d-pad, the actions (Home, Your things, Build, Chat), and the settings stay, since you walk, check your things, and go home while you build.

The bar is three rows. The tabs and the chips for this plot share the first row: each tab is as wide as its word, and the chips scroll sideways after them with Walls first, since it changes what every wall tap does. The palette is the second. The line about the pick is the third and, on a phone, one row cut short with an ellipsis; a tap on it opens the whole line and another folds it. A new pick starts it folded. Screen readers get the whole line either way.

Out of building, on a phone, Places and a row of circles (-, +, 3D view, the speaker) sit over the actions in the corner instead of up the right side, and each action is a tap target tall (52 pixels) instead of 60.

Measured on the test world at 390 by 844 with a settled resident on her plot: building, the world shows on 74% of the screen (was 59%) and the clearest full-width strip is 520 pixels tall (was 230). In ordinary play the world shows on 81% (was 80%) and the strip is 538 pixels (was 438).

## Consequences

- Leaving the world from the build bar takes two taps: Build, then Feed. Opening chat also ends building.
- The help line can hide the end of a refusal ("You need 1 stone more") behind the ellipsis until it's tapped. If that confuses people, put the reason first in the line's words rather than unfolding the line again.
- The row of four circles is a little wider than the actions under it, so the chips over the d-pad stop short of it (`max-width` in the phone query), and a long chip such as "Set off a firework" is cut short.
- Ordinary play gains little area. Folding Invite and the speaker into a menu would gain more, at the cost of a tap and of `e2e/sound.spec.ts` reaching the speaker through it.
- Code: `packages/client/src/world.css` (`.hud.building`, `.palette-head`, `.hud-settings`, and the phone query at its foot), `packages/client/index.html` (`#hud`), and `packages/client/src/world.ts` (`paintFloors`, `paintPalette`, `clearLift`). Builds on [decision 0303](0303-on-a-phone-the-world-s-controls-are-icons-round-the-map.md).
