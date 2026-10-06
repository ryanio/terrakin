---
title: TypeScript monorepo with pnpm, Biome, and Vitest
date: 2026-10-02
status: accepted
tags: [tooling]
---

# TypeScript monorepo with pnpm, Biome, and Vitest

## Context

The vision calls for a monorepo with `client/`, `server/`, `sim/`, and `protocol/`, where the sim is shared between server and client. Contributors include agents that clone fresh each session, so setup must be one command and checks must be fast and unambiguous.

## Decision

- One language, TypeScript (strict, `noUncheckedIndexedAccess`), across all packages.
- pnpm workspaces. Internal packages export their `src/index.ts` directly, so there's no build step between packages.
- Biome for lint and format (one tool, one config, fast).
- Vitest for tests, one root config that runs every package as a project.
- Vite for the client. `tsx` runs the server in dev and prod for now.
- Dependencies pinned to exact versions (`.npmrc` has `save-exact=true`). Dependabot proposes upgrades weekly.
- `pnpm verify` runs everything CI runs.

## Consequences

- `pnpm install && pnpm verify` is the whole setup.
- The server isn't bundled. If startup time or deploy size matters later, add an esbuild step.
- Package tsconfigs exclude tests. The root `tsconfig.json` typechecks all tests with Node types, so browser-safe packages (`sim`, `protocol`, `client`) can't accidentally import Node APIs.
- The packages moved from the root into `packages/` in [decision 0111](0111-every-workspace-package-lives-in-packages-apps-and-libraries.md).
