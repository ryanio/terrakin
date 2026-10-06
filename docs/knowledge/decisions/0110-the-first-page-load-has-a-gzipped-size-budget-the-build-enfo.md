---
title: The first page load has a gzipped size budget the build enforces
date: 2026-10-06
status: accepted
tags: [client, performance, tooling]
---

# The first page load has a gzipped size budget the build enforces

## Context

Terrakin is mobile-first, and every visitor downloads the app's entry script, every chunk it imports up front, and their stylesheets before the first screen. Nothing measured that, so it only ever grew. Measured on 2026-10-06, the first load was 226.9 kB of gzipped script:

- About 22 kB was the protocol package's route table and OpenAPI builder. The client never uses either, but `@terrakin/protocol` didn't declare itself free of side effects, so the bundler kept every module its index re-exports.
- About 58 kB was the code for pages other than the feed (profiles, the Town Hall, the look editor, the shop, games, and the rest), which `main.ts` imported up front although a visit opens one page at a time.
- About 14 kB was the item art, which the feed's plot thumbnails pulled in to read one color table the sim already exports (`CROP_HEX`).

## Decision

- `@terrakin/protocol` declares `"sideEffects": false`, so the bundler leaves out the modules the client doesn't use.
- The feed is the home page, so its code comes with the first load. Every other page loads its own code when it's opened: `pageFor` in `packages/client/src/main.ts` builds it through `lazyView` (`packages/client/src/lazy-view.ts`), which shows loading cards until the code arrives, never builds a page that was left before then, and offers a reload when the code can't load (after a deploy replaced it).
- The plot thumbnails read `CROP_HEX` from `@terrakin/sim`, not through `@terrakin/ui/item-art`.
- Together these bring the first load to 133.5 kB of gzipped script and 28.2 kB of styles.
- The client build measures the first load (`firstLoadBudget` in `packages/client/vite.config.ts`) and fails past `FIRST_LOAD_BUDGET`: 140 kB of gzipped script and 32 kB of gzipped styles. Lazy chunks (other pages, the world, 3D, sound) don't count.

## Consequences

- A change that adds weight to every visit fails `pnpm verify` and says by how much. The fix is to load the new code with `import()`, or to raise the budget here with a reason.
- A protocol module that must run for its side effects alone would now be dropped. None does, and the package stays that way.
- Opening a page other than the feed for the first time waits for one more small request, behind loading cards.
- What's left in the first load is what the feed itself draws: zod and the protocol's schemas (about 45 kB, including zod's JSON Schema code, which the classic API carries), the API layer, the feed, and the figure drawing its avatars use. The figure could load after the avatars appear, at the cost of every avatar popping in late.
