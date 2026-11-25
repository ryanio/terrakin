---
title: Residents in 3D are beans with an outline
date: 2026-11-24
status: accepted
tags: [client, art, 3d]
---

# Residents in 3D are beans with an outline

## Context

The 3D resident was a peg: a ball for the body in the outfit's color and a ball for the head in their own, with dot eyes and a nose. It read at a distance, but the two balls looked like they floated apart and the face was flat ink. Ryan compared five directions side by side (today's peg, a bean, a big-headed plush, a carved wooden doll, and a faceted low-poly peg) and picked the bean.

Two things limited the change. Every hat, pair of glasses, hair style and garment is sized for a head of 0.17 at y 0.66 and a body about 0.255 across, and the world draws up to 24 residents within decision 0060's budget of 300 draw calls.

## Decision

A resident in 3D is one soft bean, turned on a lathe: wide at the hips, narrowing up into the head so the two read as one shape, in the outfit's color up to the collar and their own color above it. It has stubby arms (the right one swings up to wave), dark feet that step aside for worn footwear, tall eyes with a catch light, and a warm brown outline drawn as a pushed-out copy of the body behind it. The square and diamond shapes are the same bean, pushed toward a soft square or turned with four sides.

The head stays a sphere of 0.17 at y 0.66 and the body keeps the peg's width, so hats, hair and most wear fit as they were. What lies on the front (an apron, the overalls' bib), shoes, and straps round the body follow the bean's curve. A neutral figure is still six draws: the body (side, feet and left arm merged and colored per vertex), the outline (the head's included, since a sphere turning about its middle never moves), the head, the right arm, both eyes in one mesh, and both cheeks in one mesh. Materials stay matte Lambert (decision 0030); there is no toon shading or post-processing.

## Consequences

- Code: `figure()` and `faceParts()` in [`packages/client/src/scene3d/figure.ts`](../../../packages/client/src/scene3d/figure.ts), and the side's profile, `BEAN` and `beanAt`, in [`bean.ts`](../../../packages/client/src/scene3d/bean.ts), which `wear.ts` also reads so an apron or a bib lies on the curve.
- The shoulders' normals turn toward the head's where the side runs into it, so the light shows no crease under the cheeks.
- The nose is gone. Which way someone faces now shows in their eyes, feet and arms.
- The bean's shoulders run up over the lower head, so the mouth sits between the cheeks, laid just over the bean there (`overBean`). A test holds every face part outside the bean's side.
- On a floor the view cuts away the outline hides, so the see-through body stays faint instead of greying.
- About 1,000 more triangles a figure, mostly the outline, and no more draws. With 24 dressed residents in view (the most the world draws) on a phone-sized page, the bean drew 442 calls and 264,000 triangles a frame against the peg's 442 and 238,000, at the same frame time on software WebGL. Both are over decision 0060's 300 calls and 150,000 triangles, which were measured with plain residents: each worn piece and hair style is a draw of its own, and the shadow pass draws it again.
- A garment that lies on the body follows `beanAt`; one that stands clear of it needs no change. Under a ghost sheet the arms hide until one waves.
- The 2D figure (the map, avatars, the look editor, and pictures by link through `figure-svg.ts`) is the same bean drawn flat, in `drawFigure` in [`packages/ui/src/figure.ts`](../../../packages/ui/src/figure.ts): each shape's side (`BODY_SIDE`) runs from where it meets the head (`JOIN`, just under the head's middle) to its base, so body and head read as one shape; the head and every garment keep their sizes. Inside the white rim that keeps a figure readable on any ground, the same warm brown outline goes round the body, the head, the arms and a skirt's flare. Open eyes are tall ovals with a catch light, and the nose is gone here too.
- A top with sleeves (a raincoat, else a cardigan) colors the arms, in 2D and 3D alike (`sleeveColor`).
