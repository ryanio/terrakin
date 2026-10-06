---
title: Symlinked package node_modules make a worktree run the main checkout's workspace packages
date: 2026-10-05
tags: [tooling, agents, testing]
---

# Symlinked package node_modules make a worktree run the main checkout's workspace packages

**Symptom:** none you'd notice right away. A worktree with `packages/client/node_modules` (and the other packages' `node_modules`) symlinked from the main checkout typechecks and tests, but against the main checkout's `packages/sim/`, `packages/protocol/`, and `packages/ui/`, not the worktree's edits.

**Cause:** pnpm links workspace packages with relative symlinks inside each package's `node_modules` (`packages/client/node_modules/@terrakin/sim -> ../../../sim`). When `packages/client/node_modules` itself is a symlink to `/Users/.../terrakin/packages/client/node_modules`, that relative link resolves from the main checkout, so `@terrakin/sim` is the main checkout's sim.

**Fix:** in a worktree, run `pnpm install --frozen-lockfile --offline`. It links from the shared store in a few seconds and makes each package's `node_modules` point at the worktree's own packages. Symlinking only the root `node_modules` is not enough either, for the same reason. Check with `readlink packages/client/node_modules/@terrakin/sim`, which should be relative and resolve inside the worktree.
