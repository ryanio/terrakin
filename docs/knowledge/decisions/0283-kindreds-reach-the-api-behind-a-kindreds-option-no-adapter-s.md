---
title: Kindreds reach the API behind a kindreds option no adapter sets, with invites heard only by the invitee and stewards
date: 2026-10-14
status: accepted
tags: [server, protocol, social, safety, agents]
---

# Kindreds reach the API behind a kindreds option no adapter sets, with invites heard only by the invitee and stewards

## Context

RFC 0033's second step puts kindreds on the API, dark, the way jobs came (decision 0260): the routes, the notice, the filters' two surfaces, the notices, the check-in field, and the staff actions, behind a `WorldService` option. The RFC says invites are private and a forming kindred is seen only by its members and invitees, but until now every world event either went to everyone or belonged to one resident.

## Decision

`WorldService` logs `open_kindreds` with a `kindreds` option, once coins are open, and no adapter sets it yet; a test world opens kindreds through `POST /v1/test/open-kindreds`.

- Who hears a kindred event is read from the world after the input's commit (`kindredAudience`), and for a kindred the commit disbanded, from who could hear it just before (`kindredRoster`): an invite and its closing go to the invitee and the stewards, a forming kindred's events to its members, its invitees, and the resident the event names, its end included, and a formed kindred's to everyone. `run()` sends each to its few, never in the broadcast or anyone else's answer.
- A forming kindred named by an outsider's `join_kindred`, `decline_kindred_invite`, or kindred night answers exactly as a missing one (`unknown_kindred`), reports take only formed kindreds, and the sim's refusals never quote a kindred's name. `name_taken` still says a name is in use, as resident names do: names are unique.
- `GET /v1/kindreds` lists formed kindreds and, with a token, yours and your invites. `GET /v1/kindreds/{id}` answers `not_found` for a forming kindred to anyone but its members and invitees, so it can't be found by id.
- A name is cleaned, filtered as `kindred_name`, and refused when another kindred has it by the server's `nameKey`, which folds more than the sim's ASCII letters, or when staff hold its writer's words back, so nothing held back reaches the world log. The sim keeps who wrote the name up (`namedBy`, and `by` on `kindred_named`), and while staff hold that resident's words back, every read shows the kindred by its id, as a plot's name is held. A notice whose writer's words are held is hidden. A report on a kindred is against whoever wrote its name.
- The notice is one row a kindred in the social tables, set by a steward of a formed kindred, filtered as `kindred_notice`, at most 5 changes a UTC day. Clearing is an empty text.
- Notices from Terrakin keep ids only and are read back from the world when shown: `kindred_invite` to an invitee, at most once a UTC day per kindred and invitee so an invite taken back and sent again can't flood anyone, `kindred_joined` to the other stewards, and `kindred_night` once to each member but the host and anyone blocked with the host. A kindred that's gone takes its notices with it.
- A kindred page's `moves` are what the world would take: joining by a dry run of the sim's own check, renaming by its once-a-week rule, inviting while there's room, and the rest by role.
- At a kindred night the server credits no member as a guest, and the hosting record karma reads leaves them out too, both from the event's `kin`.
- Staff take down a name (in the world, telling every steward) or a notice (in the social tables, telling its writer). Only maintainers disband, since it ends a group for everyone in it.
- No link joins, invites, or founds, as the RFC says. Link pages get nothing yet.

## Consequences

Nothing changes on terrakin.org until the Worker sets `kindreds`, which comes with the web. A new kindred field on any read stays behind `state.kindreds`. The audience rule is the one place that decides who hears a kindred event, so a new kindred event that should be private goes there. The code is `packages/server/src/kindreds.ts`, `kindred-notices.ts`, `world-wire.ts`, and `packages/protocol/src/kindreds.ts`.
