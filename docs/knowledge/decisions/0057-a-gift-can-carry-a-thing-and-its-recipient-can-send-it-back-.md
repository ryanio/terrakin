---
title: A gift can carry a thing, and its recipient can send it back for a week
date: 2026-10-05
status: accepted
tags: [sim, protocol, server, client, social, safety, agents]
---

# A gift can carry a thing, and its recipient can send it back for a week

## Context

[RFC 0005](../../rfcs/0005-make-show-and-give.md) says gift gestures can reference an item ("giving jam shows up as a gift with the jar") and, under security, that gifts can be declined. [Decision 0051](0051-items-open-with-a-logged-input-grow-by-the-world-s-day-and-s.md) built `give` and left both for step 3. Gestures live in the social tables ([decision 0024](0024-invites-letters-and-gestures-for-couples-and-friends.md)); things live in the sim. The RFC doesn't say whether a declined gift waits for a yes before it arrives, where it goes, or for how long it can go back. `give` is live and agents already use it, and old logs with `give` in them must replay to the same hash.

## Decision

- **A gift gesture carries a thing by running `give`.** `POST /v1/residents/{id}/gesture` takes `item` and `count` with `kind: "gift"`. The server runs the gesture's own checks first (blocks, the note filter), then `give` through `WorldService.act` with the same item, count, and note, then records the gesture with the thing's kind, count, and gift id. If the `give` is refused, nothing is recorded. Such a gift needs no note. Instead of the 10-minute gesture wait it can go to the same resident once a minute (`GIFT_ITEM_COOLDOWN_SECONDS`), within the sim's daily gift caps, so a burst can't land all at once. The client's "Give a thing" form now sends this, so the recipient hears about it live.
- **Gifts arrive at once and can be sent back afterwards.** A gift that waits for a yes would change how `give` works for every agent that already uses it. Instead the sim keeps a record of each gift (`items.gifts`, ids `gift_1`, `gift_2`, ...), and `decline_gift {gift}` sends it back.
- **A server input turns the records on.** Records written by `give` would change the hash of every old log with a gift in it, so they start only after `open_gifts`, which the server logs once items are open (both adapters set `gifts: true`). Before it, `give` behaves and hashes exactly as it did.
- **Back to the giver, all of it, within 7 days.** `ITEMS.declineDays` is 7, counting the day it was given; `new_day` forgets older records. Sending back needs every unit or made thing of that gift still in your things (`not_enough_items` otherwise), and `gifts` in `GET /v1/inventory` lists only those. It doesn't count toward anyone's daily caps, but it needs room in the giver's things (`inventory_full`), so nothing is ever dropped and nobody passes 200 things. Only the two inventories change, privately: there is no public event for a declined gift.
- **The gift's id is on its `inventory` events** and in `gifts` in `GET /v1/inventory`, which lists the gifts you can still send back.

## Consequences

- A giver who keeps their things full can hold off a send-back. Blocking still stops more gifts, labels and notes are filtered, and the recipient can report. If it happens, let a send-back go past the cap.
- A declined gift still counts in karma's "gave you something" for that day, since karma reads `give` inputs from the log ([decision 0055](0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)). The point goes to the recipient who declined, so nobody gains by it.
- A gift given as plain `give` can be sent back too, but its giver gets no gesture record. The gesture is the friendly path; `give` stays for agents and scripts.
- Code: `checkGiveItem`, `checkDeclineGift`, and `checkOpenGifts` in `packages/sim/src/items.ts`; `checkGesture` and `sendGesture` in `packages/server/src/together-service.ts`; the gift route in `packages/server/src/handlers/together.ts`; the "Gifts you got" section in `packages/client/src/inventory-view.ts`.
