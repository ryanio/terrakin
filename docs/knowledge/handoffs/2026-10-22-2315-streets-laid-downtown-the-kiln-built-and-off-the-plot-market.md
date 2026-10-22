---
title: Streets laid downtown, the kiln built and off, the plot market's web in flight, and the Sunday hour read from the world
date: 2026-10-22
tags: [streets, ways, pottery, plot-market, playtest, staff, agents]
---

# Streets laid downtown, the kiln built and off, the plot market's web in flight, and the Sunday hour read from the world

## Done

- **Streets and public ways ([RFC 0046](../../rfcs/0046-streets.md), decisions 0356 to 0359).** New lands are laid out with street slots, the first island as the long cross, and no land opens without streets. Downtown's public ways were laid at terrakin.org through `POST /v1/admin/ways`: 380 tiles (126 on 21 residents' plots, 61 on 6 townsfolk plots, 193 on free slots), 4 blocks given back, one home given a door. Landlocked plots went from 18 of 53 to none. The route also closes ways (`close`), dry first.
- **One vocabulary.** Street, public way, exit and open ground, defined side by side in SKILL.md "The world" and the root `AGENTS.md`. One code, `public_ground`, for building on a way or a street and settling on a street. `teach` out of reach is `out_of_reach` with a walk; too-long putter and routine walks are `too_far`.
- **Households are one place for exits and the planner** ([decision 0364](../decisions/0364-one-household-s-touching-plots-are-one-place-for-exits-and-t.md)). With owner pairs counted, it already clears a few plots from the landlocked list today; it can only shorten it.
- **Pickups on a public way** are open to anyone once `open_way_pickups` is logged, which the server logs under the existing `plotPickups` option. A switch, because a gather-all near a way would otherwise replay differently.
- **Every `out_of_reach` names a routed walk**, and a `move` with `steps` that stops short says why (`stopped`), from a report by the AI that runs cocoa.
- **The kiln ([RFC 0047](../../rfcs/0047-trades-and-your-mark.md) phase 1, decision 0362)**, built behind `open_clay`, which no adapter sets.
- **Playtest prep.** `pnpm funnel` reads the newcomer funnel in one command. The Sunday hour (2026-10-25, 19:00 UTC) is the weekly gathering on terrakin.org, read from the world rather than watched ([phase 1](../../plans/phase-1.md#what-we-read)). The check-in's town event line tells an agent how its owner can come in person with a sign-in link. Twenty new characters can join at once from one network ([decision 0355](../decisions/0355-twenty-new-characters-can-join-at-once-from-one-network-so-a.md)).
- **Tests for state that exists only in production.** Every table boots from the shape it first shipped in (`schema-upgrade.test.ts`, `first-tables.ts`), and three pairs that must agree are held by tables the compiler keeps complete.
- **The staff app** opens every screen like the main app's pages and is built from `packages/ui` ([decision 0361](../decisions/0361-staff-screens-open-with-the-main-app-page-head-and-name-thei.md)).
- **One staff key for agents**, maintainer role with the `role` scope, in the `Terrakin maintainer key` item ([docs/staff-agents.md](../../staff-agents.md)).
- Windows and doors in 3D run along the wall beside them, and Add an upstairs comes last in the build bar.
- RFC 0047 (trades beyond the garden, and things that carry your mark) is drafted, and the plot market's web has a plan ([plot-market-web.md](../../plans/plot-market-web.md)).

## State of things

- **The Halloween devlog** (`docs/devlog/2026-10-24.md`) is written and checked on the branch `worktree-agent-acca5be44589ddf4c`, held because `pnpm gen` publishes a post dated in the future at once. Merge it on or after October 24.
- **Pottery is being made worth doing**, still switched off: clay rarer and by water, pots you place at home and a vase that holds a flower, tea a host serves, townsfolk jobs that ask for pottery, a Pottery page in the collection book, and link routes. Ryan's rule: it goes on only once it's fun, judged by a fresh agent playing it cold.
- **The plot market's web is being built, dark**, commits 1 to 10 of the plan, with Ryan's answers: second and third plots only by buying, opened in a push he approves, nothing shown while off, no map sign yet, Go there after a purchase.
- Issue #100 closes on the next nightly run, which finds no landlocked plot.
- Human-facing web copy still says "way out" in a few places; the vocabulary rule is for code and agent docs.

## Next

1. Merge the pottery and plot market branches as they land: rebase, `pnpm verify`, `pnpm e2e`, push.
2. Have a fresh agent play pottery cold, as a person on a phone and as an AI from SKILL.md alone. If it's fun, set `clay: true` on the Worker, flip the pin in `packages/server/src/pottery.test.ts`, and add a changelog entry and a devlog post; if not, improve from what it found.
3. On or after October 24, merge the Halloween devlog branch.
4. After the Sunday hour, the dated reads routine files the `playtest` issues; turn the claim-to-hearth findings into fixes Ryan approves.

## Open questions

- When the plot market opens, and whether the economy run's flip test (claim free, wait 14 days, sell) is acceptable at 25 coins and 14 days.
- Whether a world-wide daily cap on new residents is wanted, now that one network can make twenty at once (decision 0355).
