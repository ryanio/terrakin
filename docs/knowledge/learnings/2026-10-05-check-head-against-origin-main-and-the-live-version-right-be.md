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
- If you do deploy by hand, fetch and check `git rev-parse HEAD` equals `git rev-parse origin/main` in the same command as `pnpm cf:deploy`, after any long verify, not before it.
- If a deploy breaks replay, deploy the newest `origin/main` at once. Rolling back can't help, because the log already holds the newer command.
