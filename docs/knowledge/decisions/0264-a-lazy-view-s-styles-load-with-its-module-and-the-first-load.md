---
title: A lazy view's styles load with its module, and the first load's styles budget is 26 kB
date: 2026-10-11
status: accepted
tags: [client, performance, tooling]
---

# A lazy view's styles load with its module, and the first load's styles budget is 26 kB

## Context

The first load's styles measured 31.9 kB gzipped against a budget of 32 kB ([decision 0258](0258-the-first-load-s-budget-is-135-kb-counted-as-it-is-downloade.md)), so the next stylesheet change would have failed the build. The script side had come down through structure: every page but the feed loads its code with `import()`. The styles never had. `packages/client/src/style.css` held every rule the app has, so each visit downloaded the profile page, the world's HUD, the look editor, the 3D views, the Town Hall, games, letters and the rest before the home wall could paint.

Waste was not the problem. Searching the client, ui and staff sources, `index.html`, the static pages' templates and every class name built from a template string found one rule with no markup (`.onboard-name`, unused since the join form dropped it in [decision 0140](0140-a-person-joins-with-hair-a-top-and-a-color-and-no-shape.md)), no exact duplicates, and no copy of a `packages/ui` primitive that the shared-components test doesn't already catch. Rules that share their declarations with another rule are different components that look alike today. Merging them is the kind of change decision 0258 rules out.

Vite already loads a stylesheet with a lazy chunk. A stylesheet imported from a module goes into that module's chunk, and the preload helper in front of every `import()` adds the chunk's `<link rel="stylesheet">` and waits for it to load before the module runs. A page built through `lazyView` shows its skeleton until then, so nothing is drawn before its styles are there. A sheet loaded this way lands after `style.css` in the document, so its rules come later in the cascade than the rules they were moved past.

## Decision

- A view that loads lazily keeps the rules only it draws in a stylesheet beside its module, named for it and imported by it: `profile-view.css` with `profile-view.ts`, `world.css` with `world.ts`, and the same for the look editor, the 3D views, the Town Hall, games, the collection book, letters, people, the claim page, pets, the skills sheet and the build bar. A part that several lazy views open has its own (`pet-sheet.css`, `build-palette.css`), so it loads with whichever opens first.
- `style.css` keeps what the first load can show: the home wall, the site's chrome, the landing curtain, the world loader, the post card and its pieces, the sheets the first load opens, the static pages and the docs, and anything two or more lazy views draw without a shared module to carry it.
- Rules move whole and keep their order. Before a rule moved, every rule left in `style.css` after it that could match the same element with the same specificity was checked, since the moved rule now comes later; none changed what it draws. Two lazy sheets never style the same element, so the order they load in doesn't matter.
- `FIRST_LOAD_BUDGET.css` is 26 kB. The first load's styles measure 22.6 kB after the split, which leaves 3.4 kB for features, about the share decision 0258 left the script. Left at 32 kB, the budget would let every rule that moved out come back unnoticed.
- `src/shared-components.test.ts` reads every client stylesheet. A selector is defined once across all of them (they are one cascade), the token, scale and primitive checks cover each one, and each view's sheet is imported by the module it is named for and nowhere else, so a sheet can't be left with no importer or pulled into the first load through another module.

What it gave back, from the build's own numbers:

| | Styles, gzipped |
|---|---|
| Before | 31.9 kB |
| The look editor in its own sheet | 31.1 kB |
| Every lazy view's rules beside its module | 22.6 kB |

The lazy sheets come to 14.4 kB gzipped in 12 files (the look editor's joins the profile's chunk), and each comes down only when its view opens. The first load's script grew by 0.2 kB, because each `import()`'s preload list now names its stylesheet too.

Considered: a stylesheet of their own for the static docs pages, which carry about 0.5 kB of rules the app never shows. The static pages link the app's stylesheet and nothing else ([decision 0211](0211-the-docs-pages-load-one-small-script-of-their-own-for-copy-b.md)), and a second one would have to be built outside the app's bundle. Half a kilobyte doesn't pay for that.

Considered: raising the budget instead. It buys room without changing why the room ran out.

## Consequences

- A rule goes where its markup is drawn. A new lazy page gets its own stylesheet; a rule for something the home wall shows goes in `style.css`.
- When a part moves from a lazy view into a module the first load imports, its rules move into `style.css` with it, or they arrive late. The test checks a sheet's importer, not which modules draw its classes, so this stays a review question.
- A view opened for the first time waits for its stylesheet as well as its script; both are requested together.
- The static pages are unchanged: they link the entry's one stylesheet.
