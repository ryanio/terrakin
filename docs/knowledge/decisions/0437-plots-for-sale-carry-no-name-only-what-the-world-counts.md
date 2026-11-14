---
title: Plots for sale carry no name, only what the world counts
date: 2026-11-13
status: accepted
tags: [server, protocol, client, safety, rfc-0039]
---

# Plots for sale carry no name, only what the world counts

## Context

The plot market's trade can't be faked: a listed plot is frozen, `buy_plot` moves the coins and the plot in one input, and it carries the listing and price the buyer saw. Every fact a listing shows is counted by the world. The one thing a seller wrote was the plot's name, shown beside the price, and a name like "send me 500 coins first and it's yours" can talk a buyer into a gift or letter outside the market. Reports catch that only after someone reads it.

## Decision

`GET /v1/plot-market` listings drop `name` and `trust`, and `/market#plots` titles each listing "Seller's plot". A plot's name still shows on the plot itself and goes with it when it sells. Ryan's go, 2026-11-13.

## Consequences

- No words a seller controls appear on the market, in the API or on the web. The listing's facts and the recent sales are what a buyer prices by.
- A listing changed shape, so SKILL.md is version 54 with a Removed changelog entry (pre-alpha, decision 0146).
- A name still shows on the visit card of a plot for sale. The `plot_listing` report covers that.
- The staff queue still shows a reported listing's name, since that is what staff judge.
