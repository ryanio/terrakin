---
title: buy_plot carries the listing and the price the buyer saw, and a plot listed again is refused
date: 2026-10-31
status: accepted
tags: [sim, protocol, economy, plots]
---

# buy_plot carries the listing and the price the buyer saw, and a plot listed again is refused

## Context

An item listing has an id of its own, so a lot taken back and listed again is a new listing, and a `buy_listing` for the old one is refused. A plot listing had no id: a plot holds one listing at a time and is named by its coordinates ([decision 0345](0345-the-plot-market-reaches-the-api-dark-priced-by-a-dry-run-rep.md)). So `buy_plot {px, py}` bought whatever the plot was when the buy arrived.

That let a buyer pay for something nobody agreed to, two ways. An agent dry-runs a plot at 300 coins, asks its owner, and gets a yes an hour later. In that hour the seller could take the plot back and list it at 3,000. Or the seller could take it back, strip it (the freeze holds only while it's listed), and list it again at 300 the same day, so the price matches and the home doesn't. The web had the same gap between the Buy sheet's dry run and its second tap. Buying a plot is the largest spend in Terrakin, and an agent spends only what its owner said yes to.

## Decision

A plot listing keeps `listed`, the `seq` of the input that listed it, which the listing views show. `buy_plot` carries `listed` and `price`, both required in the protocol and in the sim. The sim refuses a `listed` that isn't the listing's with `listing_changed`, a `price` that isn't its price with `price_changed`, and a missing or broken one with `invalid_amount`, changing nothing. The Buy sheet sends what it showed.

`listed` alone would be enough, since a listing is frozen and its price never changes while it stands. `price` stays because it is what an owner says yes to, and a wrong one is the mistake an agent is likeliest to make. Both are required because an optional guard is one an agent forgets.

No world has opened the plot market (no adapter sets `plotMarket`, the Worker never sends `open_plot_market`, and the sim refuses every plot command before it), so no logged `buy_plot` lacks either field. The fixture's one buy gained both, and its hash stayed the same, since the listing is gone once the plot sells.

## Consequences

- A seller who takes a plot back makes every open Buy sheet and every agent's pending go-ahead stale, which is what should happen: the buyer looks again.
- `listing_changed` and `price_changed` are in SKILL.md's error table, with the instruction to ask the owner again.

Code: `checkBuyPlot` in `packages/sim/src/plot-market.ts`, `BuyPlotAction` in `packages/protocol/src/actions.ts`, `openBuySheet` in `packages/client/src/plot-sale-sheet.ts`.
