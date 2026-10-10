---
title: The first load's budget is 135 kB, counted as it is downloaded, and it never buys a smaller number with worse code
date: 2026-10-10
status: accepted
tags: [client, performance, tooling]
---

# The first load's budget is 135 kB, counted as it is downloaded, and it never buys a smaller number with worse code

## Context

The first load had a budget of 125 kB of gzipped script ([decision 0231](0231-the-client-build-leaves-out-zod-s-json-schema-code-and-draws.md)), set when it measured 119.5 kB. Three features landed in the week since (homes with an upstairs, levels and skills, and the home wall's sky card), and the build reported 124.5 kB.

The budget is there so that growth is a choice someone makes ([decision 0110](0110-the-first-page-load-has-a-gzipped-size-budget-the-build-enfo.md)). With half a kilobyte left it had started to do something else: the cheapest way to land a change was to make the code a little worse, by shortening a name, folding two functions into one, or leaving a helper in the wrong module because moving it cost bytes.

The build also counted low. It measured the scripts before Vite wrote the list of files each `import()` preloads into them, and every lazy page adds to that list. What a visitor downloaded was 125.8 kB, already over.

Most of what the first load holds is there because of how modules are cut, not because the feed draws it. Minified, it held 175 kB of the client, 141 kB of zod, 109 kB of the protocol's schemas, 73 kB of the sim, 69 kB of `packages/ui`, and 21 kB of icons. A zod schema is a call that runs when its module loads, so the bundler keeps or drops a module whole: one import from `schemas.ts` keeps all 36 kB of it. `api.ts` was one object with every REST call, so the feed carried the response schemas of the shop, the market, bounties, games, and the owner panel.

## Decision

- `FIRST_LOAD_BUDGET.js` is 135 kB. The styles' budget stays at 32 kB; they measure 31.8 kB.
- The budget never makes code worse. A change that doesn't fit is loaded with `import()`, or fixed by cutting modules along a line that makes sense on its own, or the budget is raised here with a reason. Renaming for length, merging things that read better apart, and rewriting the protocol's schemas in another style (`zod/mini`) to save bytes are ruled out.
- The build counts the scripts as they are downloaded: `firstLoadBudget` runs after Vite's own bundle hooks (`order: "post"`), so the preload lists are in.
- `node scripts/first-load.ts` prints the same number with the packages and modules that make it up. Run it before and after a change to the first load.
- The real size comes down through structure:
  1. The REST calls are split by area, and a page that loads lazily imports its own area's calls, so the first load keeps only what the feed, the top bar, and the router ask for.
  2. `@terrakin/sim` declares `"sideEffects": false`, as the protocol does, so the bundler may leave out sim modules the first load never reads.
  3. Protocol modules the first load reads a few things from are cut so those few can be imported alone.

Considered: holding the budget at 125 kB until the structural work landed. Every change to the feed in the meantime would have had to fight the number, which is the pressure this decision removes.

Considered: `zod/mini`, which would drop most of zod's 141 kB. It means rewriting about 2,100 schema calls in a style that reads worse (decision 0231 measured the count), so it stays ruled out.

## What each step gave back

`node scripts/first-load.ts` after each step. Minified is what is left after tree shaking, summed over the first load's modules.

| Step | Gzipped | Minified | Chunks |
|------|---------|----------|--------|
| Before | 125.8 kB | 594 kB | 18 |
| The REST calls split by area | 126.7 kB | 584 kB | 25 |

Splitting the calls took 10 kB of minified code out of the first load: 8 kB of the protocol (the schemas of your things, the market, bounties, and galleries) and 2 kB of calls. The gzipped number still went up by 0.9 kB. The bundler gives every group of modules that the first load shares with a different set of lazy pages a chunk of its own, the split made seven more such groups, and each chunk is compressed alone and names what it imports and exports.

## Consequences

- There are 9.2 kB between the first load and its budget. That room is for features, and the structural work is meant to add to it rather than spend it.
- The number the build prints went up by 1.3 kB with no change to the app, because it now includes the preload lists. Earlier decisions' numbers were counted the old way.
- A lazy page costs the first load a few bytes for its entry in the preload list, where before it looked free.
- If the first load passes 135 kB, the answer is again structure or a reasoned raise here, never a trade against readability.
