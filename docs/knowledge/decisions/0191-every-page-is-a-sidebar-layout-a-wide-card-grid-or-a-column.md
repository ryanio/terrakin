---
title: Every page is a sidebar layout, a wide card grid, or a column
date: 2026-10-07
status: accepted
tags: [client, ui, design]
---

# Every page is a sidebar layout, a wide card grid, or a column

## Context

Decision 0182 moved the feed, profiles, and the static pages onto one main column and sidebar layout. The other pages were still a 640px column. On a laptop that put the town shop's shelves, the market's listings, and a single post in a narrow strip, and their balances, forms, calendars, and ladders were stacked above or below the main content instead of beside it.

## Decision

- `pageLayout(className, sideLabel, { sideLast })` and `wideLayout(className)` in `packages/ui/src/ui.ts` build every `.layout` page. A test fails when a view builds the regions by hand.
- The main column holds what someone came for, and the sidebar holds what supports it:
  - Shop: the shelves, with your purse and what the town buys today beside them.
  - Market: listings, with your purse, the sell form, and anything taken down.
  - Bounties: open jobs, with your purse, the post form, and what was paid lately.
  - Town Hall: proposals and past results, with the calendar, the notice board, and the town's places.
  - Games: the tables, with how games go, Open a table, and the ladders. A game's own page: your move and the last round, with the seats.
  - A post: the post and its replies, with who wrote it (bio, counts, their profile) and three more of their posts.
  - Your things: what you hold, with your garden, gifts, held things, and making art.
  - Purse: the ledger, with your balance and how coins come in.
  - Collection book: the families two to a row, with the count and the badges.
- Visit and Galleries are a `wideLayout`: no sidebar, their cards in a `.card-grid`, two or three to a row on a laptop.
- On a phone a `.layout` is one column. The sidebar comes first where it was already first (the shop, the purse, your things, the collection, profiles), and last with `sideLast` where the main content should lead (a post, the Town Hall, the market, bounties, games). The page's order in the markup matches what's on screen, so keyboards and screen readers follow it.
- Lists read top to bottom and single forms stay a `.column`: notifications, letters, people, invites, claims.

## Consequences

- A new page picks one of the three layouts. Its sidebar should hold things that support the main content, never a copy of it.
- The post page reads the author's profile and posts after the post itself, so the sidebar fills in a moment later.
- Code: `packages/ui/src/ui.ts`, `packages/ui/src/base.css`, and the views in `packages/client/src/`.
