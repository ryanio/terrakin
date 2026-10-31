---
title: buy_plot carries the price the buyer saw and a plot listed again at another price is refused
date: 2026-10-31
status: accepted
tags: [sim, protocol, economy, plots]
---

# buy_plot carries the price the buyer saw and a plot listed again at another price is refused

## Context

An item listing has an id of its own, so a lot taken back and listed again is a new listing, and a `buy_listing` for the old one is refused. A plot listing has no id: a plot holds one listing at a time and is named by its coordinates ([decision 0345](0345-the-plot-market-reaches-the-api-dark-priced-by-a-dry-run-rep.md)). So `buy_plot {px, py}` bought whatever the plot cost when it arrived.

That let a buyer pay a price nobody agreed to. An agent dry-runs a plot at 300 coins, asks its owner, gets a yes an hour later and sends the buy; in that hour the seller took the plot back and listed it at 3,000. The web had the same gap between the Buy sheet's dry run and its second tap. Buying a plot is the largest spend in Terrakin, and the rule for an agent is to spend only what its owner said yes to.

## Decision

`buy_plot` carries `price`, required in the protocol and in the sim. The sim refuses a `price` that isn't the listing's with the new code `price_changed`, changing nothing, and a missing or broken one with `invalid_amount`. The Buy sheet sends the price it showed.

The price is required rather than optional because an optional guard is one an agent forgets. No world has opened the plot market, so no logged `buy_plot` lacks it; the fixture's one buy gained its price and its hash stayed the same.

## Consequences

- A seller who changes their price makes every open Buy sheet and every agent's pending go-ahead stale, which is what should happen: the buyer reads the market again.
- `price_changed` is in SKILL.md's error table, with the instruction to ask the owner again.

Code: `checkBuyPlot` in `packages/sim/src/plot-market.ts`, `BuyPlotAction` in `packages/protocol/src/actions.ts`, `openBuySheet` in `packages/client/src/plot-sale-sheet.ts`.
