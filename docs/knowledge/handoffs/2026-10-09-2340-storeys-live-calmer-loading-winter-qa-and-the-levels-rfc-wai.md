---
title: Storeys live, calmer loading, winter QA, and the levels RFC waiting on Ryan
date: 2026-10-09
tags: [building, client, performance, seasons, progression, process]
---

# Storeys live, calmer loading, winter QA, and the levels RFC waiting on Ryan

Follows [the morning's handoff](2026-10-09-1655-triage-day-prs-in-halloween-qa-ci-speedups-the-link-only-tok.md).

## Done

- Homes with storeys are live, all eight PRs of [RFC 0028](../../rfcs/0028-homes-with-storeys.md): `add_storey` for 200 coins ([decision 0242](../decisions/0242-a-storey-costs-200-coins-the-economy-run-with-builders-says-.md)), floors held up by walls below, stairs, `move` up and down, build plans with `storey`, the build bar's storey picker and Go up and Go down on the web, both 3D views, and plot photos ([decision 0244](../decisions/0244-add-storey-answers-with-its-price-and-the-api-leaves-how-hig.md), [decision 0245](../decisions/0245-a-plot-photo-s-floor-plan-follows-the-map-s-cutaway-and-no-s.md)). The `reviewer` agent read each stage; its findings are fixed.
- The home wall's first paint goes in at once behind one block of placeholders, every placeholder comes from `packages/ui/src/skeleton.ts`, and the top bar's purse is there from the start ([decision 0243](../decisions/0243-the-home-wall-s-first-paint-waits-for-its-pieces-behind-one-.md)). Layout shift on a resident's wall went from about 1.07 to about 0.001, and `e2e/feed.spec.ts` fails above 0.05.
- An agent's check-in names a new owner by id for the link's first week (decision 0241's open item).
- Winter and Midwinter QA on a test world from October 9 to March 1: `not_buying` says never, out of season, or not today; `no_picks_left` says when a seasonal card is back; and a lamp's pool of light shows on a floor or path under it in 3D.
- The 2026-10-09 devlog post, "Homes go up a storey".
- [RFC 0029](../../rfcs/0029-levels-and-skills.md) drafts levels and skills, the first Phase 3 progression RFC.

## State of things

- Issue #46: the two real duplicates (Blaze `r_34f1c8e95869f8a4` into `r_1fde419abdfb003c`, GiorgioBAYC `r_0fa1ccf70811ff2e` into `r_f54c4bd5560702ac`) passed a dry run with nothing to move, and still wait for a maintainer to merge them in the staff app.
- Storeys were looked at on test worlds at phone size, not on terrakin.org.
- Small things seen and left: in 3D a hearth's smoke rises through a loft floor above it; on the map a figure's name tag can cover decor on the tile north of it; Midwinter's dusk on the map reads mauve with a gold cast (in 3D it is gold).
- Link-only agents can't climb stairs: `linkMove` takes the eight directions only.

## Next

1. Ryan's answers to RFC 0029's seven questions, then its PR 1 (sim deeds and caps).
2. Look at storeys on terrakin.org on a phone once the deploy is out.
3. Read the newcomer funnel around October 14 (decision 0141).
4. Look at Halloween on terrakin.org on October 24 and October 31.
5. A link route for going up and down stairs, if link-only agents ask.

## Open questions

- Ryan: RFC 0029's questions, chiefly whether unlocks stay cosmetic only and whether the collection book counts as firsts when levels open.
