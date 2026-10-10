---
title: "The first load is three files cut by package: the libraries, the rules and the contract, and the app"
date: 2026-10-10
status: accepted
tags: [client, performance, tooling]
---

# The first load is three files cut by package: the libraries, the rules and the contract, and the app

## Context

The bundler (Rolldown, in Vite 8) puts modules that the same set of pages reach into a chunk of their own. The first load shares modules with every lazy page, each page with a different set, so what a first visit downloaded was 24 scripts, several under a kilobyte. Each one is compressed alone, lists what it imports and exports by name, and has a line in the entry's preload list.

That cost about 6 kB of the 120.9 kB first load, and it grew whenever the code was cut into better modules: splitting the REST calls by area took 10 kB of minified code out of the first load and still raised its gzipped size by 0.9 kB ([decision 0258](0258-the-first-load-s-budget-is-135-kb-counted-as-it-is-downloade.md)). A budget that goes up when the structure gets better pushes the wrong way.

## Decision

The client build groups what the entry imports up front (`codeSplitting.groups` with the `$initial` tag, in `packages/client/vite.config.ts`) into three files, cut where the code changes at different rates and along the way the packages already depend on each other:

- `vendor`: zod and the icons, which change when a dependency is bumped.
- `rules`: `@terrakin/sim` and `@terrakin/protocol`, the rules and the contract.
- the entry: `packages/client` and `packages/ui`, the app.

The entry imports `rules`, and `rules` imports `vendor`. Lazy pages are chunked as before and import from these three.

Measured with `node scripts/first-load.ts`:

| Chunks | Gzipped | Files |
|--------|---------|-------|
| As the bundler cuts them | 120.9 kB | 24 |
| One file | 113.3 kB | 1 |
| Libraries, and everything else | 114.2 kB | 2 |
| Libraries, rules and contract, app | 114.7 kB | 3 |

Considered: one file, the smallest. Every deploy that touches the app would make a returning visitor download all 113 kB again, zod included, and this site deploys several times a day.

Considered: leaving the bundler's chunks. A returning visitor does best with them after a deploy that changed only the client: the sim's and the schemas' chunks kept their names across the REST calls' split, so about 40 kB came down again. With three files that visit downloads the app file, 58 kB. The budget is there for the first visit ([decision 0110](0110-the-first-page-load-has-a-gzipped-size-budget-the-build-enfo.md)), and that one is 6.2 kB lighter and 21 requests fewer.

## Consequences

- A first visit downloads 114.7 kB of script in three files. After a deploy that changed only `packages/client` or `packages/ui`, a returning visitor downloads the app file (58 kB); after one that changed the sim or the protocol, that and `rules` (33 kB more); `vendor` (25 kB) only after a dependency changed.
- Cutting first-load code into more modules no longer costs bytes, so a module's size is its own business.
- The `$initial` tag follows imports, not use. A module the first load imports, but only a lazy page uses a name from, now rides in the first load, where the bundler's own chunks would have left it with the lazy page. `changelog.ts` does today (0.8 kB minified), through `devlog.ts`. A package with a barrel has to declare `"sideEffects": false`, as the sim and the protocol do, or every module its barrel names comes along: before the sim had the flag, grouping this way put 20 kB of lazy pages' sim code in the first load. `node scripts/first-load.ts` shows it, and the budget fails on a big one.
- The group names are in the files' names (`vendor-*.js`, `rules-*.js`). Nothing reads them: the page's own script is still the entry, which `scripts/deploy.ts` and the smoke check look for.
- If Rolldown changes what `$initial` means or how groups are merged into the entry, the first load's file count changes and `scripts/first-load.ts` prints it. Nothing breaks when the grouping stops applying: the bundler's own chunks are correct, only heavier.
