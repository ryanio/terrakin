---
title: The sim can't use host globals like structuredClone
date: 2026-10-02
tags: [sim, tooling]
---

# The sim can't use host globals like structuredClone

**Symptom:** `tsc` in `packages/sim/` fails with `Cannot find name 'structuredClone'` (or `setTimeout`, `crypto`, `URL`).

**Cause:** `packages/sim/tsconfig.json` only has the ES2023 lib, with no DOM or Node types. That's deliberate: it makes host APIs a compile error so the sim stays deterministic and portable.

**Fix or workaround:** Use plain-language equivalents. `cloneWorld()` uses a JSON round trip, which is exact because `WorldState` is plain JSON by design. If you need something genuinely host-specific, it belongs in `packages/server/` or `packages/client/`, not the sim.
