---
title: The first page load has a gzipped size budget the build enforces
date: 2026-10-06
status: accepted
tags: [client, performance, tooling]
---

# The first page load has a gzipped size budget the build enforces

## Context

Terrakin is mobile-first, and every visitor downloads the app's entry script, every chunk it imports up front, and their stylesheets before the first screen. Nothing measured that, so it only ever grew. Measured on 2026-10-06, the first load was 226.9 kB of gzipped script. About 22 kB of that was the protocol package's route table and OpenAPI builder. The client never uses either, but `@terrakin/protocol` didn't declare itself free of side effects, so the bundler kept every module its index re-exports.

## Decision

- `@terrakin/protocol` declares `"sideEffects": false`, so the bundler leaves out the modules the client doesn't use. That brought the first load to 204.7 kB.
- The client build measures the first load (`firstLoadBudget` in `client/vite.config.ts`) and fails past `FIRST_LOAD_BUDGET`: 215 kB of gzipped script and 32 kB of gzipped styles. Lazy chunks (3D, sound, the API reference) don't count.

## Consequences

- A change that adds weight to every visit fails `pnpm verify` and says by how much. The fix is to load the new code with `import()`, or to raise the budget here with a reason.
- A protocol module that must run for its side effects alone would now be dropped. None does, and the package stays that way.
- The budget is today's size, not a target. Most of the first load is views that only some visits need (the profile, town and feed views, the look editor, figure and item art), and loading those per page is the way to bring it down.
