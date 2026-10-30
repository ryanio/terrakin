---
title: A wall's surface is marks in the sim's palette that the map, the 3D textures and the plot photos all draw
date: 2026-10-30
status: accepted
tags: [art, map, 3d, cards, materials]
---

# A wall's surface is marks in the sim's palette that the map, the 3D textures and the plot photos all draw

## Context

The made materials (RFC 0041) were flat colors in every view, so plaster, brick and timber frame barely read apart, and a home couldn't look like it was built of anything. Three places draw a wall: the map (canvas), the 3D views (three.js textures on boxes), and the plot photos (SVG in the cards Worker, which depends on nothing in the repo). Drawing each surface three times by hand would drift, and the cards package can't import the client's canvas code. Another piece of work will change how walls are shaped, so a surface must not be baked into a box.

## Decision

Each wall kind's surface is data: `WALL_LOOK` in `packages/sim/src/wall-look.ts`, a list of the same marks paths already use (`GroundMark`: rects, circles, ellipses, lines in units of the face). The map paints them over the wall's color with `paintMarks` (`packages/ui/src/ground-art.ts`) into a sprite per size; the 3D views paint them into one 128 px texture per kind (`materialTexture` in `packages/client/src/scene3d/materials.ts`), shared by every plot; the server sends them on each wall of a plot photo (`PlotBlock.marks`) and the cards draw them with `markSvg`, checked like any mark. The free four's marks are see-through shades, so a themed plot's colors stay under them.

## Consequences

- `WALL_LOOK` is a module of its own beside the palette, since the web's first load reads the palette and has no use for wall surfaces; in the palette it cost 0.5 kB of the first load's budget.
- A new made material needs a `WALL_LOOK` entry; the type makes that a compile error until it has one.
- A surface changes in one place and every view follows. Marks stay inside the face, since a plot photo can't clip them.
- The 3D texture carries the wall's color, so those walls are tinted white; the 3D views still don't dress walls in a plot's theme.
- 3D walls cost no more draws (one per kind, as before) and about 0.6 MB of textures at most. A plot photo with 30 walls drew about 4 ms slower.
- When walls change shape, the new shape wears `materialTexture` or calls `paintMarks`; nothing about the surface is tied to the box.
