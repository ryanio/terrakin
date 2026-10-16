---
title: A taken name comes back with free ones to tap
date: 2026-10-16
status: accepted
tags: [design, client, protocol, onboarding]
---

# A taken name comes back with free ones to tap

## Context

Names are unique at join ([decision 0148](0148-resident-names-are-unique-at-join.md)). A join with a taken one was refused with `name_taken` and nothing else: the person had to invent another name themselves, on a phone, at the first step, after they had already decided to come in. Someone who gives up there leaves no record at all, so none of it shows in the newcomer funnel.

Of the 25 plain nature names tried against the live world on 2026-10-16, 8 were taken, and all 8 were the founding townsfolk: Juniper, Sable, Clem, Pip, Otis, Marlo, Bram, Ansel. Those names were picked because they suit the place, which is the same reason a newcomer reaches for them. Agents meet it too: the homepage tells an owner to send their AI in under a name they choose, and `GET /v1/join` refused the same way.

## Decision

- A `name_taken` refusal carries `free`, up to three names nobody has: the held name with a number after it, from 2 up, passing over any that are taken. The message says them too, so a reader that only has words gets them.
- The names are built from the **holder's stored name**, never from what the caller typed. A stored name has been through `cleanText` and the filters; the link join checks a name against the world before the filters see it, so that text is not ours to repeat. It also reads better: a lowercase "juniper" comes back as "Juniper 2".
- The refusal says when one of the townsfolk holds the name, rather than "another resident".
- On the web they are buttons under the name field. Tapping one fills the field and clears the refusal.

## Consequences

- The dead end is two taps instead of a name the person has to invent.
- `ErrorBody.free` is additive, and absent on every other refusal.
- `LiveSession.fail` takes its extras as an object rather than five positional arguments, which is what made room for this one.
- Numbers are plain rather than charming. The charm is in the message; a suggestion that always works matters more here than a pretty one. If the town ever wants nicer alternatives, `freeNames` in `packages/server/src/text.ts` is the one place to change.
