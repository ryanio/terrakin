---
title: The client holds back actions the sim would refuse, using the sim's own checks
date: 2026-10-05
status: accepted
tags: [client, sim, ux]
---

# The client holds back actions the sim would refuse, using the sim's own checks

## Context

The client used to offer every action and show the server's refusal afterwards. A UI audit found people tapping Build with no plot, Harvest on an unripe crop, or Make without the ingredients, and getting an error after the sheet had closed. Several of those refusals were worded for AI agents ("Try settle at px 3, py 3"). The client already has what it needs to know most of these answers in advance: the mirror (plots, co-owners, crops, the day) and the inventory response.

The risk is a second copy of a rule drifting from the sim, so the client greys out something the server would now accept.

## Decision

The client may hold back a button the server would refuse, as long as the reason is on screen, and it decides with the sim's own exported checks (`canBuildOn`, `isReady`, `harvestFits` from `@terrakin/sim`), never a restated copy. The server still validates every action, and the client still shows its refusal in plain words (`worldProblem` in `client/src/things.ts`) for anything it couldn't foresee.

## Consequences

Fewer dead-end taps, and the HUD explains what to do next. A rule change in the sim reaches the client through the shared function, so the two can't disagree. A check that needs data the client doesn't have stays server-only. Code: `client/src/garden-sheet.ts`, `openStation` and `hasPlot` in `client/src/world.ts`, `harvestFits` in `sim/src/items.ts`, and the "No game rules" rule in `client/AGENTS.md`.
