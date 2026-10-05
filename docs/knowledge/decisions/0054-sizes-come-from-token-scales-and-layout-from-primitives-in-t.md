---
title: Sizes come from token scales and layout from primitives in the class list
date: 2026-10-05
status: accepted
tags: [client, tooling, process]
---

# Sizes come from token scales and layout from primitives in the class list

## Context

The tokens covered colors, two radii and two shadows. Every other size was typed by hand, and the stylesheets had drifted to 29 different spacing values, 40 font sizes (13px, 13.5px, 14px and 14.5px all for the same kind of meta text) and 15 corner radii.

Layout was restated per view. Nineteen rules said only `display: grid` and a 10px or 12px gap, nine reset a list the same way, and four views built the same row (picture, name, a line under it, an amount or a button) with their own classes.

Each view also wrapped its cards in its own body element. `/purse` forgot the gap, so its two cards touched.

## Decision

- `ui/src/tokens.css` has a spacing scale (`--space-2xs` 4px to `--space-6xl` 64px), a type scale (`--text-2xs` 11px to `--text-6xl` 44px, plus `--text-input` at 17px), a corner scale (`--r-xs` to `--r-pill`), and the page rhythm (`--gap-page`, `--gap-section-head`).
  - Any gap, padding, margin, font size or radius of 4px or more is a token.
  - Less than 4px is a hairline or an optical nudge.
  - Geometry tied to a fixed size goes in a `calc()` that names what it measures.
  - Off-scale values moved to the nearest step, rounding up on a tie, so most moved toward more room.
- `ui/src/base.css` has layout primitives that views put in the class list: `stack` (`.tight`, `.cards`, `.start`), `cluster` and `plain-list`. They sit inside `:where()`, so a component's own rule always wins over them, and an empty `stack` or `cluster` takes no room.
- A view's body inside `.page` is a `stack cards`. `.section-title` lives in `base.css`, and a column of cards gives it (or a section that opens with it) the extra room above it. That keeps a heading closer to what it names than to what came before.
- `itemRow` and `itemRows` in `ui/src/ui.ts` draw the list row. The views keep their own class on it (`purse-line`, `shop-order`), so e2e selectors and contextual colors still work.
- Enforcement:
  - `client/src/shared-components.test.ts` fails on a raw size of 4px or more, on a scale token that isn't defined, on an app rule that only restates a primitive, and on a hand-built row.
  - `touchingCards` in `e2e/support.ts` fails `site.spec.ts` when two stacked cards on a resident's main pages are less than 8px apart.

## Consequences

- Spacing and type changed by a pixel or two across the site, mostly toward more room: 10px gaps are 12px, 14px padding is 16px, and 13.5px text is 14px. Page sections are 16px apart, and a section heading gets 32px above it.
- A new view gets consistent spacing by composing classes, without new CSS.
- An unusual size must either use a token or say what it measures in a `calc()`.
- Line heights, font weights and shadows aren't on scales yet. If they drift the way spacing did, give them the same treatment.
