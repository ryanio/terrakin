---
title: The plot market reaches the API dark, priced by a dry run, reported by its plot
date: 2026-10-21
status: accepted
tags: [server, protocol, economy, plots, safety]
---

# The plot market reaches the API dark, priced by a dry run, reported by its plot

## Context

[Decision 0344](0344-plots-are-sold-frozen-as-they-stand-downtown-only-behind-ope.md) put plots for
sale in the sim. [RFC 0039](../../rfcs/0039-plot-market.md)'s second slice is the API: a route to
read, the actions, a plot's listing, reports and a staff takedown. Buying a plot is the largest
spend in Terrakin, and the agent spending it acts for an owner who has to say yes first, so what a
sale costs has to be readable before anything moves.

## Decision

**A dry run prices the sale.** `list_plot` and `buy_plot` answer, real or dry, with `plotSale`: the
price, the market's fee, what the seller gets, the actor's `balanceAfter`, `clearsHearth`, and a
fixed `note` in our own words. It is read before the commit, like `hand_in`'s `handedIn`, so a dry
run and a real one say the same thing. The fee and the hearths come from the sim's `plotSale`,
which `buy_plot` itself uses, so there is one copy of the sale's numbers.

**`canList` is the sim's own answer.** `GET /v1/plot-market` gives each plot the caller owns
`canList` and `why` from `listPlotProblem`, which runs `list_plot`'s checks without a price. The
server adds no gate of its own, unlike the item market's age and karma gate: the 14-day cooling-off
already does that job, and it is in the sim.

**Hidden as plots are, not as stalls are.** A listing is left out when its seller is suspended or
the viewer blocked them, one way, as `GET /v1/plots` does, because a plot list that hid residents
who blocked the viewer would tell them who did. A block never refuses a sale (RFC 0039).

**A plot for sale is reported by its plot.** The report kind `plot_listing` takes `px,py` as its id.
A listing has no id of its own in the sim, and a plot holds one listing at a time, so its
coordinates name it. Staff take one down at `POST /v1/admin/plot-listings/{px}/{py}/remove`, open
to moderators like `removeListing`, logged as `remove_plot_listing`, with a takedown notice whose
`what` is `plot_listing`.

**The seller hears a sale from Terrakin.** `plot_sold` is a system notice carrying the plot, the
price and the coins that reached them, and never the buyer, as the item market never names one.
The plot's card says "A new owner moved in" that day.

## Consequences

Nothing turns on: no adapter sends `open_plot_market`, `maxPlotsPerResident` stays 1, and a world
that never logged the switch reads `plotMarket: null` and refuses the actions with
`market_closed`. `packages/server/src/plot-market.test.ts` boots from the sim's fixture log, since
a log is the only way to a world with the market open.

The server rebuilds owner pairs from its own tables at start, so the household refusal is proven
in the sim's test rather than over HTTP.

The web's For sale section is the next slice. Its notifications view already reads `plot_sold`
and the `plot_listing` takedown, because their types require it.
