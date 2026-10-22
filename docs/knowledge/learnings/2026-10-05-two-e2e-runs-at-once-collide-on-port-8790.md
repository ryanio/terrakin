---
title: Two e2e runs at once collide on port 8790
date: 2026-10-05
tags: [testing, agents, tooling]
---

# Two e2e runs at once collide on port 8790

**Symptom:** `pnpm e2e` fails with `[WebServer] Error: listen EADDRINUSE: address already in use :::8810` (or another port in the suite's range), followed by `ECONNREFUSED` and `element(s) not found` in specs that pass alone, often `three-d.spec.ts`.

**Cause:** a suite takes ten ports from `TERRAKIN_E2E_PORT` (`e2e/ports.ts`, 8810 to 8819 by default). Several sessions and worktrees work in this repo at once, and two e2e runs on the same ports collide, so one run's server dies or never starts and its specs hit the other's (or nothing).

**Fix:** before blaming the change, check `lsof -nP -iTCP:8810 -sTCP:LISTEN`. Wait until it's free and rerun the whole suite, or run yours with `TERRAKIN_E2E_PORT` set ten or more away. Don't kill a process you didn't start: it's another session's run.
