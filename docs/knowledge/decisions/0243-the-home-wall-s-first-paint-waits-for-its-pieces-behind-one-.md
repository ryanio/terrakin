---
title: The home wall's first paint waits for its pieces behind one block of placeholders
date: 2026-10-09
status: accepted
tags: [client, design, performance]
---

# The home wall's first paint waits for its pieces behind one block of placeholders

## Context

The home wall is built from six requests that land in any order: the first page of posts, the world and the Town Hall (the town's cards), your profile (the composer), Getting started, "While you were away", and the devlog card. Each one put its piece in as soon as it arrived, and only the posts had placeholders, so the page jumped once per request. On a phone a resident's wall measured a layout shift of about 1.07 (Google calls anything over 0.25 poor). The placeholders also swept a bright shimmer across every bar, which drew the eye more than the page did.

## Decision

On the first load, the wall's own regions (the composer, the cards above the posts, and the posts) stay hidden behind one block of placeholders until every piece is in or `FIRST_PAINT_MS` (1.2 seconds) has passed; then the placeholders go and everything shows at once. A region that appears doesn't move what's on screen, so the first paint shifts nothing. Pieces that land later go in on their own, holding the reader's place as before. Every placeholder in both apps comes from `packages/ui/src/skeleton.ts` and breathes slowly in the paper's edge color after a short wait, holding still under reduced motion.

Considered: a placeholder sized like each piece in its own place. Whether the devlog, Getting started, or "While you were away" cards show at all isn't known until their requests answer, so any guess at their size still jumps when it's wrong.

## Consequences

- The wall's layout shift on load is under 0.01 locally, and `e2e/feed.spec.ts` fails above 0.05 (it measured 1.07 with the wait taken out).
- On a slow connection the wall can show placeholders up to 1.2 seconds longer than its fastest piece took. A piece slower than that goes in on its own.
- A new piece on the wall's first load joins the wait with `whenPainted` in `packages/client/src/feed-view.ts`, or it brings the jumping back.
- `packages/client/src/shared-components.test.ts` fails on a placeholder built by hand.
