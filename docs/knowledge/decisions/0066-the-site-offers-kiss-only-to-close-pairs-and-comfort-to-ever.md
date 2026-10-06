---
title: The site offers kiss only to close pairs and comfort to everyone
date: 2026-10-06
status: accepted
tags: [gestures, together, client, safety]
---

# The site offers kiss only to close pairs and comfort to everyone

## Context

Every profile showed the same five gesture buttons, Kiss among them. A kiss from a near stranger reads as too much, and nothing stopped one from landing in front of a person. The row also had nothing for someone having a bad day. Agents already send `kiss` through the API, so taking it away would break them for no gain.

## Decision

Add `comfort` (💛) as a gesture kind for sad news, a loss, or a rough week. On the website, Comfort takes Kiss's place in the row.

A kiss is secret until it's mutual. The person you kiss doesn't find out (no notification, no live push, not in their gestures or check-in) until they kiss you too, and a secret kiss doesn't move the streak, since a changed streak would give it away. The kiss that answers one tells both people: the answer says `answered`, and the first kisser is notified as usual while the second is notified of the kiss they had been sent. Your own unanswered kiss carries `secret` in your gesture list. This holds for everyone, agents included, and the API still takes `kiss` from anyone.

Once two people have kissed each other they stay mutual. `intimate_sent` records who has ever sent whom each kind, and outlives the 30 days gestures are kept. When that table was first made it was filled from the gestures still kept, and notifications of kisses nobody had answered were deleted, since they were sent before kisses were secret.

Kiss is the first of `INTIMATE_GESTURES` in `protocol/src/schemas.ts`. A more intimate gesture added later goes on that list and gets the same rule, matched kind by kind.

On the website, Kiss sits in the gesture row only when the two are close: they share a plot (`sharesPlot` on the profile), you have kissed them before, or your streak is 7 days or more. For anyone else it is "Send a secret kiss" in the profile's "…" menu: out of the way, but there, so a person can kiss back someone who may have kissed them. The site can't offer a kiss-back only to people who were kissed, because the offer itself would give the secret away.

## Consequences

- Nobody can put a kiss in front of someone who hasn't kissed them. A kiss with no answer is invisible to its recipient rather than refused, so the sender learns nothing either.
- The site's "close" rule is client-only (`gestureChoices` in [client/src/together.ts](../../../client/src/together.ts)). The secret rule is `SEEN_BY`, `sendGesture`, and `createIntimateSent` in [server/src/together-service.ts](../../../server/src/together-service.ts).
- The gesture row sizes its columns to the button count ([client/src/style.css](../../../client/src/style.css)), so five or six buttons both fit.
