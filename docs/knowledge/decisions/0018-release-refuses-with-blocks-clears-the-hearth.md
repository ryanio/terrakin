---
title: Releasing a plot refuses with blocks and clears the hearth
date: 2026-10-04
status: accepted
tags: [sim, protocol, design, agents]
---

# Releasing a plot refuses with blocks and clears the hearth

## Context

Claiming shipped in #4 with no way to give a plot back. Issue #16 adds a `release` action so a resident can return a plot to the claimable pool, and asks for a recorded decision: what happens to the blocks on the plot and to the owner's hearth?

While the release PR was open, plot sharing landed ([decision 0016](0016-settle-claims-a-first-plot-from-anywhere.md)): a plot can have up to 3 co-owners, each of whom can build there and keep a hearth there.

## Decision

- `release` acts on the plot you're standing on (mirroring `claim`). Only the owner can release it; a co-owner gets `not_your_plot`. After release the plot is claimable again, by `claim` or `settle`.
- Release refuses with `plot_has_blocks` while any block stands on the plot, whoever built it. The owner removes every block first; release never demolishes.
- Every co-owner loses their share, exactly as if the owner had sent `unshare_plot` for each: a `plot_unshared` event each, plus `hearth_cleared` when their hearth was on this plot. A co-owner's hearth elsewhere stays.
- The owner's hearth on the released plot is cleared too, with a `hearth_cleared` event. Refusing on a hearth isn't an option: a hearth must sit on a plot you can build on, and with one plot per resident there's nowhere to move it, so "clear your hearth first" would deadlock release.
- Event order: each co-owner's `plot_unshared` (and `hearth_cleared`) in `coOwners` order, then `plot_released`, then the owner's `hearth_cleared`.

## Why

- Release is one honest change. Demolishing N blocks as a side effect would turn a misclick into a wiped build, and removing blocks is already a cheap, explicit action.
- Keeping the blocks for the next owner sounds charming but creates orphan builds: the releaser can't touch them afterward, and the claimer inherits work they didn't make with no way to tell who built what.
- Clearing hearths keeps the invariant that every hearth sits on a plot its resident can build on. A hearth left on nobody's land would break `set_hearth`'s own rule and the join-respawn logic that trusts the hearth.
- The owner already decides shares alone (`unshare_plot`), so release doesn't need co-owner agreement. Requiring the owner to unshare everyone first would only add steps. Reusing `plot_unshared` means clients that already mirror sharing need nothing new to drop the co-owners.

## Consequences

- Releasing a built-up plot takes several actions (remove each block, then release). That's fine for phase 1, and it is the point: a release can't wipe a home by accident.
- A resident who releases their only plot can `settle` again, which lands them anywhere. That is no more than `home` already allows, and they still hold one plot at a time, so it doesn't help grab land.
- Replay stays clean: release is one input, the events describe every change, and a plot that was shared and released leaves no `coOwners` behind, because the whole plot entry is removed.
