---
title: A test world's log written under earlier pottery rules no longer replays, which is fine only until pottery is on anywhere real
date: 2026-10-23
tags: [sim, replay, pottery, testing]
---

# A test world's log written under earlier pottery rules no longer replays, which is fine only until pottery is on anywhere real

**Symptom:** a local test world (`pnpm dev:test`) that had opened clay and fired pots crashed at boot after a pull. The boot replays the input log, and an input that was accepted when it was logged was refused on replay, so the world couldn't be rebuilt.

**Cause:** pottery's rules changed between rounds while it was still switched off: clay moved beside water and gained springs, a finish was renamed, the kiln's stone changed, tea's credit changed shape. Each change kept `REPLAY_VERSION` where it was, on the grounds that no live world had logged `open_clay`, so no log that matters could hold an input the new rules read differently. A test world's own log is exactly such a log, written under the earlier rules.

**Fix or workaround:** wipe the test world (`.dev-test-world`, which git ignores) and make it again with `pnpm persona settled --open-clay`. That is the right answer only while pottery has never been on anywhere real. The rule from then on is in `packages/sim/AGENTS.md`'s Pottery section: once `open_clay` is logged on terrakin.org, any change to how clay lies (the chances, the springs, the daily cap), what a kiln takes or does, the finishes and their odds, or how tea is poured either moves `REPLAY_VERSION` with an RFC or goes behind a logged switch, as every other system's numbers do.
