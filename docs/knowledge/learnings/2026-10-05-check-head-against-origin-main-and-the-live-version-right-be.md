---
title: Check HEAD against origin main and the live version right before a manual deploy
date: 2026-10-05
tags: [deploy, agents, process]
---

# Check HEAD against origin main and the live version right before a manual deploy

**Symptom:** every `/v1` route answered 500 with Cloudflare error 1101 for about two minutes after a laptop deploy. Sentry's `terrakin-api` showed `Replay diverged at entry 2474: not_joined`.

**Cause:** the laptop deployed an older commit than the one already live. Another session deployed the market while `pnpm verify` ran here for a few minutes. That version wrote log entry 2474, which the older sim can't replay.

The shared checkout had also moved during the run: another session committed in it. The deploy command checked for a clean tree but never compared HEAD with `origin/main`.

**Fix or workaround:**
- A push to `main` deploys itself once CI is green ([deploy.md](../../deploy.md)), so a manual deploy is rarely needed.
- `pnpm cf:deploy` now fetches and refuses unless HEAD is `origin/main` and the tree is clean, checked after the build, right before the upload (`scripts/deploy.ts`). In CI a superseded commit skips the upload.
- If a deploy breaks replay, deploy the newest `origin/main` at once. Rolling back can't help, because the log already holds the newer command.
