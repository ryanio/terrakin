---
title: Plots past the first are only bought, the market opens with its cap in one push Ryan approves, and the web shows nothing while it is off
date: 2026-10-22
status: accepted
tags: [sim, server, client, economy, plots, numbers]
---

# Plots past the first are only bought, the market opens with its cap in one push Ryan approves, and the web shows nothing while it is off

## Context

[RFC 0039](../../rfcs/0039-plot-market.md) raises `maxPlotsPerResident` from 1 to 3 in the push that opens the plot market. [The plan for the web](../../plans/plot-market-web.md) found that the cap lived only in `state.config`, which no input changed, and that `claim` read it: at a cap of 3 every settled resident would get Claim plot back, and the plots left downtown and on every island would become free second homes the day the market opened. It asked Ryan five questions. His answers, on 2026-10-22:

1. A second and third plot come only by `buy_plot`. `claim` and `settle` take a first plot and no other, before the market opens and after (the plan's option b).
2. The market opens in a push he approves, not on its own when the first island opens.
3. Nothing about plots for sale shows anywhere on the web while the market is off.
4. No "For sale" sign on the map or the `/visit` cards in the first version.
5. After a purchase the web offers Go there, and leaves the buyer's hearth where it is.

## Decision

**The cap rides on the switch.** `open_plot_market` carries `maxPlotsPerResident` and sets `config` in the same input, so a world can't hold more plots a resident than its log says. It is refused below today's cap (someone may already own that many) and above `PLOTS.capMax` (3), since a slip would stay for good. `plot_market_opened` carries the number, and the web's mirror raises its `config` from it.

**A plot past the first is only bought.** `claimLimit(config, plotMarketOpen)` in `packages/sim/src/world.ts` is the world's cap until plots are for sale and 1 after. `claim` refuses past it with `plot_limit`; `settle` was always first-plot-only. The words say buying is the way to another. The world's Claim plot button asks the same function of the mirror, so it doesn't come back at a cap of 3. A world that never opens the market claims exactly as it did, so every older log replays unchanged and only the plot market fixture's hash moved.

**The switch exists, and no adapter sets it.** `WorldService` has a `plotMarket` option, whose `DAY_SWITCHES` entry logs `open_plot_market` with a cap of 3 once the item market and a land are open. Neither the Worker nor the Node server sets it. A test world opens it with `POST /v1/test/open-plot-market` (loopback, test clock only), and `pnpm persona --open-plot-market` calls that. Switching it on is `plotMarket: true` in `packages/server/cloudflare/worker.ts`, with the checklist in the plan, in a push Ryan says go to.

**Dark means absent.** `/market` reads `GET /v1/plot-market` beside `/v1/market`, and while it answers `plotMarket: null` the page draws no plots section, no "Your plots", and no teaser line. This differs from the jobs board, which says it isn't open yet, on purpose: nobody can do anything about plots for sale until the island opens and Ryan opens the market, and a promise on the page would be one more thing to explain at the playtest. The visit card and the world say nothing either.

**The web's shape.** Plots for sale lead `/market` (`/market#plots`), above the item listings, which become "Things for sale". Buying and listing each open a sheet that runs a dry run first and shows its numbers, then pays on a second tap. After a purchase the toast offers Go there; the buyer's hearth stays where it was, since moving it is their call and `set_hearth` is one tap away on the plot.

## Consequences

- The refusal copy is one pure function, `plotMarketProblem` in `packages/client/src/plot-market.ts`, tested in the market's table. A listed plot's `plot_listed` in the world gets plain words in `worldProblem`, so an agent's JSON never reaches a person.
- The purse names the plot market's coin lines (`plot_buy`, `plot_sale`, `plot_listing_fee`) and the item market's.
- Left for later: `forSale` on the snapshot's plots, for a sign on the map (question 4), and the switch-on push itself, with the economy rerun and the deploy smoke check.

Code: `packages/sim/src/plot-market.ts` (`checkOpenPlotMarket`, `anotherPlotWords`), `packages/sim/src/world.ts` (`claimLimit`), `packages/server/src/world-service.ts` (the `plotMarket` switch, `testOpenPlotMarket`), `packages/client/src/plot-market-section.ts`, `packages/client/src/plot-sale-sheet.ts`.
