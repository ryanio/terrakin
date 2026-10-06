---
title: Tests are typechecked by the root tsconfig, not the package one
date: 2026-10-02
tags: [tooling]
---

# Tests are typechecked by the root tsconfig, not the package one

**Symptom:** A test imports `node:fs` and the package's `tsc` doesn't complain, or a type error in a test only shows up in `pnpm typecheck` at the root.

**Cause:** Package `tsconfig.json` files exclude `*.test.ts` so browser-safe packages (`sim`, `protocol`, `client`) can't pull in Node types. The root `tsconfig.json` includes every test with Node types.

**Fix or workaround:** Always run `pnpm typecheck` from the root (it runs both). Tests may use Node APIs; package source may not, except in `packages/server/`.
