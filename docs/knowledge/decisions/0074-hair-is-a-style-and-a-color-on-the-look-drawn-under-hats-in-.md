---
title: Hair is a style and a color on the look, drawn under hats in 2D and 3D
date: 2026-10-06
status: accepted
tags: [sim, protocol, client, design, agents, 3d]
---

# Hair is a style and a color on the look, drawn under hats in 2D and 3D

## Context

Figures had no hair. Ryan asked for hair styles and hair colors on a resident's look, drawn everywhere a figure is drawn, readable at phone size, with hats sitting over the hair. Looks are sim state ([decision 0029](0029-looks-are-curated-themes-plus-your-own-uploaded-art.md)), so every existing log has to replay to the same hash, and the catalog stays curated: names from our lists, never free text or colors as hex.

## Decision

Two new optional look fields. `hair` is one of ten styles (`short`, `bob`, `long`, `curly`, `bun`, `ponytail`, `braids`, `spiky`, `afro`, `pigtails`), and `hairColor` one of thirteen colors, nine natural and four fun (`pink`, `blue`, `green`, `purple`). Both are absent until set, and absent `hair` means no hair, which is how every figure looked before. `null` clears either, like the other look fields, so there is no `none` style. The look link takes `hair=none` instead, since a link can't send `null`.

They are two fields, not one object, so an agent can change the color without sending the style again, the look link takes them as plain query parameters, and `join` takes them the way it takes `theme`. A color stays while the style is unset, the way a garment keeps its style while it's off, and a style with no color is drawn brown (`DEFAULT_HAIR_COLOR`).

The sim checks both everywhere a look is set, which is `join` and `profile`, and refuses anything outside the catalog with `invalid_profile`. The colors' hex values sit in the catalog beside their labels, presentation only like the theme palettes.

The 2D figure (`ui/src/figure.ts`) draws hair in two layers: what hangs behind the head and body (a bob's back, an afro's puff, a ponytail) before the body, and what sits on the head (the crown, the fringe, braids) after the face. Each style has its own shapes facing front, back, and either side. The straw hat, beret, beanie, and top hat cover the crown: hair above their band and within their reach is clipped away and a bun is tucked under, so nothing pokes through, and longer styles still show below. The flower crown and the halo cover nothing.

The 3D peg (`client/src/scene3d/hair.ts`) builds hair from shells around the head that leave the face open, plus curls, tails, braids, and spikes. A figure's hair is one merged mesh colored per vertex, so it costs one draw call and at most about 1,250 triangles (the afro). Under a covering hat no vertex rises above the hat's band (`HAT_BAND` in `scene3d/layout.ts`, checked by a test). Tall styles lift the name tag a little.

## Consequences

- Old logs replay unchanged. No accepted old input could carry hair, since the server only passes fields the protocol knows, and hair stays absent until set. `sim/src/fixtures/hair-log.ts` pins a log with hair set, recolored, cleared, joined with, and on a resident whose partner wear comes off, and every older fixture hashes as before.
- The protocol change is additive: optional fields on the session request, the `profile` action, the hello message, resident views, `profile_changed`, and profile looks, two new enums, and two query parameters on `/v1/act/<key>/look`.
- Avatars come from the same drawing, so hair shows on profiles, posts, and the top bar. Link preview cards and plot photos don't draw figures, so they are unchanged.
- In the world in 3D, [decision 0060](0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md)'s worst measured case (267 draw calls with 23 residents in view) grows by one draw call per figure with hair, to at most 290 of the 300 budget. If all 24 drawn figures wore an afro, triangles would grow by about 30,000, still under 150,000.
- Adding a style or a color later is additive: an enum value, a label, its 2D shapes in each facing, and its 3D pieces. Removing one would change how old logs replay and needs an RFC.
- Code: `HAIR_STYLES`, `HAIR_COLORS`, and `HAIR_COLOR_INFO` in `sim/src/looks.ts`, `mergeLook` in `sim/src/apply.ts`, `HairStyle` and `HairColor` in `protocol/src/schemas.ts`, `linkLook` in `server/src/links.ts`, `hairOf` and `hairParts` in `ui/src/figure.ts`, `hairName` in `ui/src/looks.ts`, `client/src/scene3d/hair.ts`, and the Hair section of `client/src/look-editor.ts`.
