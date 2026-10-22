---
title: A settle or claim says when it takes a neighbor's last way out or has none of its own, and pickers prefer plots that close nobody in
date: 2026-10-22
status: accepted
tags: [sim, server, client, walking, homes, agents]
---

# A settle or claim says when it takes a neighbor's last way out or has none of its own, and pickers prefer plots that close nobody in

## Context

The first nightly landlocked check ([decision 0351](0351-a-plot-s-way-out-is-a-step-from-its-hearth-s-walk-onto-groun.md)) found 18 of 51 claimed plots on terrakin.org with no way out, 14 of them surrounded: every plot around them is claimed. Those plots got that way at the moment someone claimed the last free slot beside them, and nothing told that person, or their agent, at the time. Build notes say when a plan takes a way out, but a claim changes no tile, so it never reached them.

Refusing such a claim was not on the table. A refusal changes which logged inputs are accepted, so it changes replay, and it takes land away from someone for a neighbor's sake. Free land stays free.

## Decision

A `settle` or `claim`, dry or real, answers with `notes` in the build notes' shape, read before the claim:

- `seals_neighbor` for each claimed plot around it that has a way out now and would have none, with the tiles on the claimed plot that its way out steps onto.
- `no_opening` when the plot would have no way out of its own, worded as `surrounded` or `walled` the way the nightly check says it.
- The first note names the nearest free plot whose claim closes nobody in, at any distance.

The two codes are the build notes' own, since they mean the same thing about a different action, and an agent already reads them. Nothing is refused.

It is computed with the sim's own `openingsOf`, never a second walk (`claimWaysFrom` in `packages/sim/src/openings.ts`). A claim changes no tile, only which slots count as open ground, and `openingsOf` reads that only at the step off a plot. So a neighbor's openings after the claim are its openings now less each step onto this plot, and the plot's own openings are its walk now. Each plot is walked once per question, so a picker can ask of every free slot. "Closes nobody in" (`closesNobodyIn`) counts the claimed plot itself: no neighbor sealed, and a way out of its own.

The pickers prefer such plots only among plots as near: `nearestFreePlot`, which a refusal names (and which moved from `apply.ts` to `openings.ts`); the invite's suggested plots (`suggestPlots` in `packages/server/src/together.ts`), within a ring; the link world page's free plots (`freePlotsNear` in `packages/server/src/links/world.ts`); and the web's claim picker (`plotPicks` in `packages/client/src/plot-picks.ts`), after nearness to a lived-in plot, with a line on any pick that would close a neighbor in or have no way out. Nearness wins because a newcomer landing among neighbors matters more than a tie-break, and the line tells a person what they are choosing.

## Consequences

No logged input or replayed event changes. A refusal's words are never logged, the notes are on the answer only, and every picker's choice reaches the log as a `settle` that carries its own `px` and `py`. Every fixture hash stays and `REPLAY_VERSION` doesn't move ([decision 0070](0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)).

A claim's answer costs a few plot walks more, and a refusal that names a free plot walks the plots around the nearest ones. Both are small next to the rate limit.

The 14 surrounded plots already in the world stay surrounded. This stops the count growing where someone reads the answer; it doesn't fix what is there, which is still the product question decision 0351 left open.
