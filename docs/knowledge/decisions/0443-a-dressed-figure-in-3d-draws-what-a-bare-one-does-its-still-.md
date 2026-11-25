---
title: A dressed figure in 3D draws what a bare one does, its still wear merged into the body and head
date: 2026-11-25
status: accepted
tags: [client, performance, 3d]
---

# A dressed figure in 3D draws what a bare one does, its still wear merged into the body and head

## Context

[Decision 0060](0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md) holds the 3D world to 300 draw calls and 150,000 triangles a frame, shadow pass included, with up to 24 residents in view (`MAX_FIGURES`). Its numbers were measured with plain residents. Dressed, each worn piece was a mesh of its own (a straw hat is three, sneakers four) and hair one more, so a dressed figure cost about 20 draws against a bare one's 8. With 24 dressed residents at the Commons on a 390 by 844 page, a frame drew 517 calls.

Triangles were not the problem: the same frame drew about 128,500. Figures in the world already cast blob shadows only, so the shadow pass draws none of them.

We weighed raising the budget against cutting the draws. Merging cuts them without changing how a figure looks, so the budget stays.

## Decision

`figure()` in [`packages/client/src/scene3d/figure.ts`](../../../packages/client/src/scene3d/figure.ts) sorts what `wearGroup` builds (`sortWear`). A piece in one flat matte color (no pattern, no glow, nothing see-through) is painted that color per vertex and merged: into the torso's mesh when it stays on the body, or into the head's when it turns with it (hats, glasses, the bow). The head's mesh also takes the skin and the hair (`hairGeometry` in `hair.ts`), the hair's triangles added both ways round so its insides still show through the face and under a brim, as the two-sided material did.

What can't merge keeps its own mesh: patterned or glowing wear, and an umbrella, whose open and rolled-up halves each merge into one mesh so only one draws. Two-sided plain pieces (bat wings, the sash) merge into one two-sided mesh. The right arm, the eyes, the cheeks, the outline, the blob shadow and the name tag stay as they were, since each moves, fades or blinks on its own.

So a figure is 8 draws (blob shadow, body, outline, head, right arm, eyes, cheeks, name tag) dressed or bare, plus one for each patterned or glowing piece. `scene3d.test.ts` counts them.

## Consequences

- With the same 24 dressed residents at the Commons, a frame draws 243 calls and about 136,000 triangles, against 517 and 128,500 before, on software WebGL (SwiftShader) in headless Chromium. The frame rate there went from about 11 to 15 frames a second. Hair drawn both ways round is the 7,500 extra triangles.
- A lineup of six dressed figures rendered with the old code and the new matches pixel for pixel. Someone away, asleep at home, is faded once per piece now; before, a material shared by several meshes (a scarf's ring and tail, the parts of the glasses) was faded once per mesh, so it came out paler than the rest.
- A figure on a floor the view cuts away (`fadeFigure`) is one see-through mesh where it was several, so at 30% opacity what shows through its head (the back of the hair and the hat) can draw in a slightly different order.
- Each figure's merged geometry is its own, built once per look; the world already rebuilds a figure when its look changes.
- Still to try if a crowd grows past this: one instanced draw for every blob shadow, and fewer name tags past some distance.
