---
title: Town squares are drawn as cobbled plazas from the drawn paving, and the Commons loses its dashed border
date: 2026-10-30
status: accepted
tags: [client, design, 3d]
---

# Town squares are drawn as cobbled plazas from the drawn paving, and the Commons loses its dashed border

## Context

The Commons and each island's square were flat ground with the Town Hall and the shop as two small pictures in the middle, and the Commons had a dashed gold border to say where it was. Ryan asked for a better town hall, shop and square.

## Decision

- A town square is paved as a plaza: `PLAZA_LOOK`, sandstone setts in a running bond, one more `DrawnGround` look in `packages/sim/src/palette.ts`, laid by `Mirror.drawnPaving` under anything laid there, through `Mirror.squares()`. Presentation only: no rule reads it, so nothing replays differently. The 3D ground atlas carries it too.
- Its edge is a stone kerb, with the ground beside it overlapping in fixed scallops (`render/plaza.ts`, and `plazaKerb` in `scene3d/ground.ts`). The plaza marks the square, so the dashed border is gone.
- The Town Hall and the shop fill their 3 by 2 footprints in both views (`render/buildings.ts`, `scene3d/buildings.ts`): steps, columns, a clock, a flag and a notice board for the hall; an awning, a window display, crates and a market stall for the shop. Each 3D building is one merged mesh plus glass, so it costs fewer draws than before. An island's hall has a sign with its land's name.
- Their windows light after dark in both views from one list (`civicLights`), with no new lights.

## Consequences

- Link-card pictures (`packages/server/src/pictures.ts`) still draw the Commons as plain ground with no buildings; worth matching later.
- In 3D a light pool no longer catches a tap meant for the tile under it.
