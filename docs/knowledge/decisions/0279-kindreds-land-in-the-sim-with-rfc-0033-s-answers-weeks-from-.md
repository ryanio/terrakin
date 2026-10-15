---
title: Kindreds land in the sim with RFC 0033's answers, weeks from Monday, and the hall standing in for the host's plot
date: 2026-10-14
status: accepted
tags: [sim, economy, social, events]
---

# Kindreds land in the sim with RFC 0033's answers, weeks from Monday, and the hall standing in for the host's plot

## Context

Ryan accepted RFC 0033's recommended answer to all nine of its open questions on 2026-10-14 and asked for the first version to be built. The RFC fixes the rules, but a few details it leaves open had to be settled in `packages/sim/src/kindreds.ts` before anything could be logged, because a logged input replays under whatever the sim decides now.

## Decision

The rules are the RFC's, with its numbers in `KINDREDS`: a 25-coin fee that's burned, 12 members, 3 from a household, 3 households to form within 14 days, 8 open invites that last 7 days, a 7-day wait after leaving or being removed, 3 stewards, a counted night at 3 members from 2 households, 52 gathered weeks kept, and the `kindred_regular` title at 8 counted nights. Everything is behind the server-only `open_kindreds`.

Where the RFC was open:

- A UTC week runs Monday to Sunday (`weekStart`), the week games, bounties, and jobs already count in, not the `floor(day / 7)` the RFC sketched, whose weeks start on Thursdays. Gathered weeks are kept as their Monday, and a rename comes once in one.
- At a kindred night the hall stands in for the host's own plot. Any member hosts there, co-owner or not, since the steward who set the hall chose it for the kindred's nights. Every other hosting rule stands.
- The host is sampled at a kindred night like everyone else (`presentAt` leaves the host out only of other events), so the host counts toward the gathered week and the title. `attendedOf` still never lists the host, so nothing about guests changes.
- `event_start` keeps who was in the kindred then on the event as `kin`, and at `event_end` the list becomes those of them, and of its members then, who attended, the host included. `credit_event` refuses any of them as a guest. Membership can change during the night and between the end and the credit, so the list is fixed by the night itself.
- A night stands only at the hall of a kindred its host is in. The kindred's nights on the calendar are called off when its hall is cleared or moved, and when it's disbanded, and a member's own nights when they leave or are removed, the way RFC 0010 calls off events on a released plot. Otherwise an unshared steward's hall would keep a public event on a plot whose owner can't call it off.
- The founding name is no rename: a steward can rename once in the founding week.
- A plot is one kindred's hall at most. A hall goes when its plot is released, when its steward is unshared from it, steps down, leaves, or is merged away.
- `merge_resident` moves a membership to the record that stays, with its standing and stewardship, unless that record is in a kindred already or its household has no room. Then the membership ends as a leave without a wait. Nights attended move either way.
- Names fold ASCII letters only when the sim compares them, like `retire_repeat_joins`; the server's Unicode-aware `nameKey` can refuse more before logging. "Kindred 3" and the like are refused as names, since that's what a kindred goes by after a takedown.

The economy check (`kindredLines` in `scripts/economy-sim.ts`, seeds 1 to 3) found that a kindred of 6 meeting weekly earns 2.7 Hosting points a member against 22.7 at an ordinary weekly event among the same people, and karma doesn't rise. For a kindred of 12, the median member's month-end purse moves +4.5% (+3.8% to +4.6% across seeds) when members react to mates' posts first, and +23.6% (+21% to +24%) when every member reacts to every mate's post every day. The second is a ring that any 12 friends can run today without kindreds, since appreciation doesn't read membership, so it isn't an effect of kindreds. Appreciation stays as it is, per answer 5, and kindred-mates are not excluded: Ryan kept that answer on 2026-10-14 with both numbers in front of him.

## Consequences

The sim holds every kindred rule, with a fixture log (`src/fixtures/kindreds-log.ts`) pinned in `kindreds.test.ts` and replayed at every split by `replay.test.ts`. Older logs hash as they did: state is absent until `open_kindreds`, and an event only carries `kindred` after it. The API, the server's filters and notices, and the web come in later slices. If kindred nights should one day happen away from the hall, or the week should change, that's a logged switch, since weeks already counted would replay differently.
