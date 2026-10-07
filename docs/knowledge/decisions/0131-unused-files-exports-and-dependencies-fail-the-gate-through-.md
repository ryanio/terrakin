---
title: Unused files, exports, and dependencies fail the gate through knip
date: 2026-10-07
status: accepted
tags: [tooling, ci]
---

# Unused files, exports, and dependencies fail the gate through knip

## Context

Exports outlived their callers as code moved between packages and files. A first run of knip found 156 exports and 30 exported types that nothing outside their own file read, and a few functions nothing read at all. Sampling by hand caught a handful; nothing stopped new ones.

## Decision

`pnpm knip` runs in `pnpm verify` and in CI's verify job, right after lint, and fails on unused files, exports, exported types, dependencies, and unlisted dependencies or binaries. `knip.json` at the root names the entries knip can't infer: the scripts run directly (`scripts/*.ts`, `scripts/*/*.ts`) and the e2e specs. It ignores `.agents/` (vendored secrets tooling), the `cloudflared` binary, `cloudflare:workers` (a Worker built-in), and `@fontsource/fraunces` (read by file path in `packages/cards/src/fonts.ts`).

## Consequences

- A thing used only inside its file isn't exported. Export it when a second file needs it.
- A second name for the same thing on purpose (`parseMaintainers` for `parseTownsfolk`) carries an `@alias` JSDoc tag.
- `knip --fix` drops `export` from unused exports, but it breaks a destructured export like `export const [a, b] = f()` (it wrote `export const [,]`), so typecheck after it and read the diff.
- Code: `knip.json`, the `knip` and `verify` scripts in `package.json`, `.github/workflows/ci.yml`.
