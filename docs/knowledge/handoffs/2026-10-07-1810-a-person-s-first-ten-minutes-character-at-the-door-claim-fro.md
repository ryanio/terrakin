---
title: A person's first ten minutes: character at the door, claim from anywhere, a starter home, first steps, and a newcomer funnel
date: 2026-10-07
tags: [process, onboarding, client, server, admin, agents, townsfolk]
---

# A person's first ten minutes: character at the door, claim from anywhere, a starter home, first steps, and a newcomer funnel

## Done

Agents had one-call shortcuts (`settle`, `build_starter_home`, the check-in's first-visit steps) and people on the web had none. On the live world, 6 of 16 people had ever claimed a plot and 1 had a pet. Everything below is on main, each through `pnpm verify` and the full e2e suite, the riskier ones through the `reviewer` agent too.

- Joining as a person picks a hair style, a free top, and a color, with the figure drawn as you pick; no shape. The front page shows "Step in yourself" on a phone's first screen ([decision 0140](../decisions/0140-a-person-joins-with-hair-a-top-and-a-color-and-no-shape.md)).
- Claim plot with no plot opens a picker of empty plots, nearest to lived-in plots first, and sends `settle`. `settle`'s checks are one exported `settleProblem` in the sim, with the same refusals in the same order ([decision 0143](../decisions/0143-claim-plot-opens-a-picker-of-empty-plots-for-someone-with-no.md)).
- After a claim, "Build me a starter home" or "I'll build it myself" (the build bar opens on a labeled hearth), and the name sheet says what the first pantry brought. Your things takes Claim plot's place in the HUD and has a card on your own profile. A blocked d-pad step says what's in the way ([decision 0144](../decisions/0144-after-a-claim-the-web-offers-a-starter-home-in-one-tap-or-th.md)).
- `GET /v1/first-visit` reads a resident's first-visit steps and tries with no side effects. The web shows them as a Getting started card on the home wall and a next-step chip in the world's button column, hidden whenever another button there shows. The `garden` step now waits for a hearth ([decision 0145](../decisions/0145-the-web-app-reads-first-visit-steps-from-a-route-that-shares.md)).
- The staff app's Newcomers page counts, per weekly join cohort, how many people and AIs reached each first step ([decision 0141](../decisions/0141-the-newcomer-funnel-counts-first-steps-from-what-the-world-a.md)).
- Welcome visits: two minutes after a person's first claim ever, the nearest townsfolk visits their door, waves, and pays the welcome tip if the daily run would. It ships off ([decision 0142](../decisions/0142-a-townsfolk-visits-a-person-s-door-minutes-after-their-first.md)).
- PR #49 (Jump in and Go to them on profiles) fixed and squash-merged.
- A CSS rule another session put inside `.game-where` was moved out, so lint passes on main again.

## State of things

- Welcome visits do nothing in production until `TERRAKIN_WELCOME_VISITS` is `on` (or `dry`) in `wrangler.jsonc` vars. Turning it on needs a CHANGELOG entry in the same commit. `TERRAKIN_TIPS` must stay `on` for the visit to pay a tip.
- The funnel's numbers are a baseline from before these changes. Read the Newcomers page a week after deploy to see whether the claim, hearth, and first-thing steps moved for people.
- Numbers 0133 to 0139 are unused, and parallel sessions took 0132, 0146, and 0147 while this work ran, so check `git ls-tree --name-only origin/main docs/knowledge/decisions/` right before committing a decision.
- PR #47 (refuse joins with a taken name) is still open. A review found it doesn't rebase (its decision number 0130 is taken, generated files conflict), its e2e is broken (owner.spec still expects "Ash"; several specs share names on the phone server), and it locks an agent that lost its key out of its own name for good, because a maintainer can only re-key an agent its owner revoked. It also only partly fixes issue #46: existing duplicates stay, and the "9 ids at once" may be a fetcher retrying `GET /v1/join`, which this would make worse.

## Next

1. When Ryan says so, turn on welcome visits as above.
2. Read the Newcomers page a week after deploy and compare people's claim and hearth rates with this baseline.
3. Ryan's playtest (issue #23), 5 to 10 people, measured against the funnel.
4. The web card doesn't show `tryToday`, because people never check in, so it wouldn't rotate. If people should get a daily suggestion, the web needs its own rotation.
5. Accepting an invite carries the look in a follow-up `profile` action. `AcceptInviteRequest` could take the look fields (additive) and the follow-up could go.

## Open questions

- Ryan: turn on welcome visits (`on`, or `dry` first)?
- Ryan: PR #47. Either refuse taken names with "pick another name" and a way to reach the team, or let staff re-key any agent. Check the world log for whether #46's duplicates were joins or a fetcher's retries before choosing.
- Ryan: issue #50 asks how to give a link-only agent full API access. There is no path from a link key to a token on purpose (decision 0104): it's revoke, then a maintainer's re-key code, then claim again as owner. A reply is drafted in the session, not posted.
