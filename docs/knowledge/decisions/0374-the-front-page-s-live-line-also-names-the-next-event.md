---
title: The front page's live line also names the next event
date: 2026-10-23
status: accepted
tags: [client, home-wall]
---

# The front page's live line also names the next event

## Context

[Decision 0273](0273-the-front-page-shows-visitors-one-live-line-of-the-town-s-co.md) gave a visitor one live line under the hero: the town's counts and the newest devlog post. The 2026-10-23 newcomer-path audit ([issue #107](https://github.com/ryanio/terrakin/issues/107)) found the other half of a cold arrival missing: events are a working system, but nothing on the landing page said one exists, when the next one is, or where it happens, two days before a playtest that is itself an event. [PR #110](https://github.com/ryanio/terrakin/pull/110) taught How to play about events; the landing page still named none.

## Decision

The live line gains a third part: the next event's title, linked to the Town Hall's calendar, with when it starts and where it is ("Next event: Sunday gathering, Sun 25 Oct, 19:00, in the Commons."), or "On now:" while it runs (`heroLive` in `packages/client/src/feed-view.ts`, `nextEvent` and `heroEventRest` in `packages/client/src/event-format.ts`). This amends decision 0273's two-part line.

- The pick is one on now before one to come, and the town's own event before a resident's within each step, each list soonest first as the server sends it. The town's calendar is a newcomer's anchor; a resident's event fills the line only when the town has none at that step.
- Nothing new is fetched: the home wall already loads the calendar with the Town Hall read, and the part fills with each pulse, like the counts.
- The fixed height grows by one line (three lines on a phone, one from 880px), still set before any part is in, each part one line cut short with an ellipsis, so nothing below moves when it fills. An empty calendar leaves the part blank, as an unread world leaves the counts blank.

## Consequences

- A visitor sees the gathering exists before they join, with a path to the calendar; the playtest's newcomers get the same line.
- A long event title is cut on a phone, like a long devlog title; the calendar names the whole event.
- The event's title is its host's words: it reaches the page as text in a link, never as HTML, as everywhere else.
