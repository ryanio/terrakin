---
title: PRs merged, tall plot photos, stairs and upstairs slims, ways through lines, material grades built
date: 2026-10-30
tags: [photos, walls, ways, rfc-0051, grades]
---

# PRs merged, tall plot photos, stairs and upstairs slims, ways through lines, material grades built

## Done

- Open PRs merged: #127 (attendance at 10 minutes; its decision is now [0407](../decisions/0407-attendance-counts-at-10-minutes-behind-the-attend-at-ten-swi.md)), #133 (red-runs line), and the dependabot bumps #129, #130, #131. Biome 2.6 leaves Markdown and `pnpm-lock.yaml` unformatted, and its Playwright `describe` rule is off for `scripts/`.
- Plot photos are a tall 1080x1350 picture the instant photo fills, on a clear margin, at twice the old detail. A post's card shows a plot photo whole with no second border ([0408](../decisions/0408-a-posted-plot-photo-is-a-1080x1350-picture-of-its-own-drawn-.md)).
- `walk_to` takes stairs: a `floor` field and `up`/`down` legs ([0409](../decisions/0409-walk-to-plans-across-floors-at-stairs-and-its-floor-is-the-g.md)).
- `slim_walls` slims every floor; upstairs a line needs flooring on one side ([0410](../decisions/0410-slimming-plans-every-floor-and-upstairs-a-room-is-only-as-wi.md)).
- The way planner takes down walls on lines between way tiles, and never leaves one it can't take down between a new way tile and the network ([0411](../decisions/0411-the-way-planner-takes-down-a-wall-on-a-line-between-two-way-.md)). The live dry run (`scripts/ways.ts`) finds nothing to lay.
- `openingFactsFrom` reads the snapshot's walls between tiles, so `landlocked.ts`, `ways.ts` and the claim picker see homes shut in by lines. Live: 0 of 66 landlocked.
- Every e2e screenshot is screen-sized but `owner.spec.ts`'s opt-in ones.
- RFC 0051 accepted with every recommended answer, and slices 1 to 4 built: grades in the sim behind `open_grades`, the API, the looks (map, 3D, plot photos, item marks, the build bar's grade chips, graded pickers), and the plots-to-visit and plot-market counts ([0412](../decisions/0412-material-grades-keep-rfc-0051-s-fine-table-and-roll-the-econ.md)). `pnpm persona --open-grades` opens grades on the test world.

## State of things

- `pnpm verify` and `pnpm e2e` are green on main.
- No world has grades. `open_grades` is in no adapter's `WORLD_SWITCHES`; only the loopback test route logs it.
- Not checked live: `walk_to` with stairs and dry-run `cost` on terrakin.org (needs a resident's token), and the 47 owners' `home_slimmed` notices (needs a sign-in).

## Next

1. Decide whether to open grades at terrakin.org (slice 5): add `open_grades` to the Worker's switches. Decision 0412's economy run says fine is scarce (about one fine craft per grader every two months), so first consider fewer finds per fine recipe, which is a new table behind a new switch once live.
2. Look at the fine marks in 3D on a phone and say if they read too dark or too light (joint alpha 0.3 in `GRADE_LOOK`).
3. With a test resident on terrakin.org, try `walk_to` with `"floor": 1, "dry": true` and a dry `shop_buy`, and confirm `route` and `cost`.

## Open questions

- Open grades now, or change the fine table first (Next 1)?
