---
title: Roomier homes live, walk_to, and dry-run costs
date: 2026-10-30
tags: [homes, rfc-0050, agents, protocol]
---

# Roomier homes live, walk_to, and dry-run costs

## Done

- Walls between tiles are how homes are built at terrakin.org (RFC 0050):
  - `starter_edges` is on in every world ([decision 0402](../decisions/0402-starter-homes-are-built-from-walls-between-tiles-in-every-wo.md)).
  - Designs always build their walls on lines, with no `roomy` field ([0403](../decisions/0403-designs-always-build-their-walls-on-the-lines-between-tiles-.md)).
  - The town slimmed every home it could once, upstairs included, and told each owner ([0404](../decisions/0404-the-town-slims-every-home-once-upstairs-included-and-tells-e.md)). Live: 47 of 66 owned plots slimmed, wall blocks 1,013 to 279, `landlocked.ts` reports 0 of 66.
- Fixes from Felipe's test run:
  - `slim_walls` answers with `plan.map` and `plan.notes`.
  - A tile beside a door on a line counts as a doorway for `no_path`.
  - `openingFacts` reads a plan's lines.
  - The skill file explains plot-wide notes, `furnished.onShow` and reach.
- `walk_to {x, y, near?}` and its link `/v1/act/<key>/walk-to` ([0405](../decisions/0405-walk-to-plans-the-route-on-the-server-and-walks-it-as-moves.md)): one shared planner in `packages/server/src/walk-to.ts`.
- `cost` on dry runs ([0406](../decisions/0406-a-dry-run-says-what-it-would-cost-by-trying-it-on-a-copy-of-.md)): the action tried on a copy of the world, the actor's things and coins compared.
- Material grades drafted as [RFC 0051](../../rfcs/0051-material-grades.md).
- The safety journey's guest step clears storage from a docs page, which removes a flake.

## State of things

- `pnpm verify` and `pnpm e2e` are green on main. Commits run from c704a346 to the one carrying this note.
- Not checked live: that the 47 owners got their `home_slimmed` notice (needs a resident's sign-in), and `walk_to` and `cost` on terrakin.org after their deploy.
- Ten owned plots still have wall blocks. Nine have no walled room. Plot (5, 6) was left by the sweep's guard (a skip, a spend, a hung thing, or a new note). Owners can still `slim_walls`.

## Next

1. After the next deploy, try `walk_to` with `"dry": true` and a dry `shop_buy` on terrakin.org with a test resident, and confirm `route` and `cost` come back.
2. Let `walk_to` take stairs: plan across floors with `climbsAt`, and add `up`/`down` legs to the route.
3. Slim walls upstairs: `slimPlan` reads only the ground floor. Upstairs, lines need flooring on one side.
4. Have the way planner (`planWays`, `way-plan.ts`) plan taking a line down, not only blocks.
5. Replace the remaining `fullPage` screenshots in `e2e/` (town, bounties) with screen-sized ones before the pages grow slow, as the shop journey did.

## Open questions

- RFC 0051's seven open questions are Ryan's, starting with the grade names.
- Open PRs: #127 (attendance at 10 minutes, from a contributor) and three dependabot bumps (#129, #130, #131) wait for review.
