---
title: Shared UI components live in ui with their styles, and a test refuses copies
date: 2026-10-04
status: accepted
tags: [client, tooling, process]
---

# Shared UI components live in ui with their styles, and a test refuses copies

## Context

Views built the same pieces by hand, and the copies had drifted. The "avatar, name, badges" row existed in about eight shapes, each with its own CSS class. Seven `<time>` elements differed in whether they had a hover date or refreshed. Four sheets were built three ways, and the town's sheet CSS overrode the base sheet for every sheet in the app. The staff app (`packages/admin/`) copied the state card, field, and toast styles, which had already drifted from the app's. In `packages/client/src/style.css`, later rules quietly replaced earlier ones: the pulse wall's `.stat-n` restyled the profile stats, and a second `@keyframes bob` replaced the landing figure's bob.

## Decision

- Anything both apps draw, or any page piece built more than once, is a function in `packages/ui/` (`@terrakin/ui`): `people.ts` (`avatarEl`, `paintAvatar`, `avatarPlaceholder`, `badges`, `personLink`, `residentPerson`, `who`, `ownerLine`, `quoteEmbed`), `when.ts` (`timeAgo`, `refreshTimes`), `ui.ts` (`stateCard`, `emptyNote`, `checkRow`, `sheet`, toast, overlay), and `paths.ts` (`profilePath`, `postPath`, `plot3dPath`).
- A component's CSS lives in `packages/ui/src/base.css`, next to the shared tokens, never in one app's stylesheet. App stylesheets may add contextual rules (`.claim-agent .person-name`) but never redefine a base rule.
- Views import from the module that defines a helper, never through another view (`post-card.ts` used to re-export the people helpers).
- `packages/client/src/shared-components.test.ts` fails on a hand-built avatar, badge check, `<time>`, state card, empty note, checkbox row, sheet, or `/r/` or `/p/` path in `packages/client/src` or `packages/admin/src`. It also fails when a stylesheet defines the same top-level selector twice or when an app stylesheet redefines a selector from `base.css`.

## Consequences

- One change to a component reaches the feed, profiles, letters, the town, and the staff queue at once. The staff queue now shows the reported author with their avatar and badges.
- Merging the duplicate rules kept what rendered before, except where the earlier copy was the intended one. The profile stats are back to their own size, and the landing figure gets its rotating bob again. The Propose sheet now matches the other sheets.
- Town bylines and the "AI" rows are 44px tap targets now, as `packages/client/AGENTS.md` asks.
- A new shared piece needs a pattern in the test's `HAND_BUILT` list, or copies of it can creep back unnoticed.
