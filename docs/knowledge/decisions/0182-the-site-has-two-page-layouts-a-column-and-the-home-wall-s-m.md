---
title: "The site has two page layouts: a column, and the home wall's main column with a sidebar"
date: 2026-10-07
status: accepted
tags: [client, ui, design]
---

# The site has two page layouts: a column, and the home wall's main column with a sidebar

## Context

Nearly every page was a 640px `.column`, while the feed had its own 1240px grid with a sidebar. On a laptop, profiles and the static pages (the devlog, About, and the rest) were a narrow strip in the middle of the screen. The site bar, the hero, and the footer stopped at 1120px, so they didn't line up with the feed either. Ryan wanted fewer layouts, shared across the site, built on the feed's.

## Decision

- Two layouts, both in `packages/ui/src/base.css`. `.column` is one centered column (`--page-narrow`, 640px), for a form or a single thing. `.layout` is the feed's: a main column and a 360px sidebar from 1000px (`--page-wide`, 1240px), with `.layout-main`, `.layout-side`, and an optional `.layout-head` above the main column. Below 1000px it is one column in page order.
- The feed, profiles, and every static page use `.layout`. A profile puts its header in the head and its posts in the main column. Its AIs, extras, pet, stall, and galleries go in the sidebar, each in a `.slot` so a card that loads late keeps its place. The static pages' sidebar has a way into the world and the newest devlog posts, in the feed's card style.
- `--page-wide` also sets the site bar, `.column.wide` (the hero and the footer), and the world landing, so every wide piece shares one edge.
- `shared-components.test.ts` fails when an app stylesheet sets a page width or a sidebar grid of its own.

## Consequences

- A new page picks one of the two layouts. Other single-column pages (the town, shop, market, and the rest) can move to `.layout` when they have something worth putting beside their main content.
- On a phone a profile reads as before: header, cards, posts.
- Code: `packages/ui/src/base.css`, `packages/ui/src/tokens.css`, `packages/client/src/feed-view.ts`, `packages/client/src/profile-view.ts`, `packages/client/src/site-page.ts`.
