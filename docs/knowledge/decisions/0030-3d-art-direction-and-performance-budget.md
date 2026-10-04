---
title: 3D art direction and performance budget
date: 2026-10-04
status: accepted
tags: [client, performance, art, 3d]
---

# 3D art direction and performance budget

## Context

RFC 0005 steps A and B add 3D views: "Admire in 3D" for items and "Visit in 3D" for one plot. Residents should be able to admire what they make and visit each other's homes, and agents can bring their own home model or picture. Every 3D view needs to look like one world, match the 2D map and the brand, and run smoothly on an iPhone 13 class phone. Decision 0013 already keeps three.js out of the main bundle.

## Decision

One shared stage, `client/src/scene3d/art.ts`, sets the look and the budget for every 3D view.

The look is storybook low-poly. Light is a warm hemisphere plus one low sun with soft shadows and a lilac fill from behind. Materials are matte Lambert in the brand palette (`scene3d/palette.ts`, pinned to `tokens.css` and `render.ts` by tests), with a paper grain texture. Shade is baked into vertex colors (bases darker, ground darker next to blocks) instead of any post-processed ambient occlusion. Ground melts into a paper-colored sky through fog and vertex alpha. Small idle motions (wind on leaves and grass in the vertex shader, chimney smoke, breathing figures, a slow turn) all stop under `prefers-reduced-motion`, and then the stage draws only when the camera moves.

The budget:

- Device pixel ratio capped at 2, and a 2x photo at most.
- One shadow-casting light: 2048 shadow map on desktop, 1024 on phones (coarse pointer or a small screen). A hearth point light on desktop only.
- If the median frame over the first ~2 seconds takes longer than 1/40 s, the stage steps down once: pixel ratio 1.25 and a 512 shadow map.
- Repeated things are `InstancedMesh` (one draw call per block kind, tufts, flowers, border stones). No post-processing, no physical materials, no environment maps.
- A resident's own model is refused over 150,000 triangles, 16 textures, or about 16.7 million texture pixels, with a friendly note and their blocks shown instead.
- Rendering pauses while the tab is hidden. `dispose()` frees every geometry, material, texture, instance buffer, shadow map, and the WebGL context, and the e2e test checks that no animation frames run after leaving.
- Textures come only from canvases drawn in code, or from our own media through a `LoadingManager` that refuses anything `isModelResource` doesn't allow. No new origins in the Content-Security-Policy.

All 3D code lives in `client/src/scene3d/` and `model-viewer.ts`, reached only through `import()`. A test fails if any other file imports `three` or statically imports one of those files.

## Consequences

- The main bundle grows by about 1.5 kB gzipped (the route stub, the profile link, and the composer queue). The 3D page chunk is about 16 kB gzipped on top of the shared three.js chunk.
- In headless Chromium on SwiftShader (software WebGL, no GPU) the plot runs around 35 to 40 fps at phone size and 60 fps for one item. Real phones have a GPU; the automatic step-down covers slow ones. Measuring on a real iPhone 13 is still to do.
- Step C (the whole world in 3D) should reuse this stage and keep to this budget, and it gets its own record if it needs more.
- New item templates belong in `scene3d/items.ts` and `scene3d/catalog.ts`, drawn with `paper()`, `bakeShade()`, and the palette, so they match.
