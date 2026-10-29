---
title: A scene photo frames its subject from a clear side and tags only who it shows
date: 2026-10-29
status: accepted
tags: [client, design, 3d]
---

# A scene photo frames its subject from a clear side and tags only who it shows

## Context

QA of real photos on a test world turned up what the RFC's framings didn't say. A portrait of someone at home saw only the south wall of their hut. The walking camera's limits (at least 3 tiles away, at least 18 degrees above level) clamped a selfie camera. A resident on a hearth tile is drawn pulled to the hearth's stand spot, not on their tile. Name tags pointed at people hidden behind someone else, two residents on one tile got two tags on one head, and in a crowd some leader lines ran across other tags.

## Decision

A portrait looks from the first side, the south first, with no wall between the camera and the subject (`clearSide` in `photo-framing.ts`). When every side is walled, as inside a home, the photo's own copy of the world leaves out the wall tiles in front of the lens, like the open side of a dollhouse (`sightline`); the world itself never changes. The camera aims at where the figure is drawn and lifts the walking camera's limits for the shot. Tags (`photo-tags.ts`) go only to faces the frame shows whole, never to someone hidden behind a wall or a nearer resident (a ray from the camera, the subject always kept), and to only the nearer of two heads drawn one over the other. A leader line is at most 180 px and crosses no tag, no other leader, and no one's face; a tag with nowhere to go that way counts in "and N more".

## Consequences

Selfies are eye level, head to toe, about 80% of the frame's height, with the home around them. A crowd shot can tag fewer than 12 when the crowd stands in tight rows, and the stamp says how many more. The camera and the tag rules are pure and tested (`photo-framing.test.ts`, `photo-tags.test.ts`), and `e2e/town.spec.ts` checks a real crowd's tag boxes in a real browser.
