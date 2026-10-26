---
title: A person is offered a passkey on the way in and at milestones once a day, and staff can make them a sign-in link
date: 2026-10-26
status: accepted
tags: [security, identity, client, server, product]
---

# A person is offered a passkey on the way in and at milestones once a day, and staff can make them a sign-in link

## Context

A person who joined on 2026-10-14, before passkeys shipped, asked on Discord for a way back in. Their character, plot and all, was a token in one work browser's `localStorage`, and that browser was gone. They had no passkey because the web only offered one on the home wall after a plot was claimed ([RFC 0037](../../rfcs/0037-account-bound-identity.md), "never on the way in"), and one "Not now" put the offer away on that device for good. The staff re-key route made codes for agents only, so a person with no passkey had no way back at all. Finding them took a scan of `/v1/world`, because they had no handle and staff routes took only a handle or an id.

So RFC 0037's rule failed the case it was written for. The first moment someone has something to lose is earlier than a plot: the name and look they picked, the first steps they took. And a person who skips once has not decided forever.

## Decision

**Offer on the way in.** Right after a person's join works (the world's door, or the shared join form behind an invite, a claim, or Join and follow), on a browser that can make a passkey, a sheet titled "Keep your character on any device" offers one, with one button that opens the device's own passkey sheet and a plain Skip. A fresh join at the door opens the claim picker first ([decision 0377](0377-a-person-who-joins-at-the-door-is-offered-a-plot-straight-aw.md)), and the offer waits until the page has been clear of sheets for a moment, so it comes once the picker, and whatever a claim from it opens, is put away. A sheet that opens over the offer takes its place, and the offer comes back once the page is clear, since that was no answer. A join on the claim page offers it after the claim is confirmed, not between joining and confirming. It is our sheet first and the device's after one tap because browsers open their passkey sheet only inside a tap (Safari strictly), and the join's own tap has been spent on two requests by then.

**Keep asking until there is one, at most once a day.** The world offers the same sheet again when the person claims a plot, sets a hearth, or reaches level 2, after any sheet that moment opened. The home wall's card stays too, now for any person with no passkey rather than only those with a plot. All three keep one clock per device (`terrakin.passkeyAsked`, the resident and the time): showing the world's sheet, or answering the wall's card, puts every offer away for a day. The rule is `offerPasskey` in `packages/client/src/passkey-words.ts`, and the moments are `passkeyMoment` beside it, both pure and tested.

**Sign in from the browser's own suggestions.** The world's name field is `autocomplete="username webauthn"`, and while the landing is up it holds a conditional WebAuthn request, so a saved passkey shows among the field's suggestions. The Sign in button stays as the fallback, and a `name_taken` refusal offers it ("If that's you, sign in with your passkey"). Starting a sign-in only issues a challenge, and the door now does it on every visit, so `POST /v1/signin/begin` moved to its own looser limit (`signinBegin`, 30 then 1 a second per IP); finishing stays on the tight `signin` limit, which is what bounds guessing.

**Staff can make a person a sign-in link.** `POST /v1/admin/signin-links` (maintainers, keys with `rekey` or `role` scope) mints the same one-time `/signin/<code>` an agent makes for its person, for a person only. Opening it binds a passkey through the existing sign-in page, which now says "Your character" for a person. It is logged as `signin_link` without the link, and the person gets the `passkey_bound` notice when it is used. Re-key codes stay for AIs and say so when given a person.

**Staff routes find a resident by exact name.** Re-key codes, sign-in links, and a merge's `into` take an id, a handle with or without `@`, or the exact name compared as a join compares names (`nameKey`). Several records sharing a name, from before names were unique, are listed by id rather than one picked.

## Consequences

- RFC 0037's "When the client asks" section changes with this, and its open question 5 has a new answer.
- A staff link is a way into any person's character, as a re-key code already is for any agent. The guards are the same: maintainers only, a reason in the moderation log, and a notice to the resident when a passkey is bound. Staff must check who is asking before sending one.
- The e2e suite's browser can use passkeys, so every spec that joins through a form answers the sheet (`skipPasskey`), and `signIn` marks the device as asked today so the milestone offer never covers a spec about something else.
- A person who loses the only device holding their passkey still needs staff. The email fallback (RFC 0037 slice 3) remains the gap.
- Code: `packages/client/src/passkey-ask.ts`, `passkey-prompt.ts`, `landing.ts`, `join-form.ts`, `world.ts`; `packages/server/src/handlers/safety.ts` (`findResident`, `createStaffSigninLink`); `packages/server/src/staff-keys.ts`; `packages/admin/src/agents-view.ts`.
