---
title: Plots are sold frozen as they stand, downtown only, behind open_plot_market
date: 2026-10-21
status: accepted
tags: [sim, economy, numbers, protocol, replay, plots]
---

# Plots are sold frozen as they stand, downtown only, behind open_plot_market

## Context

[RFC 0039](../../rfcs/0039-plot-market.md) proposed a market for plots on the item market's shape,
with the plot itself as the escrow. Ryan settled its open questions on 2026-10-20 and 2026-10-21:
`maxPlotsPerResident` rises to 3, a sale is exempt from the gift caps and refused inside a
household, the first version is downtown only, listing costs 25 coins and waits 14 days, and the
cap rises in the push that turns the market on, after the first island opens. This records the
sim slice, which ships dark.

## Decision

The sim gains `list_plot`, `unlist_plot` and `buy_plot` for residents, and `open_plot_market` and
`remove_plot_listing` for `TOWN_ACTOR`, in `packages/sim/src/plot-market.ts`.

**A listed plot is frozen.** `plotListedProblem` refuses `plot_listed` from every rule that changes
a plot: placing, removing, laying and lifting, a build plan, the starter home, a floor, a roof, a
hearth, sharing and unsharing, releasing, planting, harvesting, a display, a gallery, a name, an
event, a hall, and staff's `clear_block`. That is what makes the sale honest without a snapshot:
the buyer gets the plot they read.

**A sale moves the record, not the land.** Blocks, ground, floors, crops and the roof are keyed by
tile or kept on the plot's record, so only `ownerId` changes, and nothing can be copied. What is a
person's does not go with it: every hearth on the plot is cleared and every co-owner unshared,
with the same events `release` and `unshare_plot` emit. The plot's name and its `namedBy` go with
it, still untrusted. `boughtDay` is set, so the 14-day cooling-off runs again and a bought plot
can't be flipped at once.

**Coins:** the 25-coin listing fee is burned and stays burned if the listing is taken back or
removed. The buyer pays the price, the seller gets it less `marketFee` (5%), and the fee goes to the
treasury. Nothing is minted, so the supply identity needs no new term, and every input of the
fixture log checks it.

**Who:** only the owner lists. Townsfolk don't trade. A buyer must be under the plot cap, have the
coins, and not be in the seller's household. A sale skips the gift caps, because the plot is real
payment, and the household refusal is the guard that exemption rests on.

**What can't be listed:** a plot on an island, one within 14 days of being claimed or bought, a
circle's hall, a plot with an event booked, or one with anything on display.

`open_plot_market` needs the item market open and a second land, so free land exists whenever
prices do. `merge_resident` refuses a record with a plot for sale, as it does one with a market
lot.

## Consequences

Replay is untouched. No log holds `open_plot_market`, so every new command is refused in every
existing world and the freeze never fires; all 54 older sim suites pass unchanged and
`REPLAY_VERSION` does not move. `src/fixtures/plot-market-log.ts` pins a log that lists, takes back,
lists again and sells.

The wire gains the five plot events and the `plot_listed` error code. No route sends the commands
yet and no adapter sends `open_plot_market`, so no world sells a plot. The API (`GET
/v1/plot-market`, the actions, `listing` on a plot, reports), the web, the economy run with a sale
in its month, and the switch with the cap at 3 are the next slices, in that order.

The freeze is a list the compiler can't check. `plot-market.test.ts` holds a table of every
plot-changing command tried against a listed plot; a new rule that changes a plot belongs in it.
`set_circle_hall` is checked in code and missing from the table, because only a formed circle
has a hall.
