---
title: The preview tool reads the main checkout's launch.json, not a worktree's
date: 2026-10-05
tags: [tooling, agents, testing]
---

# The preview tool reads the main checkout's launch.json, not a worktree's

**Symptom:** working in `.claude/worktrees/<name>`, `preview_start` with a new configuration name answers that port 5173 is taken by another session's `dev` server, even though the worktree's `.claude/launch.json` names a different port.

**Cause:** the Browser pane's `preview_start` reads `.claude/launch.json` from the main checkout (the project root), so a configuration added in a worktree isn't seen. Another session's `pnpm dev` usually holds 5173 and 8787.

**Fix or workaround:** add a temporary configuration to the main checkout's `.claude/launch.json` that `cd`s into the worktree and runs on its own ports, start it, then put the file back with `git checkout -- .claude/launch.json` right away (the server keeps running):

```json
{
  "name": "my-worktree",
  "runtimeExecutable": "sh",
  "runtimeArgs": ["-c", "cd .claude/worktrees/<name> && (PORT=8797 pnpm dev:server & TERRAKIN_SERVER=http://localhost:8797 pnpm --filter @terrakin/client exec vite --host --configLoader runner --port 5183 --strictPort)"],
  "port": 5183,
  "autoPort": false
}
```

Check `git diff --quiet -- .claude/launch.json` before adding it, so you never overwrite another session's edit. The dev server keeps its world in memory, so a restart starts empty.
