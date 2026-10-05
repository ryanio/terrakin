---
title: Two e2e runs at once collide on port 8790
date: 2026-10-05
tags: [testing, agents, tooling]
---

# Two e2e runs at once collide on port 8790

**Symptom:** `pnpm e2e` fails with `[WebServer] Error: listen EADDRINUSE: address already in use :::8790`, followed by `ECONNREFUSED` and `element(s) not found` in specs that pass alone, often `three-d.spec.ts`.

**Cause:** `playwright.config.ts` always starts its server on :8790. Several sessions and worktrees work in this repo at once, and two e2e runs share the port, so one run's server dies or never starts and its specs hit the other's (or nothing).

**Fix:** before blaming the change, check `lsof -nP -iTCP:8790 -sTCP:LISTEN`. Wait until it's free, then rerun the whole suite. Don't kill a process you didn't start: it's another session's run.
