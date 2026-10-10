---
title: A page loads behind placeholders in its own layout and shows whole once its first content is in
date: 2026-10-10
status: accepted
tags: [client, design, performance]
---

# A page loads behind placeholders in its own layout and shows whole once its first content is in

## Context

Every page but the feed loads its code when opened (`lazyView`), then asks the server for its data. While the code loaded, every page showed the same two post-shaped placeholders in a narrow column, whatever its layout. Once the code was in, most pages showed a title over a blank body until the request answered, and a few drew placeholders of their own in shapes that didn't match what replaced them: a profile was a blank 260px card in the wrong region, and Visit put post shapes in a card grid. A profile also appended its posts without clearing its placeholders, so two grey posts stayed on every profile.

The placeholders breathed between 55% and 85% opacity every 2.4 seconds, which read as busy with a page full of them.

## Decision

`lazyView` shows one page of placeholders, `skeletonPage` from `packages/ui/src/skeleton.ts`, in the page's own layout: a sidebar layout, a wide grid, or a column, holding posts, a list, cards, or one card, under a title bar or a profile header. Each route names its shape in `SHAPES` in `packages/client/src/main.ts`. The page is built as soon as its code is in, placed in the document hidden, and takes the placeholders' place when its `ready` resolves, so it appears whole.

The placeholder page fades in after 150ms, so a load quicker than that shows none. The shapes breathe between 60% and 78% opacity every 3.6 seconds, and hold still under reduced motion.

A page whose `load` has to measure, scroll, or take focus (a post's reply box sizing to a draft, a letter thread scrolling to the newest letter) passes `own` to `lazyView`: it is shown as soon as its code is in and draws its own placeholder. So do Visit and Galleries, whose tabs open each other: their title and tabs stay on screen through a switch, and only the grid under them shows placeholders.

Considered: placeholders drawn by each page in its own regions. That is one more call and one more error path in twenty views, and the placeholders shown while the code loads still couldn't match, since the page's module isn't there to ask.

Considered: building the page detached from the document. Pages check `isConnected` before finishing late work, so a detached page would drop it.

## Consequences

- A page draws no placeholders for its first load. The ones left in `profile-view.ts`, `claim-view.ts`, `invite-view.ts`, and `town-view.ts` show only after Try again.
- Nothing in a page's `load` may measure, scroll, or take focus before `ready` resolves, since the page is hidden until then, and `ready` should resolve as soon as the first content is in: the notifications page no longer waits for its mark-read request. `packages/client/AGENTS.md` says so.
- The followers, following, and friends tabs swap the whole page, title included, as they did before: that page builds its title from the profile it loads.
- A page's title waits for its data too, behind a bar of the same height. A request that never answers leaves the placeholders up, where before it left a title over a blank page.
- A new page adds its shape to `SHAPES`; a new shape goes in `skeleton.ts`, not in a view.
- The home wall keeps its own block of placeholders ([decision 0243](0243-the-home-wall-s-first-paint-waits-for-its-pieces-behind-one-.md)), built from the same pieces.
- `e2e/praise.spec.ts` fails when a loaded profile still holds a placeholder.
