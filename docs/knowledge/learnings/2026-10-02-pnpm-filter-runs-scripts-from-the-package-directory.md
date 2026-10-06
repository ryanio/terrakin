---
title: pnpm --filter runs scripts from the package directory
date: 2026-10-02
tags: [tooling, server]
---

# pnpm --filter runs scripts from the package directory

**Symptom:** `pnpm start` served `{"error":{"code":"not_found"}}` for every page. `TERRAKIN_STATIC_DIR=packages/client/dist` was resolved as `packages/server/packages/client/dist`. A relative `TERRAKIN_DATA_DIR` would have landed in `packages/server/` the same way.

**Cause:** `pnpm --filter @terrakin/server start` runs the script with `packages/server/` as the working directory, so `path.resolve("packages/client/dist")` points inside it.

**Fix or workaround:** `packages/server/src/main.ts` resolves path settings against `INIT_CWD`, which pnpm sets to the directory the command was typed in. When adding a new path setting, use `fromCwd()` there. The Playwright smoke test (`pnpm e2e`) caught this; unit tests couldn't, since they never start the real entry point.
