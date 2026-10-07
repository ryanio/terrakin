---
title: Staff takedowns send their owner a notice from Terrakin naming the rule
date: 2026-10-05
status: accepted
tags: [server, protocol, client, admin, safety, agents]
---

# Staff takedowns send their owner a notice from Terrakin naming the rule

## Context

When staff took down a listing, a thing on display, a piece's picture, a post, or a resident's avatar and banner, the owner heard nothing except a live event or an inventory line ([decision 0056](0056-the-market-holds-listings-in-escrow-in-the-sim-burns-a-listi.md), [decision 0059](0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md)). Notifications couldn't carry it: every one has a resident as its `actor`, goes through the block check and the per-actor daily cap, and is dropped when its actor is suspended. Staff wrote a free-text reason for the log, but nothing recorded which community rule an action enforced, and that reason is staff's words, sometimes quoting the reporter.

## Decision

- **A new notification type, `takedown`, with `system: true`.** It comes from Terrakin itself. `actor` stays required in v1, so it carries a stand-in, `TERRAKIN_ACTOR` (id `terrakin`, a reserved handle word, never an `r_` id), which old readers show as a name and new ones replace with a neutral mark and no profile link. A nullable actor would have been a retype of a required field.
- **`takedown` is structured:** `what` (`listing`, `display`, `piece`, `post`, `pictures`), `rule` (one of the report reasons), `outcome` (`returned`, `held`, `removed`), and the thing's `id`, `kind`, and `count` where it has them. A hidden post's start goes in `excerpt`. No label, title, staff reason, staff identity, or reporter is in it. The app and agents word it from the fields.
- **The rule comes from staff or the reports.** The five takedown routes take an optional `rule`; without it the server cites the reason most open resident reports on the thing gave (ties to the earlier reason), else `other`. Reports triage raised don't count, so a model's guess is never what a resident is told. The staff app's rule picker starts on the same choice, so the usual case stays a reason and two taps. The rule is kept in a new `moderation_log.rule` column. `self_harm` is never cited: RFC 0006 says self-harm reports are never actioned against the person, and someone who may be at risk shouldn't be told they broke a rule, so it reads as `other` and the picker doesn't offer it.
- **Exactly one notice per takedown, to the owner.** Listing: its seller. Display: whoever put it up. Piece: its maker, once, however many pieces showed the picture. Post: its author, on the change to staff-hidden, so a second hide to retry files sends nothing. Pictures: the resident, when every file is gone. Suspensions send none: the `suspended` error and the paused profile already say so. Automatic hides send none: they wait for a person.
- **The check-in names them by kind and id** in `todo`, with the contact page for appeals. RFC 0006 has no appeal route yet, so the notice points to the contact page, which says to open an issue.

## Consequences

- A system notice skips the block check and the per-actor cap, so staff can always reach a resident. It is only written by staff actions, which are logged and human-paced.
- Unhiding a post leaves the earlier notice in place.
- Removing a piece's picture tells its maker, whose upload it was. Whoever holds a piece made from it now (a gift, a sale), or put it up, isn't told; their piece keeps its title and shows a plain canvas. Telling holders too is a later choice.
- A takedown notice about a post quotes its start, so deleting the post deletes the notice too.
- New system notices can use `system: true` with their own type later; readers are told to treat an unknown type as a plain notification.
- Code: `takedownNotice` and `takedownView` in `packages/server/src/social-service.ts`, `ruleFor` and `tellOwner` in `packages/server/src/safety-service.ts`, the takedown handlers in `packages/server/src/api.ts`, the `todo` line in `packages/server/src/checkin-todo.ts`, `TakedownView` and `TERRAKIN_ACTOR` in `packages/protocol/src/social.ts`, `takedownLine` in `packages/client/src/notifications-view.ts`, `takedownWords` in `packages/server/src/links/checkin.ts` (the link check-in), `defaultRule` in `packages/admin/src/logic.ts`, and `packages/server/src/takedown-notice.test.ts`.
