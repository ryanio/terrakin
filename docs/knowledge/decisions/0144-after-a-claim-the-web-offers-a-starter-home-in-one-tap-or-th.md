---
title: After a claim the web offers a starter home in one tap or the build bar on the hearth, then asks for a name
date: 2026-10-07
status: accepted
tags: [client, ux, onboarding]
---

# After a claim the web offers a starter home in one tap or the build bar on the hearth, then asks for a name

## Context

Starter seeds and the daily pantry arrive only when a resident's own action leaves them on their hearth (`payPantry` in `packages/sim/src/items.ts`). The web said "This plot is yours. Tap Build to start." after a claim and left the rest to one block per tap, with the hearth an unlabeled house in the build bar. Someone who never set a hearth never got seeds, so they couldn't plant, cook, or make anything. Agents have `build_starter_home` ([decision 0016](0016-settle-claims-a-first-plot-from-anywhere.md)), a hut with the hearth inside in one call. The plot's name was asked right after a claim ([decision 0121](0121-a-plot-s-name-lives-on-the-plot-in-the-sim-set-by-its-reside.md)).

## Decision

- Your own `plot_claimed` opens a sheet, "This plot is yours" (`home-sheet.ts`), with two choices:
  - "Build me a starter home" sends `build_starter_home`. If that left you off your hearth with no pantry, it sends `home` too, so the first pantry always comes with it. The sheet then hands over to the name sheet, which says the home is built and what the pantry brought ("10 seeds of 5 kinds, 1 bag of sugar, and 1 jar", `pantryWords` in `things.ts`) with a link to Your things.
  - "I'll build it myself" opens the build bar on Blocks with the hearth picked, and the name sheet over it.
- Home comes before the name: it's what brings the seeds, and a sheet someone closes without reading should be the one that matters less. Closing the home sheet without choosing asks nothing more; the visit card and the profile still offer a name.
- The hearth is the first choice on the build bar's Blocks tab and shows its name. Its line says what it's for: Home brings you back, and the pantry arrives there, seeds the first time, then sugar and jars each day.
- The "This plot is yours" toast is gone, since the sheet says it.
- Your things is in the HUD in Claim plot's place once you have a plot, and on your own profile.

## Consequences

- Both choices send only actions the web already had words for; the server still decides. A refusal shows on the sheet in HUD words (`worldProblem`).
- A resident who re-claims after releasing gets today's pantry, not the starter seeds, and the note says "Today's pantry".
- `e2e/claim.spec.ts` takes the starter home and finds the seeds; `e2e/smoke.spec.ts` builds it herself.
