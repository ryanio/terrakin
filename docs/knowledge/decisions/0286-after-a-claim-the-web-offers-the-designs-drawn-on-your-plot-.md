---
title: After a claim the web offers the designs drawn on your plot, and builds one from a hearth at the center
date: 2026-10-15
status: accepted
tags: [client, ux, onboarding]
---

# After a claim the web offers the designs drawn on your plot, and builds one from a hearth at the center

## Context

[Decision 0144](0144-after-a-claim-the-web-offers-a-starter-home-in-one-tap-or-th.md) had the sheet after a claim offer one home, the starter hut, built with `build_starter_home`, which sets the hearth itself. RFC 0032 put nine designs on the API and asked the web to offer them as pictures. A `build` never sets a hearth, `set_hearth` needs the tile within reach, and the pantry pays only once you stand on your hearth.

## Decision

The sheet draws every design on the plot just claimed, in a row that scrolls sideways on a phone, with the walls to pick, and Build this home stays off until they're drawn. Building one sends, in order: a walk within reach of the plot's center if the world has you farther, `set_hearth` there (every design leaves it open), `home` when that didn't bring the pantry, and `build` with the design. The steps are worked out by `homeSteps` (`packages/client/src/home-steps.ts`). A hearth already at the center is not set again, and an `already_home` refusal counts as done, so a retry after a failed build goes straight to the build. Closing the sheet during the walk sends nothing. If the designs' code never loads, the button builds the starter hut as before. "I'll build it myself" and the name sheet after are 0144's.

## Consequences

A new resident chooses a home the way an assistant does, and the server builds it with the same rules. The designs' code and pictures load with the sheet (`design-picks.ts`, `design-thumb.ts`), never with the first page. A design added to the protocol shows here with no client change.
