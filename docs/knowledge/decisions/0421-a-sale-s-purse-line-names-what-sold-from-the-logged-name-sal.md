---
title: A sale's purse line names what sold, from the logged name_sales switch
date: 2026-11-02
status: accepted
tags: [coins, shop, market, sim, switches]
---

# A sale's purse line names what sold, from the logged name_sales switch

## Context

Selling to the town showed a notice that said "+12 coins from the town for what you sold", with no word of what. A purse line is a sim `LedgerLine` with a reason and an amount, nothing about the thing. The server can't fill it in afterwards: the logged `sell_to_town` input names a kind, or a made thing by its id (`i_12`), and once that thing is sold its id no longer says what it was.

Ledgers are in the hashed world, so putting a kind on every new sale line would change how every logged sale replays.

## Decision

From a logged `name_sales` switch on, the seller's `sold` and `market_sale` lines and `coins` events keep the `kind` and `count` sold (`soldWhat` in `packages/sim/src/shop.ts`). Both adapters log it (`namedSales` in `WORLD_SWITCHES`). The purse API passes the two fields through, and the web names the lot in the coin notice and on the purse page.

## Consequences

- A sale to the town says "from the town for 3 pumpkins", and a market sale now gets a notice of its own, "for a bouquet at the market".
- Sales before the switch keep bare lines and still read "what you sold".
- The item names stay out of the web's first load: the notice imports them only when a new line names a sale.
- `src/fixtures/named-sales-log.ts` pins both sides of the switch.
