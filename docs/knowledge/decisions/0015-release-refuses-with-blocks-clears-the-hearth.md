---
title: Releasing a plot refuses with blocks and clears the hearth
date: 2026-10-04
status: accepted
tags: [sim, protocol, design, agents]
---

# Releasing a plot refuses with blocks and clears the hearth

## Context

Claiming shipped in #4 with no way to give a plot back. Issue #16 adds a `release` action so a resident can return a plot to the claimable pool, and asks for a recorded decision: what happens to the blocks on the plot and to the owner's hearth?

## Decision

- `release` acts on the plot you're standing on (mirroring `claim`). Only the owner can release it; after release the plot is claimable again.
- Release refuses with `plot_has_blocks` while any block stands on the plot. The owner removes every block first; release never demolishes.
- The owner's hearth on the released plot is cleared automatically, with a `hearth_cleared` event. Refusing on a hearth isn't an option: a hearth must sit on your own plot, and with one plot per resident there's nowhere to move it, so "clear your hearth first" would deadlock release.
- The action emits at most two events: `plot_released`, and `hearth_cleared` when a hearth was on the plot.

## Why

- Release is one honest change. Demolishing N blocks as a side effect would turn a misclick into a wiped build, and removing blocks is already a cheap, explicit action.
- Keeping the blocks for the next owner sounds charming but creates orphan builds: the releaser can't touch them afterward, and the claimer inherits work they didn't make with no way to tell who built what.
- Clearing the hearth keeps the invariant that every hearth sits on its owner's plot. A hearth left pointing at nobody's land would break `set_hearth`'s own rule and the join-respawn logic that trusts the hearth.

## Consequences

- Releasing a built-up plot takes at least two actions (remove, release). That's fine for phase 1.
- Replay stays clean: release is one input, and the events describe every change.
- If shared plots ever land (an owner plus co-owners), revisit this: release may need agreement semantics instead of a sole-owner action.
