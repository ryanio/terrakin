---
title: Prints are drawn motifs from the catalog, because a card cannot draw an emoji
date: 2026-10-20
status: accepted
tags: [sim, ui, cards, client, design, agents]
---

# Prints are drawn motifs from the catalog, because a card cannot draw an emoji

## Context

Ryan asked for residents who look very different from each other, with patterns of their own: a
lemon print, say, and he wondered whether we could accept emoji.

Nine geometric patterns existed, each a small tile of two motifs merged into any garment
([decision 0053](0053-any-garment-can-carry-its-own-pattern-and-color-with-bottoms.md)), so
everyone's clothes read much the same from across the map. Emoji would have been the cheap way to
a much bigger vocabulary, so the question was measured before anything was designed.

**A garment's pattern reaches a card as path data, not as text.** `figureDrawing` in
`packages/ui/src/figure-svg.ts` records the map's figure into `SvgPen`, which implements the path
commands of a canvas and nothing else: it has no `fillText`. The tiles it records become a
`DrawTile` of path strings, and `drawingSvg` in `packages/cards/src/drawing.ts` takes a `d`
attribute of commands and numbers or draws nothing. So an emoji would have to arrive as outlines,
from a font read at the moment the tile is recorded.

**That recording happens in the main Worker.** `packages/server/src/pictures.ts` and
`plot-photo.ts` import `@terrakin/ui/figure-svg`, so the font and the glyph reader would land in
the Worker that answers every page request, not in the cards Worker.
[Decision 0299](0299-card-drawing-moves-to-a-worker-of-its-own-reached-over-a-ser.md) emptied that
Worker for exactly this reason: 7,598.88 KiB and 535 ms of startup became 4,105.55 KiB when the
3,485.92 KiB card stack moved out. A dry run today measures its bundle at 4,158,045 bytes, so the
win is still there to lose.

**The colour would not survive anyway.** Measured, not assumed: in every colour emoji font the base
glyph has no outline. Noto Color Emoji's `u1F34B` has 0 contours (its picture is in COLR/CPAL
layers and an `SVG ` table), and Twemoji Mozilla's has 0 contours (COLRv0 layers). satori reads the
base outline. Rendering `a🍋b` through this repo's own satori 0.32 and resvg 2.6.2 gave a blank gap
where the lemon should be, with both fonts. Monochrome Noto Emoji does draw, because it has real
`glyf` outlines, but it draws a flat one-colour silhouette, which is not a lemon print.

**Size turned out not to be the deciding number.** The whole Noto Color Emoji WOFF is 7,358,636
bytes, more than twice everything the cards Worker carries, but subsetting to 31 emoji costs
111,920 bytes in colour, 14,672 monochrome, and opentype.js is 171,001 bytes minified. A subset
would have fitted. It would still have drawn nothing.

The remaining way to get emoji on screen is `fillText` in the browser with whatever emoji font the
device has. Then the lemon on an iPhone is Apple's, the lemon on an Android is Google's, and the
lemon on a link card is absent. A resident would not look like themselves anywhere.

## Decision

No emoji. A pattern can instead be a **print**: one named thing from the catalog, scattered through
the tile at mixed sizes, drawn by us as shapes. `PRINTS` in `packages/sim/src/looks.ts` holds the
eight (`lemons`, `cherries`, `mushrooms`, `cats`, `fish`, `moons`, `clouds`, `bees`) and they go on
the end of `PATTERNS`, so a print is a pattern everywhere a pattern already works: the outfit, a
garment's `wearStyle`, the map figure, both 3D views, link cards, plot photos, and pictures by
link.

A print's shapes are in `MOTIFS` in `packages/ui/src/looks.ts` beside the geometrics and are
painted by `paintMotif`, in the theme's own palette roles like every other motif, so a lemon on an
ocean theme is a blue lemon the way a citrus slice already is. The look editor shows them in a row
of their own under the geometrics.

Because the catalog names them, nothing a resident typed ever becomes a pattern, so there is no new
surface for `packages/server/src/moderation.ts` to filter and root rule 6 is met by construction
rather than by a check.

## Consequences

- A resident picks from eighteen patterns rather than nine, each one usable per garment and in any
  of eight colours, which is what "look very different" needed.
- A print costs one entry in `PRINTS`, one entry in `PATTERN_LABELS`, one in `PATTERN_WORDS`, one
  `Motif` kind with its painter, and one `MOTIFS` tile. Nothing else: every view reads the catalog.
- A motif painter may **fill and stroke only, never clip**. A tile is recorded by a pen of its own
  and `figure-svg.ts` keeps only that pen's `shapes`, not its clip paths, so a clip inside a tile
  would point at nothing on a card. `packages/server/src/pictures.test.ts` checks every print's
  tiles for it, and that every tile shape survives `drawingSvg`.
- Every motif still has to sit inside its tile, which `packages/client/src/looks.test.ts` checks
  over the whole of `PATTERNS`, so a print that bled would seam on a garment.
- New prints go on the end of `PRINTS` and so on the end of `PATTERNS`, because older wear lists
  and garment styles have to keep hashing the same. No accepted old input could name one, so
  existing logs replay unchanged and `REPLAY_VERSION` does not move.
- The emoji question is settled by the renderer, not by the budget, so it reopens only if satori
  learns COLR, or if card drawing stops going through satori. A subset font alone would not change
  the answer.
- Resident art is still the way to wear something the catalog does not have: `patternMedia` takes
  an uploaded tile and `own` puts it on a garment
  ([decision 0029](0029-looks-are-curated-themes-plus-your-own-uploaded-art.md)).
