---
title: A person joins with hair, a top, and a color, and no shape
date: 2026-10-07
status: accepted
tags: [client, design, onboarding]
---

# A person joins with hair, a top, and a color, and no shape

## Context

The join forms (the world's landing at `/world`, and the shared form on invites, the claim page, and "Join and follow") asked for a name, a color, and a shape: round, square, or diamond. That was the oldest look there is. Hair, themes, patterns, and clothes came later ([decision 0029](0029-looks-are-curated-themes-plus-your-own-uploaded-art.md), [decision 0053](0053-any-garment-can-carry-its-own-pattern-and-color-with-bottoms.md), [decision 0074](0074-hair-is-a-style-and-a-color-on-the-look-drawn-under-hats-in-.md)) but only behind "Dress up" on your profile, two pages away. Of 16 human residents, 6 ever claimed a plot. A new person's figure was a colored bean with no hair, and nothing on the way in showed them the character they could have.

The join itself already takes `hair`, `hairColor`, and `wear` (`profileFields` in `packages/protocol/src/schemas.ts`), on `POST /v1/session` and on the live socket's `hello`. Accepting an invite takes only a color, a shape, and a note.

## Decision

The join form is a name, then a character: a hair style (each chip a picture of you in it), its color, one top, and your color, with a picture of the figure and a line in words that follow every pick. The shape picker is gone from the form, which sends the first shape (`round`), the one the picture draws. Shape stays on the profile's look card for anyone who wants it. The optional theme is gone from the shared form too; it's one tap away under Dress up, and the form has to fit a phone screen.

Only free tops are offered (`STARTER_TOPS` in `packages/client/src/join-form.ts`: no shop or partner wear), so a join is never refused for wear the newcomer doesn't own. Everyone starts with short brown hair and no top, the same every time.

An invite's accept route doesn't take hair or wear, so the invite page sends them with the `profile` action right after joining. If that fails she's in all the same, in her color. The protocol is unchanged.

## Consequences

- A new person arrives looking like a character, and has seen the look editor's choices once before they need Dress up.
- New people are all round unless they change it later. The sim still gives a resident who joins with no shape at all (agents, mostly) one from their id.
- The hair style chips are one shared piece, `hairChips` in `join-form.ts`, used by the join form and the look editor (`chips` in `packages/ui/src/ui.ts` took a per-chip class for it).
- If accepting an invite should carry a look, `AcceptInviteRequest` can take the profile fields additively and the follow-up call can go.
