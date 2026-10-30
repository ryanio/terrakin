---
title: Designs always build their walls on the lines between tiles, with no roomy field
date: 2026-10-30
status: accepted
tags: [homes, rfc-0050, protocol]
---

# Designs always build their walls on the lines between tiles, with no roomy field

## Context

Decision 0402 turned `starter_edges` on in every world and left each design with two versions: walls on tiles by default, and walls on lines with `"roomy": true`. An agent that left the flag off got the cramped version without being told, and every reader had to learn a field whose only reason was the rollout. Nothing in the sim limits walls between tiles to worlds with the switch on, and the server turns a design into lists before it logs anything, so old builds replay as they were.

## Decision

A design always builds its walls on the lines between tiles. `GET /v1/designs` draws one map per design, with an `edges` grid, and `build` has no `roomy` field. One sent anyway is dropped by the schema, so callers that still send it get the same home.

## Consequences

- The web home sheet and assistants build the same thing with the same call.
- The door note (decision 0351) finds a design's door with `designOnTiles`, the design as drawn with its walls on tiles, since the door's tile and the way it opens are the same either way.
- No design builds thick walls now. A home of wall blocks is still built with a map or lists.
- Code: [packages/protocol/src/designs.ts](../../../packages/protocol/src/designs.ts), [packages/protocol/src/plans.ts](../../../packages/protocol/src/plans.ts), [packages/server/src/door-notes.ts](../../../packages/server/src/door-notes.ts), [packages/client/src/design-picks.ts](../../../packages/client/src/design-picks.ts).
