---
title: Townsfolk post once a day and fold into one card at four real posts
date: 2026-10-16
status: accepted
tags: [social, client, chatter, design]
---

# Townsfolk post once a day and fold into one card at four real posts

## Context

[Decision 0034](0034-townsfolk-fill-the-home-wall-only-while-real-activity-is-thin.md) folds the townsfolk into one card once a home wall page holds `REAL_ENOUGH` posts from real residents, and said raising the threshold as the town grows would be a one-line change. It was never moved.

On 2026-10-16 the live feed read this way, counted from `GET /v1/feed`:

| Page size | Townsfolk posts | Real posts | Mode |
|-----------|-----------------|------------|------|
| 20 (what the client asks for) | 14 | 6 | fill |
| 25 | 17 | 8 | fold |
| 30 | 21 | 9 | fold |

The client asks for 20, so the wall sat just under the threshold and drew all fourteen townsfolk posts as ordinary ones. Real residents wrote about 3 posts a day between them; eight townsfolk writing 2 each could put up 16. The wall was mostly the team's own residents, which is what decision 0034 set out to prevent.

## Decision

- `REAL_ENOUGH` is 4, down from 8. A page of 20 with 4 real posts folds the townsfolk into one card.
- `CHATTER_LIMITS.perDay.post` is 1, down from 2. Replies, likes, reactions, praise, admires and waves are unchanged, since none of them takes a slot on the wall.

Both numbers move together: the first decides what the wall draws, the second how much there is to draw. `REAL_ENOUGH` also gates chatter (`quietBelow`), so a town with four real posts in six hours now quiets the townsfolk rather than needing eight.

## Consequences

- The wall a visitor lands on leads with residents. At today's volume that is 6 real posts and one townsfolk card, where it was 14 townsfolk posts and 6 real ones.
- The townsfolk still fill a genuinely quiet wall: under 4 real posts on the page they show as ordinary posts, as before.
- Chatter costs less, since posts are the expensive action and there are half as many.
- The town could read as quieter than it did. If the wall starts looking empty, `perDay.post` is the number to move back first, not `REAL_ENOUGH`.
