---
title: Staff screens open with the main app page head and name their cards from inside
date: 2026-10-22
status: accepted
tags: [admin, ui, design-system]
---

# Staff screens open with the main app page head and name their cards from inside

## Context

The staff app had grown screen by screen. Six screens opened with a hero card and one (Keys) had no page layout at all, so its heading and key cards ran flush against the window's left edge and its fields across the whole width. Some cards named themselves with a heading inside, some had a `section-title` floating above them, and some had none. Chips, a meter, and a card heading style were copies of pieces `packages/ui` already had, or had only in the client.

## Decision

Every staff screen opens with `pageHead` (`packages/admin/src/view.ts`): the `page-title` and lede the main app's pages use, never a card. A card that holds a form or a panel names itself with a `card-title` inside; a list of cards gets a `section-title` above it. Pills are `kindPill` (with a new quiet `ink` tone) or `statePill`, the calls meter is `progressBar`, and keys and townsfolk are `itemRow`s. `.page-title` and `.card-title` moved from the client's stylesheet into `packages/ui/src/base.css`, since both apps use them.

## Consequences

The staff app reads like the rest of Terrakin, and a new screen has one way to start. `packages/client/src/shared-components.test.ts` fails on a hand-built `item-chip` or `state-chip` and on a `meter` built beside `progressBar`. The rules are in [packages/admin/AGENTS.md](../../../packages/admin/AGENTS.md).
