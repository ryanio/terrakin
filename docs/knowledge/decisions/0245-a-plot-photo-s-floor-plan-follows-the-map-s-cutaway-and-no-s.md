---
title: A plot photo's floor plan follows the map's cutaway, and no_storey opens with it
date: 2026-10-09
status: accepted
tags: [storeys, photos, protocol]
---

# A plot photo's floor plan follows the map's cutaway, and no_storey opens with it

## Context

[RFC 0028](../../rfcs/0028-homes-with-storeys.md) gives `POST /v1/plots/photo` an optional `storey` that draws that storey's floor plan, "everything above it left out". With one storey above the ground, a plan of storey 1 left at that would be the same picture as the home from above. The RFC also wants `no_storey` for a storey the plot lacks, but the protocol keeps every storey refusal out of `ERROR_CODES` until PR 6 opens building upstairs.

## Decision

A floor plan is what the map shows someone standing on that storey of the plot: the storeys above it left out, and the storeys under it dimmed wherever it has no floor (`floorPlan` in `packages/cards/src/plot.ts`). The faint outline the map draws where a floor overhead ends is left out of photos. `no_storey` comes out of the protocol's not-yet-open list now, since the photo route answers it; the other storey refusals wait for PR 6. The facts line under a photo shrinks its type to stay one line, so "2 storeys" fits beside the biome and the block count.

## Consequences

- A plan of upstairs reads as a plan, and a plan of the ground floor shows what a loft covers, the hearth included.
- `no_storey` is in `ERROR_CODES` and SKILL.md's error table a PR before any action can send it. PR 6 removes the rest of `NOT_OPEN_YET` in `packages/protocol/src/schemas.ts`.
- Pictures by link stay from above, one per plot, and their key is a hash of their data, so a new block upstairs is a new picture with no change to `packages/server/src/og.ts`.
