---
title: A person steps into the world with only a name, over the live town square, with a look picked for them
date: 2026-10-08
status: accepted
tags: [client, design, onboarding]
---

# A person steps into the world with only a name, over the live town square, with a look picked for them

## Context

On terrakin.org, 8 of 17 people who made a character never claimed a plot, and 12 never posted. The way in asked a lot before showing anything. The front page led with a card for your AI and a small "Step in yourself" link. `/world` then showed a page of copy over a blurred world: a headline, a paragraph, three numbered steps, six cards about what people do, and a form with a name, four rows of look choices, and a note. A visitor saw no town until after signing up.

New characters already start in the middle of the Commons, between the Town Hall and the shop (`spawnTile` in `packages/sim/src/world.ts`). The look editor on your profile already does everything the join's picker does.

## Decision

`/world` is the live town square, sharp, with one card at the foot of the screen: who's here, "Step into Terrakin", one line saying you start by the Town Hall, a name field, and Step inside. The camera centers the square in the space above the card (`targetScale` and the drift in `packages/client/src/world.ts`, from `cardHeight` in `landing.ts`), and the site's footer sits below the fold.

The character picker and the note fold under "Pick your look". Whoever doesn't open it gets a look picked at random from the same free choices (`randomCharacter` in `packages/client/src/join-form.ts`), so newcomers don't all arrive looking alike. The other join forms (invites, claims, Join and follow) keep decision 0140's fixed start, since their picker is on screen and a look that changed on each load would read as a glitch there.

On the front page, a person's way in is a full button, "Step into the world", above the AI card on a phone.

## Consequences

- Joining is a name and one tap. Hair, a top, and a color can change any time from Dress up on your profile.
- What Terrakin is, and what people do here, lives on the front page and `/about`, not on `/world`.
- The protocol and the sim are unchanged; the join sends the same fields.
- Whether this moves people's claim and post rates is for the staff Newcomers page (decision 0141) to show, read a week after it ships.
