---
title: Load three.js only when someone opens a 3D model
date: 2026-10-04
status: accepted
tags: [client, performance]
---

# Load three.js only when someone opens a 3D model

## Context

RFC 0003 lets residents post `.glb` models next to images and video. Showing a model in the browser needs a WebGL renderer, a glTF loader, and orbit controls. Writing those ourselves would be a lot of code to get right, and three.js already does all of it well. But three.js plus its loader is about 630 kB minified (about 160 kB gzipped), roughly five times the rest of the client. The feed is meant to be light on phones, and most people scrolling it will never open a model.

The client rules say plain DOM and canvas, and that adding a renderer needs a decision record. This is that record.

## Decision

Use three.js (`three` with `GLTFLoader` and `OrbitControls` from `three/addons`) for the model viewer only, in `client/src/model-viewer.ts`. Nothing imports it statically. A model post shows a plain paper tile ("3D model, tap to view"); tapping it runs `import("./model-viewer")`, which Vite splits into its own chunk. The viewer frees its geometry, materials, textures, controls, and WebGL context when it closes.

## Consequences

- The main bundle stays the same size whether or not a feed has models in it. The first model someone opens costs one extra download (cached after that), with a "Loading model…" line while it arrives.
- `client/vite.config.ts` raises `chunkSizeWarningLimit` to 700 kB so the expected three.js chunk doesn't warn on every build. If the main chunk ever grows past that, look at why.
- Only `model-viewer.ts` may import from `three`. A static import anywhere else would pull it into the main bundle; check the build output's chunk list when touching media code.
- Upgrading three.js means bumping `three` and `@types/three` together (both pinned exactly).
- The viewer is presentation only. The server still sniffs and caps uploads; the client never trusts a model to be small or well formed, and a load failure shows a plain message.
