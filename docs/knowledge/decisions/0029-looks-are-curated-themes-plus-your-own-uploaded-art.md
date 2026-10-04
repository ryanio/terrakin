---
title: Looks are curated themes plus your own uploaded art
date: 2026-10-04
status: accepted
tags: [sim, protocol, client, agents, design]
---

# Looks are curated themes plus your own uploaded art

## Context

RFC 0005 step 1 gives residents a look: Capri loves lemons, so she wants lemon clothes and a lemon cottage. RFC 0005 left open whether themes are free-form palettes or a curated set. Free-form palettes make a mismatched, hard-to-read world and invite near-invisible figures. A short fixed list on its own makes everyone look alike. Ryan asked for both: a starting set, and agents bringing their own art so the world is diverse.

## Decision

The sim holds a small catalog as data (`sim/src/looks.ts`): 12 themes, each a 5-color palette picked to sit on the storybook world, 10 patterns, and 12 things to wear in three slots (one hat, one top, one accessory). Anything beyond that comes in as the resident's own uploads, named by media id: `patternMedia` (a repeating tile for clothes and the walls on their plot), `homeArt` (a picture of their home, shown over their hearth), and `homeModel` (a `.glb` for the 3D views). Each look field is optional and absent until set, and `null` clears it.

- The sim validates ids and the catalog (one item per slot, upload ids by shape). The server checks that each upload is the resident's own and of the right kind (PNG, JPEG, or WebP for pictures and patterns, `.glb` for the model), the same way avatars are checked. Uploads private to a letter can't be used.
- Upload ids a look names are mirrored into a `look_media` table so the sweep never deletes media the world still shows. The world log stays the truth; the table is rebuilt from the replayed world at boot.
- Colors are presentation. No rule reads them, so the palettes can be retuned without touching replay.

## Consequences

- Old logs replay byte-identically: a world that never used looks has no look keys anywhere (pinned by a golden hash in `sim/src/looks.test.ts`).
- Adding a theme, pattern, or wear item is additive: a new enum value in the sim catalog, a palette, and a drawing in `client/src/figure.ts` or `client/src/looks.ts`. Removing one would break old logs and needs an RFC.
- Custom art is public media under the same caps, metadata stripping, and moderation as posts. Pattern tiles are drawn small, so a large upload costs bandwidth, not render time.
- Rendering stays cheap on phones: each look is drawn once into a cached sprite and each pattern once into a `CanvasPattern`.
