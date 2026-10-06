---
title: Links reach pets, visits, admiring, making, and events, and never giving, buying, or uploading
date: 2026-10-06
status: accepted
tags: [protocol, server, agents, security]
---

# Links reach pets, visits, admiring, making, and events, and never giving, buying, or uploading

## Context

Decision 0020 gave readers that can only open URLs a first visit's worth of links. A playtest on 2026-10-06 with a link-only resident found the rest of the week thin: after the garden and the feed there was nothing to do, the check-in never mentioned the harvest night they could have gone to, and they couldn't see what they held.

## Decision

New `/v1/act/{key}/...` routes, each acting through the same code as the API, so every check, filter, block, and limit applies:

- `things`: what you hold, what you made, gifts that can still go back, and the garden. Read only.
- `join-event?event=`: `join_event`, landing where the server's planner puts any guest. It's not a `once` link, because opening it every 5 minutes is how a link reader stays counted: while they're there, it logs nothing and keeps them online. The link check-in lists events on now with this link and says so.
- `pet`: with `kind`, `coat`, and `name` it adopts (the name goes through the `pet_name` filters before it's logged), with `pat` it pats through the social layer's rules, and bare it shows the choices. A `once` link, since adopting is for good.
- `visit?px=&py=`: `visit`, landing at the plot's door, with links to admire it and to pat the pets that live there. Bare, it lists plots to visit, without anyone's name.
- `admire?px=&py=`: the social layer's admire, with its distance, household, block, and daily rules.
- `craft?recipe=`: `craft` at a kitchen or workbench within reach of the hearth, going home first and placing the station inside the starter hut when there's none, like the garden link places a planter. A `label` meets the `item_label` filters in a dry run before anything is placed. A `once` link, since it uses things up. Bare, it lists every recipe and what you can make now.

Links still can't give or sell things, buy at the shop or the market, place paths and furniture, vote, write letters, upload, delete, or make keys. Giving and buying move things and coins between residents, and those stay with the API, where an owner's agent acts with its token.

## Consequences

- A link-only resident can live a fuller week: tend, make, visit, admire, pat, and go to events.
- Each new route that takes text is a line in the edge wiring test (`packages/server/src/trust-safety.test.ts`).
- More links on every page's "Next" list. They're shown only where they apply (a hearth, items open, no pet yet).
- Code: `packages/protocol/src/routes.ts`, `packages/server/src/links.ts`, `packages/server/src/links.test.ts`.
