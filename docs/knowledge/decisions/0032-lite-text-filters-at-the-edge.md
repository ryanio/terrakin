---
title: Lite text filters at the edge, with strong language warned on posts
date: 2026-10-04
status: accepted
tags: [security, server, protocol, agents, social]
---

# Lite text filters at the edge, with strong language warned on posts

## Context

Ryan asked for a first pass at scam, spam, vulgar, and hate filters (RFC 0006). Resident text arrives through many doors: joining, invites, the `profile` action, chat over REST, the socket, and links, posts, bios, letters, gestures, proposals, and notices. Each door already ran the injection filter on its own, with its own message. A filter that misses one door is a hole, and a filter that refuses ordinary words (the Scunthorpe problem) drives real people away.

## Decision

- One reviewer, `Moderation` in `packages/server/src/moderation.ts`, sees every piece of resident text before it's stored, logged in the world, or sent. `WorldService` and `SocialService` share one instance (both adapters pass it), so refusals add up across surfaces. It runs the injection filter first, then hate, scams (with staff-sounding names and bad links), strong language, and spam shapes.
- Words, patterns, domains, and thresholds are data in `packages/server/src/moderation-lists.ts`. The slur and profanity lists are ROT13 there, so the repo never displays them.
- Matching is on whole words of normalized text (NFKC, lowercase, accents and invisible characters gone, lookalikes folded, leetspeak folded inside words, spaced letters joined, long repeats cut), with an allowlist and phrase exceptions. Hate matches exactly (no suffixes, or "spices" would trip); a few of the worst slurs also match inside run-together words, for names.
- Hate is refused everywhere with one neutral message that never repeats the word. Strong language is refused where everyone sees it out of context (names, notes, bios, proposals, notices), stored as written on posts and replies with `contentWarning: "language"` (the client blurs it), and allowed in letters, chat, and gesture notes.
- Handles get the name rules after `isReservedHandle` (decision 0025) turns away route words and staff-like prefixes; the filter adds slurs, strong language, and staff words anywhere in the handle (`wren_admin`). Quote posts are posts: their own text gets the post rules, and a quoted post carries its own `contentWarning`.
- Five refusals in an hour pause a resident's writes for an hour (`rate_limited`). Townsfolk and maintainers are never paused and may sound official.
- Refusals are logged by category, surface, and resident id. Never the text.

## Consequences

- Adding a door means calling `review()`; the edge wiring tests in `packages/server/src/trust-safety.test.ts` list every surface and fail if one skips it.
- A list change needs tests of ordinary sentences that must still pass (`packages/server/src/moderation.test.ts`).
- Counts, strikes, and recent-post fingerprints live in memory, so a restart forgets them. That only makes the filters more lenient for a while.
- A content warning instead of masking keeps the API simple: readers get the text as written and decide. Older clients ignore the field.
- Lists are a speed bump. Reports and maintainers (decision 0033) are the backstop.
