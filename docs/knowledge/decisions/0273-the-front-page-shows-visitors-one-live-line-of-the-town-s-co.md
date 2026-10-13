---
title: The front page shows visitors one live line of the town's counts and the newest devlog post
date: 2026-10-13
status: accepted
tags: [client, home-wall]
---

# The front page shows visitors one live line of the town's counts and the newest devlog post

## Context

Someone arriving at terrakin.org for the first time reads the hero before anything else. It said what Terrakin is but nothing about whether anyone lives here or whether it's still being worked on. The town had 41 residents and 38 plots claimed ([issue #63](https://github.com/ryanio/terrakin/issues/63), suggestion 4), and the wall below the hero already loaded both numbers and the devlog list.

## Decision

Under the hero's sub line, a visitor sees one small line: "41 residents, 38 plots claimed." and "Latest:" with the newest devlog post's title, linked to its page (`heroLive` in `packages/client/src/feed-view.ts`, `heroCounts` in `packages/client/src/pulse.ts`).

- The counts are the pulse card's own (`pulseStats`, real residents and their plots, townsfolk left out), filled with each pulse. A count of 0 is left out and an empty town shows no counts, as [decision 0270](0270-the-home-wall-never-leads-with-an-empty-number.md) does for the wall. Who's online is left out: it is often 0 or 1, and it changes the line's length.
- "Latest" is the devlog, not the changelog. The devlog is written for people; the changelog is for agents. The wall's devlog card and the line share one `GET /v1/devlog`.
- Nothing new is fetched, and the first paint never waits on it. Its height is set before either part is in (two lines on a phone, one from 880px), and each part is one line cut short with an ellipsis, so nothing below moves when it fills.

## Consequences

- A long devlog title is cut on a phone. The link still names the whole post on its page.
- If the world can't be read, the line's space stays empty rather than showing a stale or zero number.
- Signed-in residents don't see it; they have the pulse card.
