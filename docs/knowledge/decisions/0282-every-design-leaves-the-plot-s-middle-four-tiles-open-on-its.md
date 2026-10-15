---
title: Every design leaves the plot's middle four tiles open on its path so the hearth goes at the center
date: 2026-10-14
status: accepted
tags: [protocol, agents]
---

# Every design leaves the plot's middle four tiles open on its path so the hearth goes at the center

## Context

A `build` never sets a hearth, and RFC 0032's designs turn four ways. A design's hearth spot would move with each turn, and a hearth set before the build (by `build_starter_home`, at the plot's center) must not end up under a wall or walled in.

## Decision

Every design leaves the plot's middle four tiles open, with its path running through them and out its door to the edge. Whatever the turn, the plot's center tile is open, on the path, and inside the home, so SKILL.md says to set the hearth there, where `build_starter_home` puts it. A design marks it `h`. The test builds every design in every material and every turn on an empty plot with a hearth at the center: nothing is skipped and the notes are empty.

## Consequences

Designs are drawn for 8-tile plots; a world with another size refuses one and takes maps and lists. A new design has to keep the middle open, and the test says which combination broke. Code: `packages/protocol/src/designs.ts`.
