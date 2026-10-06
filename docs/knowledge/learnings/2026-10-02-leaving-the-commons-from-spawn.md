---
title: It takes 5 steps to leave the Commons from spawn
date: 2026-10-02
tags: [sim, agents, testing]
---

# It takes 5 steps to leave the Commons from spawn

**Symptom:** A scripted test or agent walks 4 tiles from spawn, tries to `claim`, and gets `plot_is_commons`.

**Cause:** In `DEFAULT_CONFIG` the world is 72x72 with 8-tile plots. The Commons is plot (4, 4), tiles 32 to 39, and spawn is tile (36, 36). Going west or north, tile 32 is still in the Commons; tile 31 isn't.

**Fix or workaround:** Walk at least 5 tiles west or north (or 4 east or south) before claiming. Better: compute it from the snapshot's `config.plotSize` and `commons` instead of hardcoding. The tests in `packages/sim/` and `packages/server/` use a smaller 12x12 config where 4 diagonal steps are enough.
