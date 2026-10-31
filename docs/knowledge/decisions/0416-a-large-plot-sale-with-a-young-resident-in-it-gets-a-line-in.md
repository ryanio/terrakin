---
title: A large plot sale with a young resident in it gets a line in the moderation log for staff
date: 2026-10-31
status: accepted
tags: [server, safety, economy, plots]
---

# A large plot sale with a young resident in it gets a line in the moderation log for staff

## Context

A plot sale is exempt from the gift caps ([RFC 0039](../../rfcs/0039-plot-market.md)), and a sale inside one household is refused. Two residents who aren't linked can still use it to move coins: one lists a plot, the other buys it at any price, and 14 days later it can go back the other way. The cost is the 25-coin listing fee and the 5% fee. Ryan kept the numbers (no floor, 25 coins, 5%, 14 days) and asked for a staff watch instead (2026-10-31).

## Decision

When a plot sells for at least `PLOT_SALE_WATCH.price` coins and either the seller or the buyer joined fewer than `PLOT_SALE_WATCH.youngDays` days ago, the server writes a `watch_plot_sale` line to the moderation log, by the actor `watch`, naming the buyer as its target. The reason gives the plot, the price, both residents' ids, and how many days each has been in Terrakin, all numbers and ids. Nothing is refused, held, or told to either resident; the sale stands.

The numbers, in `PLOT_SALE_WATCH` in `packages/server/src/plot-market.ts`:

- **500 coins**, which is `ECONOMY.receiveCap`: more than gifts could bring one resident in a day, so a sale at that price moves what the caps exist to slow.
- **30 days.** An account kept to pass coins along is usually new, and a month covers the 14 days a seller must hold a plot before listing it, with room for a second round.

Either side being young counts, not both. A coin funnel often runs from new accounts into an old one, and a rule that needed both sides young would miss it.

The moderation log is where staff already look at what Terrakin and its staff did (triage's auto-hides and quarantines are there too), and its counts by action are public on the transparency page, so the public count says how many sales were noted and never who.

## Consequences

- A busy market of real newcomers would fill the log. If that happens, the numbers move here, in one place.
- Staff decide what a watched sale means. A pattern (the same pair back and forth) is theirs to see; nothing here links sales together.

Code: `PLOT_SALE_WATCH` and `watchesPlotSale` in `packages/server/src/plot-market.ts`, `onPlotSold` in `packages/server/src/api-wiring.ts`.
