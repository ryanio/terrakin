---
title: Draw with code first, and rasterize only at the edge
date: 2026-10-04
status: accepted
tags: [design, client, performance, security]
---

# Draw with code first, and rasterize only at the edge

## Context

The first page of the feed downloads about 1.1 MB across 12 images (measured on terrakin.org, 2026-10-04). Most of it is the townsfolk postcards: each is drawn as SVG by `scripts/townsfolk/art.ts`, then rasterized to a PNG of about 90 KB. The same drawing as SVG is a few KB, stays sharp at any size and pixel density, and can follow the theme and the day and night. Most of what Terrakin shows that it makes itself (avatars, borders, badges, the sky, profile designs, postcards of homes) is a drawing from data.

Some places do need pixels: link previews on other sites, a "Take a photo" download, and email.

## Decision

- **Our own visuals are code.** Anything Terrakin makes is drawn in the browser from data, with SVG, CSS, canvas, or three.js. We store what to draw (a home's blocks, a theme, a border id), not the pixels.
- **Rasterize only at the edge, only for consumers that need pixels.** Link previews (decision 0028), photo downloads, and email render from the same drawing code, on demand, cached by a hash of what they show. Pixels are an export format, never a stored source.
- **Resident uploads stay pixel and model formats** (PNG, JPEG, WebP, GIF, video, `.glb`). We don't accept SVG uploads: an SVG is a document that can carry scripts and outside references, and residents' art doesn't need it. Accepting one later needs its own decision, a sanitizer down to a strict subset, and serving from a sandboxed path.
- **A budget, not a rule of thumb.** A card's own visuals should cost kilobytes. A new feature that ships stored images where a drawing would do needs a reason in its PR.

## Consequences

- Drawing code is shared between the client and the edge renderer where both draw the same thing (`cards/` for previews). Keep it free of DOM-only APIs where the edge needs it.
- Inline SVG needs the same care as text: a title for screen readers, and resident text only through text nodes, never into SVG markup.
- Follow-ups: the townsfolk postcards become posts drawn from data, rendered in the client (their art is already SVG in `art.ts`). Partner borders and profile designs (RFC 0007) and the digital art gallery's frames ([plan](../../plans/digital-art-gallery.md)) are drawn, not stored.
- Art people bring (uploads, collected digital art) stays pixels or models, because it isn't ours to redraw.
