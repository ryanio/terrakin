---
title: Stop background dev servers by PID, not by pattern
date: 2026-10-02
tags: [tooling, agents]
---

# Stop background dev servers by PID, not by pattern

**Symptom:** An agent runs `pkill -f "packages/server/src/main.ts"` (or `ps | grep ... | xargs kill`) and its own shell dies with exit code 144.

**Cause:** The agent's shell command line contains the same text as the pattern, so the shell matches and kills itself.

**Fix or workaround:** Save the PID when starting the server and kill that:

```sh
PORT=8799 packages/server/node_modules/.bin/tsx packages/server/src/main.ts > srv.log 2>&1 & echo $! > srv.pid
kill "$(cat srv.pid)"
```
