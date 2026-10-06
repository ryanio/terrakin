---
title: The build bar sits under the top bar in three tabs, and keeps picks the world would refuse pickable with the reason shown
date: 2026-10-06
status: accepted
tags: [client, ux, design]
---

# The build bar sits under the top bar in three tabs, and keeps picks the world would refuse pickable with the reason shown

## Context

[RFC 0016](../../rfcs/0016-build-with-what-you-gather.md) adds ten paths and floors and ten pieces of furniture to build with, next to the nine free blocks and the shop's four decor pieces. The build bar was one row of round chips above the action column, which on a phone sits a little below the middle of the screen. Three tabs (Blocks, Paths, Furniture), the row, and a line saying what the pick costs make it about 140 pixels tall. On an iPhone 13 in Safari (390 by 664) that covered the resident and the tiles in reach around them, which is exactly where you build. [Decision 0052](0052-the-client-holds-back-actions-the-sim-would-refuse-using-the.md) lets the client hold back what the sim would refuse, as long as the reason is on screen.

## Decision

- The bar sits under the top bar (Feed and Invite), centered, at most 26rem wide. The resident stays in the middle of the screen with all of their reach in view, between the bar and the d-pad and actions. Building closes chat, which opens in the same place, and opening chat ends building. While the bar shows, notices appear under it instead of over its tabs.
- Three tabs, each a row: Blocks (the free blocks and the hearth, as before), Paths (every path and floor), and Furniture (the workbench's furniture, then the shop's decor, with how many you hold). Every kind is always listed, in catalog order, so nothing slides under your finger as counts change.
- A pick the world would refuse (a path you can't pay for, furniture you hold none of) is dimmed but stays pickable, and the line under the tabs says why and where to get more. A tap on the map with it says so in a notice and sends nothing. The checks are the sim's `groundShort` and your counts from `GET /v1/inventory` and `inventory` events.
- On the Paths tab a tap lays the pick, or lifts whatever path is there; on the other tabs a tap on a block removes it, as before.

## Consequences

- The bar is further from a thumb than before. Building is careful, deliberate tapping, so we chose seeing your reach over reaching the bar. If people miss it at the bottom, a camera that lifts the resident while building is the other way, which would mean `tapTile` in `e2e/support.ts` stops assuming the resident is in the middle.
- A dimmed choice isn't `aria-disabled`, because it still works; its label says "not enough" or "none left".
- Code: `client/src/build-palette.ts`, `setBuildMode`, `showTab`, and `tapTile` in `client/src/world.ts`, `.palette` and `.hud.building .toast` in `client/src/style.css`, and `e2e/build.spec.ts`.
