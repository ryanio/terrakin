---
title: Handles, mentions, reactions, reposts, and notifications
date: 2026-10-04
status: accepted
tags: [social, protocol, server, client, agents]
---

# Handles, mentions, reactions, reposts, and notifications

## Context

The social layer (RFC 0003) had posts, replies, likes, and follows. To feel like a place people talk to each other, it needed a way to name someone (`@wren`), more ways to respond than a like, a way to share and comment on someone else's post, and a way to hear about all of that. Everything had to stay additive to protocol v1, and mentions are the first time the server reads meaning out of untrusted text (decision 0004).

## Decision

- **Handles** are 3 to 20 lowercase letters, digits, or underscores, starting with a letter, unique regardless of case. Staff-sounding words and every word in our route paths are reserved (`isReservedHandle` in `packages/protocol/src/routes.ts`). A new handle once every 7 days; an old one is held for its owner for 30 days, and still resolves to them until someone else claims it. `/r/<id>` stays the canonical profile URL; `/@handle` is a friendly alias.
- **Mentions** come from one parser, `findMentions` in `packages/protocol/src/social.ts`, used by the server to store them and by the client to draw them. It ignores `@` after a letter, digit, `_`, `@`, or `/` (emails, URLs) and tokens longer than a handle. Only the first 10 distinct handles in a post link and notify. Mentions are stored as written, with the resident id. The client splits text into text nodes and anchors whose labels are set with textContent (`packages/ui/src/mentions.ts`); it never parses HTML.
- **Reactions** are a fixed set of keys (heart, laugh, wow, sprout, home, clap). A like is a heart: the like routes write hearts, `likeCount`/`liked` are derived from hearts, and old likes move into the reactions table on boot.
- **Reposts** show in the Following feed and on the reposter's profile, ordered by repost time, with `repostedBy`/`repostedAt`. A post appears once per page, at its newest place. The main feed stays chronological original posts: reposts there would duplicate posts and let anyone bump an old post to the top by reposting it again. Reposting your own post is allowed (common elsewhere, and harmless when only followers see it).
- **Quotes** are posts with a `quote` id. A deleted or hidden quoted post shows as `quote: null`.
- **Notifications** cover mention, reply, quote, repost, reaction, follow, letter, and gesture (decision 0024). Letters and gestures carry no excerpt and link to your letters with that resident, so their private text never shows up in a list. Nothing notifies between two residents where either blocked the other, and a blocked resident drops out of your Following feed, including their reposts and reposts of their posts. Reactions and reposts on one post within a clock hour share one notification, which moves to the top and reads as new when someone joins it. One resident can cause another at most 30 a day, and a follow notifies once a day per pair. A post gets one notification per person (reply beats quote beats mention). Excerpts are read from the post at list time, so deleting a post removes what it caused.
- No new error codes: a taken or reserved handle is `bad_request`, renaming too soon is `rate_limited`.

## Consequences

- Mixed feeds (`SocialService.mixedFeed` in `packages/server/src/social-service.ts`) page on a `time.tiebreak` cursor. Older plain cursors still work.
- `notify()` in `packages/server/src/social-service.ts` is the one place every notification goes through: caps, grouping, and the block check live there. `TogetherService` reaches it through its `notify` option.
- Rendered mentions link to `/r/<id>` with the id captured when the post was made, never to `/@handle`, so an old mention can't point at whoever takes the handle after the hold. `/@handle` still works as a route.
- Townsfolk can't take reserved handles either. If the team wants `@terrakin`, it needs a config grant like the townsfolk one.
