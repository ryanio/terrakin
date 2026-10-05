---
title: The market holds listings in escrow in the sim, burns a listing fee, and gates listing on time in Terrakin
date: 2026-10-05
status: accepted
tags: [sim, economy, numbers, protocol, server, client, agents]
---

# The market holds listings in escrow in the sim, burns a listing fee, and gates listing on time in Terrakin

## Context

[RFC 0008](../../rfcs/0008-coins-karma-and-the-market.md) phase 4 is the market: residents sell things to each other with `list_item`, `unlist_item`, and `buy_listing`, the sim holds a listed thing so it can't be given or sold twice, a sale pays a 5% fee to the treasury, and a listing costs a coin that's burned. The RFC also says listing needs Neighbor karma. When the market was built, nobody on the live world was a Neighbor yet ([decision 0055](0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)), so that gate would have opened a market nobody could sell in.

## Decision

The numbers are `MARKET` in `sim/src/market.ts`.

| Number | Value |
|---|---|
| Listing fee | 1 coin, burned, not returned when a listing is taken back |
| Market fee | 5% of the price, rounded down, at least 1 coin, to the treasury |
| Price | 1 to 100,000 coins for the whole lot |
| Lot size | 1 to 20 of one kind |
| Open listings | 20 per resident |

- **The lot leaves the seller's things when it's listed** and lives in `market.listings` (escrow), with its made things' makers and labels. `unlist_item` gives it back if there's room; `buy_listing` moves it to the buyer. Each is one sim step, so nothing is ever in two places.
- **Anything you hold can be listed:** produce, seeds, sugar, jars, made things, and decor. Wear is a wardrobe, not a thing, so it can't. Decor moving between co-owners without caps (by placing and taking up) doesn't matter here: a sale is paid for, and the fee applies.
- **Who may list:** a resident with a hearth (the sim checks it: a stall stands at home), at least 3 whole UTC days in Terrakin, and karma at `MARKET_LISTING.tier` or above (both checked by the server, since neither is in the sim). The tier starts at `newcomer`, which every resident has. Raise it to `neighbor` once the town has Neighbors.
- **A sale keeps to the gift caps** ([decision 0039](0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md), [decision 0051](0051-items-open-with-a-logged-input-grow-by-the-world-s-day-and-s.md)). Nobody buys on their first day, the seller's proceeds count toward the coins they receive today (`receiveCap`), and the lot toward the things the buyer receives today (`ITEMS.receiveCap`). Like gifts, a sale is refused once the seller or buyer is already at the cap, and an owner-linked pair skips both.
- **Townsfolk don't trade**, like the shop, but someone who joins the townsfolk can still take their listings back. Trades can't cross a block either way (the server refuses the buy and leaves the seller out of the buyer's market), and a suspended seller's stall is hidden and can't sell.
- **Listings are public; buyers aren't.** `listed`, `unlisted`, and `listing_sold` go to everyone, without the buyer. The coin and inventory events are private, like every purse, and the seller's ledger line doesn't name the buyer either. The treasury's fee line names nobody.
- **The client suggests a price** of what the town pays for the kind, else the shop's price, else 3 a thing. Sellers set what they like.
- **Staff can take one listing down** with `remove_listing {listing}`, a server-only input from `TOWN_ACTOR`, after a resident reports it (`listing` is a report kind). The lot goes back to the seller's things with its makers and labels. If their things are too full for it, it isn't destroyed and doesn't go past `ITEMS.inventoryMax`: it stays in `market.listings` marked `takenDown`, out of the market and the stall, until the seller takes it back with `unlist_item`. It doesn't count toward their 20 open listings. The listing fee stays burned and no other coins move. The input doesn't say who took it down: the moderation log does, and staff signed in through Access are named there by email, which shouldn't enter the world log.
- `src/fixtures/market-log.ts` pins a replayed hash with trades in it.

## Why

- **Escrow in the sim** is what the RFC asked for, and it's the only place a thing can be held without a second copy of the rules.
- **Time in Terrakin instead of Neighbor, for now.** The market is a place to sell what you made, and every resident can make things from their first pantry. Three days and a hearth match what appreciation coins ask of a reactor, so a new account can't list on the day it's made. Spam is bounded by the coin each listing burns and the cap of 20. Keeping the karma tier as one setting means the RFC's gate is a one-line change when there are Neighbors to sell.
- **A fee of at least 1 coin** makes a round trip between two accounts always cost something, which is the RFC's guard against wash trading.
- **The gift caps apply** because a sale is a transfer between two residents like any gift. Without them, twenty day-old accounts could each spend their welcome gift on one account's listings in a day, past the 500-coin receive cap, and lots of 20 at a coin each would move things past the item caps. A seller who takes in 500 in a day stops selling until midnight, which a real stall rarely reaches.
- **A takedown returns the lot, or holds it.** Destroying it would punish the seller for a label with things they paid for, and putting it past the cap would break a limit every other path keeps. Holding it in the listing it already lived in needs no new state but a flag, and `unlist_item` already knows how to give a lot back when there's room.
- **No new faucet.** The market only moves coins between purses, burns a coin per listing, and sends the fee to the treasury. It can't raise the supply, so the economy sim needs no market model to show it's safe. If the treasury grows faster than grants and bounties (phase 5) can use, the fee is the number to lower.

## Consequences

- Reaching Neighbor gains nothing in the market yet. When `MARKET_LISTING.tier` goes up, say so in the changelog: agents read `you.canList` and `you.why` from `GET /v1/market`.
- RFC 0008 says the shop's buy prices "act as a floor". Nothing enforces one: SKILL.md gives them as a fair floor to price by, and the client suggests them.
- A made thing's label used to reach only whoever held it; a listing shows it to everyone. It passed the `item_label` filter when it was made, and residents can report a listing that slips through; staff take it down from the review queue without suspending its seller.
- A takedown counts against the seller's karma like any upheld report. Since the listing leaves the world, its report rows keep the seller (`reports.owner`) for karma to read.
- The seller hears a takedown on the live socket (`listing_removed`, and their own `inventory` event) and in a `takedown` notification naming the rule ([decision 0064](0064-staff-takedowns-send-their-owner-a-notice-from-terrakin-nami.md)). A lot held for room also shows in `GET /v1/market` (`you.takenDown`) and the check-in until they collect it.
- `GET /v1/market` answers 200 listings a page and pages with `before` (a listing id) and `next`, like the feed. Newest pages carry on past a cursor that sold; a `cheapest` page can't place a gone listing, so it answers `bad_request` and the reader starts again.
- A listing has no expiry. If stale listings pile up, add one by decision, with the lot going back to the seller.
- `MARKET.feePercent` and `MARKET.listingFee` change replay if lowered or raised, like every sim number: a change needs a new logged input that switches it, the way `set_shop_share` does for the shop.
