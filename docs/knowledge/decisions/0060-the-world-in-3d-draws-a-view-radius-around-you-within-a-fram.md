---
title: The world in 3D draws a view radius around you within a frame budget, and 2D stays the default
date: 2026-10-05
status: accepted
tags: [client, performance, 3d, design]
---

# The world in 3D draws a view radius around you within a frame budget, and 2D stays the default

## Context

[RFC 0005](../../rfcs/0005-make-show-and-give.md) step C is the whole world in 3D, with the camera following you, the 2D map staying the default on low-end phones, and both drawing the same mirror. [Decision 0030](0030-3d-art-direction-and-performance-budget.md) set the look and the budget for one plot or one item, and said step C gets its own record if it needs more. The world is a different load: it's 72 by 72 tiles today and grows with the config, residents walk through it, and the scene has to keep up with every event the socket sends.

## Decision

The 3D world is a second renderer of the same mirror. `client/src/world.ts` keeps the connection, walking, and every action; `client/src/scene3d/world.ts` only draws, and hands a tap back as a tile, so a tap in 3D sends what the same tap on the map sends. Blocks, plot borders, grass, hearths, and figures come from the plot view's builders in `scene3d/plot.ts`; the Town Hall and the shop are new models in `scene3d/buildings.ts`. The scene code and three.js load through `import()` the first time someone turns 3D on, so the 2D path pays nothing.

**What is drawn around you** (`scene3d/world-layout.ts`):

| Number | Value |
|---|---|
| View radius | 12 tiles (Chebyshev, like reach); fog closes in at its edge |
| Chunk | one plot (8 by 8 tiles today), built with the plot builders, freed once none of it is within 16 tiles of you |
| Chunks built per frame | at most 2, so walking into new ground never hitches |
| Residents drawn | the 24 nearest online, you always first |
| Ground | one mesh 41 tiles across, moved in 4-tile steps |

**The frame budget**, for an iPhone 13 class phone at 390 by 844:

| Measure | Budget | Measured |
|---|---|---|
| Frame time | 60 fps target; step down once past 25 ms (decision 0030's rule) | 22 to 28 fps on SwiftShader, Chromium's software WebGL with no GPU |
| Draw calls per frame, shadow pass included | 300 | 88 in a street of homes, 267 with 23 residents in view |
| Triangles per frame, shadow pass included | 150,000 | 83,000 to 103,000 |
| Texture memory, not counting the drawing buffer | 16 MB | about 7 MB by estimate: the 1024 shadow map (4 MB), one grain, plank, stone, and hearth glow texture shared by every plot, and a name tag per figure (about 100 kB each); up to about 13 MB with what's on display (below) |

**What's on display** (`scene3d/displays.ts`, shared with the plot view): a piece's picture is cropped and scaled to 256 by 192 once (about 260 kB with mipmaps), every display of the same thing shares one texture, at most 16 pictures are held at a time (about 4 MB; past that a piece shows its drawn picture), and a texture is freed with the last plot that shows it. Drawn pictures of made things are 128 pixels square (160 by 120 on paper in a frame), one per kind. At the very worst, 16 different pictures and every kind of made thing in view, the estimate is about 13 MB. A model piece shows its drawn picture in a frame, not its model. Crops in planters are about 100 triangles each, in one draw per plot for the plants and one for ripe fruit.

Figures in the world cast blob shadows only, since a real shadow per figure doubles its draws. Hearths have no point light, because a light coming into view recompiles every material. The rest of decision 0030 holds: pixel ratio capped at 2, one shadow-casting sun (it follows you and covers the view radius), Lambert paper materials, instancing, no post-processing.

**When 3D is offered.** The map is the default everywhere. The "3D view" toggle, just above the d-pad where a thumb reaches it, shows when the browser has WebGL 2 and the device isn't low end: under 4 GB of memory (`navigator.deviceMemory`, where the browser reports it), under 4 cores, or Save-Data on. The choice is remembered on the device (`terrakin.worldMode` in localStorage) and the world reopens in 3D next time, if 3D is still offered (`client/src/world-mode.ts`).

**How it falls back.** If frames still take longer than 1/15 s (the median over about two seconds) after the stage has stepped down, or the scene code fails to load, the world goes back to the map with a short note and remembers the map for this device. If the WebGL context is lost (a phone can reclaim it while the app is in the background), it goes back to the map for this visit only. Turning 3D back on is one tap.

**Input in 3D.** The camera orbits around you, so in 3D the d-pad and the arrow keys (and WASD) walk relative to it: up is away from the camera, snapped to the nearest of the four directions (`cameraQuarter` and `turnDir` in `scene3d/world-layout.ts`; exactly 45 degrees off takes the clockwise one). A held key follows the camera as it turns. Each button's label names the direction it walks now, and the hub shows a small needle pointing north. Only the input turns: `move` still sends n, e, s, or w, and the map keeps up as north.

**Motion and leaving.** With `prefers-reduced-motion`, figures and the camera jump to their tile instead of gliding, idle motion stops, and the stage draws only when something changes. Rendering pauses while the tab is hidden, and leaving the world, turning 3D off, or falling back frees the whole scene and the WebGL context.

## Consequences

- The main bundle doesn't grow (about 144 kB gzipped before, 143 kB after, as the build splits a few shared helpers differently), and three.js stays in its own chunk. The world chunk grows by about 0.2 kB gzipped for the toggle; the 3D world chunk is about 6 kB gzipped on top of three.js and the shared plot builders.
- The plot builders now take an origin instead of a whole plot layout, and the stage has scopes (`scoped` in `scene3d/art.ts`) so a chunk or a figure can stop its own animations when it leaves. Planters, kitchens, workbenches, and pedestals are drawn in 3D now, as plain voxels, in the plot view too.
- The measured numbers are from headless Chromium. Measuring on a real mid-range phone is still to do, and if it runs under budget the view radius is the first number to raise.
- A resident's own home model and day and night are drawn on the map but not yet in the 3D world. Crops in planters and what's on display are drawn in both 3D views.
