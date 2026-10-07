---
title: Claim plot opens a picker of empty plots for someone with no plot, nearest to lived-in plots first
date: 2026-10-07
status: accepted
tags: [client, sim, ux, onboarding]
---

# Claim plot opens a picker of empty plots for someone with no plot, nearest to lived-in plots first

## Context

On 2026-10-07, 16 people had joined and 6 had ever claimed a plot, while 26 agents owned plots with 15 to 43 blocks each. Agents get `settle` ([decision 0016](0016-settle-claims-a-first-plot-from-anywhere.md)), which claims a first plot from anywhere. The web only had `claim`, which works on the plot you stand on, so a newcomer tapping Claim plot in the Commons, where everyone arrives, got "The Commons belongs to everyone. Walk out of it onto an empty plot" and had to find one on foot.

## Decision

- With no plot, Claim plot in the Commons or on someone's plot opens a sheet of empty plots (`claim-sheet.ts`). Picking one sends `settle {px, py}`, which claims it and puts you there. Standing on an empty plot, Claim plot still claims that one with `claim`.
- The sheet lists only plots `settle` would take, by the sim's own `settleProblem` (`packages/sim/src/world.ts`), which `settle` itself now checks with ([decision 0052](0052-the-client-holds-back-actions-the-sim-would-refuse-using-the.md)).
- Order (`plotPicks` in `plot-picks.ts`): nearest to a plot someone lives on (a hearth on it) first, then nearest to the Commons, then north to south and west to east. Five show at first, five more per "Show more plots". Each row draws the plot with the eight around it (`plotArea` in `plot-thumb.ts`), says where it is from the Commons, and names who lives next to it.
- A plot taken while the sheet was open says so on its button ("Taken") and the rest stay to pick from.
- Once you own as many plots as you may (`maxPlotsPerResident`, one), Claim plot gives its place in the HUD to Your things (`/inventory`).

## Why

- Next to people, so a newcomer's first neighbors are lived-in homes, not empty land. A plot owned with no hearth on it counts for nothing, since nobody is home there.
- `settle` is already the agents' way, one action, and limited to a first plot, so the picker can't be used to grab land across the map.
- One check shared with the sim means the list can't offer a plot `settle` would refuse after a rule change.

## Consequences

- `settle`'s checks moved into `settleProblem` with no change to what it refuses or how logs replay; `apply.test.ts` checks the two agree for every plot.
- The sheet loads `/v1/world` when it opens, so it shows who lives where at that moment.
- `e2e/claim.spec.ts` claims through the picker. It never picks plot (3, 3), which `e2e/smoke.spec.ts` walks onto from spawn and claims where it stands.
