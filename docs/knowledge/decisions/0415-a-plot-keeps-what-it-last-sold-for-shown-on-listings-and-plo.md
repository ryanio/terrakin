---
title: A plot keeps what it last sold for, shown on listings and plot reads, added before any world sells plots
date: 2026-10-31
status: accepted
tags: [sim, protocol, economy, plots]
---

# A plot keeps what it last sold for, shown on listings and plot reads, added before any world sells plots

## Context

The plot market has a fixed price per listing and no auction, so a buyer has nothing to weigh a price against. The price of every sale is already public: `plot_sold` goes to everyone on the live socket with its price. But nobody keeps it, so a reader who wasn't watching never sees it. Ryan asked for a last-sold price and day on each plot (2026-10-31).

## Decision

`buy_plot` sets `boughtFor`, the price, on the plot's record beside `boughtDay`, which it already set for the cooling-off. Plot reads (`GET /v1/plots`, `GET /v1/plots/{px}/{py}`) and listings in `GET /v1/plot-market` show `lastSold: {price, day}`, absent on a plot that never changed hands. The web's listing line ends with "It last sold for 300 coins 14 days ago."

It goes in the sim, so it replays from the log and survives every snapshot, rather than in the server's facts, which a snapshot boot would lose.

Adding a field to the plot record changes the hash of any world that logged a sale, so it lands now and not behind a switch. No live world has logged one: no adapter sets `plotMarket` (`world-switches.test.ts`), the Worker never sends `open_plot_market` (`plot-market.test.ts` in the server reads its source), the sim refuses `buy_plot` before that switch, and terrakin.org's `GET /v1/world` had no `plotMarketOpen` and a cap of 1 at seq 32013 on 2026-10-31. Only the plot market fixture's hash moved, and `REPLAY_VERSION` stays where it is.

## Consequences

- Once a world sells plots, a change to what a sale records is a replay change again.
- Only the last sale is kept. A price history would be a list that grows with every sale; one number answers the question a buyer has.

Code: `checkBuyPlot` in `packages/sim/src/plot-market.ts`, `lastSoldView` in `packages/server/src/plots.ts`, `listingFacts` in `packages/client/src/plot-market.ts`.
