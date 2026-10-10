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
| `@terrakin/sim` free of side effects | 125.8 kB | 583 kB | 25 |
| A resident's report in `reports.ts`, apart from the staff's views | 121.8 kB | 567 kB | 24 |
| The API's areas in `route-table/tags.ts`, apart from the route table's limits | 120.9 kB | 563 kB | 24 |

Splitting the calls took 10 kB of minified code out of the first load: 8 kB of the protocol (the schemas of your things, the market, bounties, and galleries) and 2 kB of calls. The gzipped number still went up by 0.9 kB. The bundler gives every group of modules that the first load shares with a different set of lazy pages a chunk of its own, the split made seven more such groups, and each chunk is compressed alone and names what it imports and exports.

The sim's flag dropped four small modules nothing in the first load reads (Halloween, fishing, `putter`, the test grant). The sim's big modules stay because the first load does read them: the catalog (20 kB), which the protocol's item schemas are built from, the palette (9 kB), where the feed's plot thumbnails get each crop's color, and the looks (9 kB), which the schemas and the avatars both read. Nothing in the sim relied on a module running for its effect: its one top-level statement that isn't a declaration fills a table private to `gather.ts`.

`packages/ui` could take the flag too. Its modules build only private caches when they load, `people.ts` starts loading the figure drawing but only runs when an avatar helper is imported, and its styles reach the apps through `@import` in their stylesheets, never through a script. It would save 40 bytes of one lazy chunk and nothing in the first load, because the apps import each ui module by path and there is no barrel to prune. It stays off: a flag is a promise every later module has to keep.

The two protocol cuts are step 3 of the decision, found by listing which names the first load imports from each protocol module:

- From `safety.ts` (10 kB) the first load read two names, the Report sheet's `ReportResponse` and `REPORT_NOTE_MAX_LENGTH`. The rest is the staff's queue and overview, and it imports the check-in for one count, which brought the check-in, the games views, and the changelog along. A resident's report now has its own module, `reports.ts`, with the report reasons that `reasons.ts` held.
- From `route-table/shared.ts` (6 kB) the site config read `TAGS`, the areas of the API, to list a docs page for each. `TAGS` now has its own module beside it, so the rate limits and the staff's snapshot views no longer come with it.

`schemas.ts` (36 kB) was not cut. The first load reads most of it: the world snapshot for the feed's plot thumbnails, every world event through `ActionResponse` and `ServerMessage`, and the enums and ids the other schema modules are built from. What it never runs is the 66 action request schemas with `Action` and `ClientMessage`, about 28% of the module (10 kB minified, 2 to 3 kB gzipped), since the browser sends actions and never parses one. They are written between the enums and event views they share through 900 lines, so moving them to a module of their own is a reshuffle of the contract's main file and of where `AGENTS.md` says each action lives. It is worth doing on its own, when no one else is adding actions.

## Consequences

- When the budget was raised there were 9.2 kB between the first load and it, and the steps above added to that. The room is for features.
- The number the build prints went up by 1.3 kB with no change to the app, because it now includes the preload lists. Earlier decisions' numbers were counted the old way.
- A lazy page costs the first load a few bytes for its entry in the preload list, where before it looked free.
- If the first load passes 135 kB, the answer is again structure or a reasoned raise here, never a trade against readability.
