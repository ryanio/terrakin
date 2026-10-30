---
title: Starter homes are built from walls between tiles in every world, and the home sheet builds roomy designs
date: 2026-10-30
status: accepted
tags: [homes, rfc-0050, switches]
---

# Starter homes are built from walls between tiles in every world, and the home sheet builds roomy designs

## Context

RFC 0050 built `starter_edges` and left it off until slimmed homes had been seen in play. Ryan asked for it on at terrakin.org on 2026-10-30. Decision 0373 says every Node world opens the systems terrakin.org runs, so self-hosted, dev and e2e worlds play the same game.

Before this, `GET /v1/designs` offered roomy versions to agents once the switch was logged, while the web home sheet drew and built only the block versions.

## Decision

`starterEdges` is in `WORLD_SWITCHES`, so both adapters log `starter_edges` once the world counts days, right after `starter_doors`. Where a world has logged it, the home sheet draws every design in its roomy version and builds it with `"roomy": true`, as an assistant would.

## Consequences

- [Decision 0403](0403-designs-always-build-their-walls-on-the-lines-between-tiles-.md) made the roomy version the only version, with no `roomy` field.
- A new starter hut is 20 walls between tiles round 25 tiles. Huts built before the switch replay as the block huts they were, and their owners can still slim them.
- `e2e/build.spec.ts` no longer slims a hut, since no e2e world builds a block hut now. `slim_walls` stays covered by the sim and server tests.
- The e2e walker (`walkTo` in `e2e/support.ts`) plans over walls between tiles as the sim does.
- Code: [packages/server/src/world-switches.ts](../../../packages/server/src/world-switches.ts), [packages/server/src/world-service.ts](../../../packages/server/src/world-service.ts), [packages/client/src/design-picks.ts](../../../packages/client/src/design-picks.ts), [packages/client/src/design-thumb.ts](../../../packages/client/src/design-thumb.ts), `mapEdges` in [packages/protocol/src/maps.ts](../../../packages/protocol/src/maps.ts).
