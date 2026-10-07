---
title: The collection book is a server table fed by committed inputs, backfilled once, and public like a profile
date: 2026-10-06
status: accepted
tags: [server, protocol, client, agents, privacy, items]
---

# The collection book is a server table fed by committed inputs, backfilled once, and public like a profile

## Context

[RFC 0021](../../rfcs/0021-collections-and-foraging.md) gives every resident a collection book: every kind they have ever held and every piece of wear they have worn, with the day they first did. [RFC 0017](../../rfcs/0017-seasons.md) sketched it as sim state behind an `open_collection` switch, because recipes you learn would read it. It also had to say what counts, what the book shows to others, and what to do about everything that happened before it existed.

## Decision

- The book is a table in the social database (`collection`: resident, shelf, kind, first day), not world state. No rule reads it, so it needs no switch, never changes how the log replays, and costs every snapshot nothing. Recipes you learn will be their own state (what you know and who taught you), in the sim behind their own switch, and they don't need the book to be sim state.
- It fills in from `WorldService.onCommitted`, which hears every committed input and its events. Any `inventory` event that adds a stack or brings a made thing counts its kinds for its resident, so grown, made, found, gathered, bought, bought in the market, given, and taken back from display all count the same way. `joined`, `profile_changed`, and `wear_bought` count the wear a resident put on or bought. A row is written once, with the world's day; later ones are ignored, and each resident's rows are kept in memory once read, so a gain of something already collected touches no table.
- Before the book, it's filled once from what the world holds: inventories, displays, things held aside, market listings, the seeds of crops in planters, shop wardrobes, and worn wear. A made thing its holder made counts from its `madeDay`, a planted seed from its `plantedDay`, and the rest from the backfill's day. A marker row (`collection_backfill`) keeps it from running twice. Replaying the whole log for exact days would cost the full replay snapshots exist to avoid, for a world a few days old.
- The book covers every kind in the catalog and every piece of wear anyone can wear. Partner wear is left out of the count and the view, since only partners' characters can wear it. Groups follow the catalog's families, then wear; a family of two kinds or more has a badge, in `COLLECTION_WORDS` in `packages/protocol/src/collection.ts` with each family's hint.
- It's public, like a profile: `GET /v1/residents/{id}/collection` needs no token, and profiles carry `collected: {count, total}`. It says which kinds and since when, never how many of anything someone holds. The kinds people give, grow, harvest, and display are public already through the world's events.
- The check-in reads it for two suggestions: `forage` while the book has no find, and `finish_family` when a family of finds is one kind short and that kind lies somewhere in today's season.

## Consequences

- A crash between an input's log write and the hook misses that gain in the book; the thing is still held, and the next gain of the kind records it. The backfill doesn't run again to heal it.
- A first day before the book's start is approximate for things given, bought, or found then. The world was days old.
- Partner characters' halos never count; if that should change, it's a change to `COLLECTIBLE_WEAR`.
- The page shows finds first, then the rest in the catalog's order; the API keeps the catalog's order.
- Code: `packages/server/src/collection.ts` (`CollectionBook`, `collectionView`), its wiring in `packages/server/src/api-wiring.ts`, `collected` in `packages/server/src/social-service.ts`, `forage` and `finish_family` in `packages/server/src/checkin-suggest.ts`, `packages/protocol/src/collection.ts`, and `packages/client/src/collection-view.ts`.
