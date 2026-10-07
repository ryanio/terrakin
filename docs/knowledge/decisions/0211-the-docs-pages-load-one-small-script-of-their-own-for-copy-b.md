---
title: The docs pages load one small script of their own, for copy buttons
date: 2026-10-07
status: accepted
tags: [docs, client, ui, performance, security]
---

# The docs pages load one small script of their own, for copy buttons

## Context

Decision 0195 made /docs and the API reference static pages with no script, under the static pages' `script-src 'none'` policy. /docs has a line to send an assistant, and people wanted a Copy button for it, as the app has. A button that copies needs a script, and every copy button on the site goes through `copyButton` in `@terrakin/ui`, which lived in `ui.ts` alongside the whole app's UI, the protocol, and zod. Loading that on the docs pages would have cost about 60 KB gzipped, and zod's eval probe would trip their policy. Adding the script as a second entry of the app's build moved shared code into new chunks and pushed the app's first load over its budget.

## Decision

- The docs pages (`/docs`, `/docs/api/*`, `/docs/skill`) load one script, `src/docs-copy.ts`, which turns each line marked `data-copy` into the shared `copyBlock`. Without it the line still shows, and one tap selects all of it (`.copy-text` is `user-select: all`).
- The site plugin bundles that script on its own with Vite's `build()`, in memory, and writes it as `assets/docs-copy-<hash>.js` (`docsCopyScript` in `vite.config.ts`), so the app's chunks and first load never change for it. It is about 5 KB gzipped.
- The docs pages get their own policy, the static pages' with `script-src 'self'`. Every other static page keeps `script-src 'none'`.
- The toast and the copy pieces moved out of `ui.ts` into `packages/ui/src/toast.ts` and `copy.ts`, with nothing heavier than the DOM helpers, and `ui.ts` re-exports them, so the app's imports are unchanged.

This changes decision 0195's "no script" to "one script of our own"; everything else in it stands.

## Consequences

- A new interactive piece on the docs pages goes in `docs-copy.ts` (renamed if it grows past copying) and must work without it.
- `e2e/docs.spec.ts` allows that one script and no other, copies the line, and still fails on any other host.
