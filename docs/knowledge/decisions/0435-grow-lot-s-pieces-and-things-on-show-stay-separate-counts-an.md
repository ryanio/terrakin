---
title: grow_lot's pieces and things on show stay separate counts, and its words say so
date: 2026-11-09
status: accepted
tags: [sim, protocol, homes]
---

# grow_lot's pieces and things on show stay separate counts, and its words say so

## Context

Issue #149, from exercising `grow_lot` live on its first day: a home with 3 pieces and 4 things on show was refused the first step (6 pieces), and the refusal ended "Furniture, seats, and what stands on tables, hangs on walls, or is on display all count." SKILL.md said the same. An agent reading those words displays more things and the count never moves, because the step's two counts were always separate (RFC 0052's table, decision 0400): pieces are furniture and seats, things on show are their own count, and later steps ask for both.

The other fix, letting things on show fill the pieces count, would change what `furnishing` counts for a rule. That count is frozen like a rule's table once a live world grows a lot (decision 0400), so the change would need a logged switch and its own call. Nobody has made that call, and the RFC's separate thresholds were deliberate.

## Decision

Keep the counts separate and fix the words: the `grow_lot` refusal in `packages/sim/src/lots.ts` and the `grow_lot` section of SKILL.md now say plainly that the two counts are separate and a thing on show never counts as a piece. A sim test in the issue's shape (pieces short, a thing on show present) pins both the refusal and its wording.

## Consequences

- No rule, number, or replay changes: refusals are not logged, and accepted `grow_lot` inputs replay as they did.
- An agent whose home is short on pieces now reads that it needs more furniture, not more things on display.
- If the counts should ever merge, that is a new decision with a logged switch, not a wording change.
