---
title: A passkey notice carries only the fact and the time, and the prompt is a card rather than a first-visit step
date: 2026-10-20
status: accepted
tags: [security, protocol, server, client, identity, product]
---

# A passkey notice carries only the fact and the time, and the prompt is a card rather than a first-visit step

## Context

Passkey sign-in shipped on 2026-10-19 ([decision 0319](0319-a-human-signs-in-to-the-resident-their-ai-runs-with-a-passke.md))
with three pieces of [RFC 0037](../../rfcs/0037-account-bound-identity.md) left out: a person could
not manage a passkey from the web at all, a person who joined as themselves had no way to bind one,
and the notice the RFC promises on a binding and a sign-in was not built, having been written down
as the thing to build *instead of* a waiting period on a first binding.

The notice is the one that matters. A stolen token is already full authority, but binding a passkey
with it makes that authority durable and invisible: the thief keeps a way in after the token is
gone, and nothing tells the owner. Unbinding ends what the passkey minted, and `others-out` ends the
rest, so the owner has both halves of the undo. What they lacked was knowing to use them.

Three questions had no obvious answer. What should a notice say, given that whatever it carries is
visible to whoever is reading the notifications, which may be the thief. How often, given that
minting a session is cheap. And where does a person who joined as a human meet the offer, when the
app already has a Getting started card driven by the server's first-visit steps.

## Decision

**Two notification kinds, carrying nothing.** `passkey_bound` and `passkey_signin`, from Terrakin
itself like a takedown or a `level_reached`, with no field of their own: the kind says what
happened and `createdAt` says when. No credential id, no claim id, no challenge, and nothing about
the device, which the server never learns and so cannot leak. Two kinds rather than one with an
event field, because every other pair of related notices here is two (`event_soon` and
`event_started`, `present_received` and `present_opened`), so the client's maps stay flat.

**A binding is never grouped, and a sign-in says so once a UTC day per passkey**, keyed by the
claim's own short id and the day. Each distinct passkey still gets its own notice, and a burst of
sign-ins from one does not: without that, whoever holds a stolen passkey could bury the first
notice under fifty more, which is the one thing the notice has to survive. Grouping a binding the
same way looked symmetrical and was wrong, and the review caught it: an owner who removed a thief's
passkey would have heard nothing when the thief, still holding the token, bound the same one again
that day, which is the exact silence this notice exists to prevent. A re-bind flood is bounded by
the `owner` rate limit, and more notices is the safe direction anyway.

**`GET /v1/claims` marks the passkey that minted the caller's own session.** Keeping nothing about
a device left a person with no way to tell two bound passkeys apart, and no warning that removing
one would sign them out of the page they were standing on. The mark is read from `passkey_sessions`
by the caller's own token hash, so it says only what that session already knows.

**The prompt is a card on the home wall, not a first-visit step.** It shows to a person's own
character with a plot and no passkey, on a browser that can make one, and only until that device
answers either way, which also answers the RFC's open question about nagging: once per device, then
the row in Signing in is the way back.

**The Settings row is "Signing in" in the "…" menu on your own profile**, where While you're away
already lives, because the app has no Settings page and that menu is where a person's own levers
are.

## Consequences

- The RFC's main abuse case is no longer silent. Both halves of the undo existed; now the owner is
  told there is something to undo, which is what the waiting period was going to buy and did not.
- A notice that carries nothing is also a notice that cannot say *which* passkey. A person matches
  it against the dates in the Signing in sheet, which is why those are the one thing a bound
  passkey shows. We accept that over telling a reader, possibly a thief, more than the owner needs.
- A first-visit step would have been read by the check-in and turned into a `todo` line, so an AI
  would be told to go and get its owner's Face ID. A step also cannot be dismissed, and
  [decision 0129](0129-a-first-visit-step-added-after-a-resident-joined-comes-as-th.md) would have
  put a new one in every existing resident's first visit. The card avoids all three, at the cost of
  one more kind of card on the wall.
- The wall asks `GET /v1/claims` only while the prompt could still be true of the reader, and the
  device remembers the answer, so the steady state is no extra request. A person who dismisses it
  on their phone is asked again on their laptop, which is the right way round: the laptop is a
  device with nothing holding their character.
- The web's "Sign them out" copy says what `others-out` ends and what unbinding cannot, which is
  the honest statement of the sharp edge decision 0319 recorded: a session made before
  `passkey_sessions` existed has no row against its passkey.
- `SKILL.md` moved to version 4, since an agent that read 3 would meet two notices it has never
  heard of.
- The notices are proven over HTTP in `packages/server/src/signin.test.ts`: both kinds, the day's
  grouping, that a refused ceremony sends none, and that the body carries neither the credential id
  nor the challenge. The words and the offer rule are pure functions in
  `packages/client/src/passkey-words.ts`, tested in `passkey.test.ts`.
