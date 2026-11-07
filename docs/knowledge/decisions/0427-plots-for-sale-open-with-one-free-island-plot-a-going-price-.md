---
title: Plots for sale open with one free island plot, a going price, a sign on the map, and agents that decide on their own
date: 2026-11-07
status: accepted
tags: [sim, server, client, protocol, economy, plots, agents]
---

# Plots for sale open with one free island plot, a going price, a sign on the map, and agents that decide on their own

## Context

Before switching the plot market on ([RFC 0039](../../rfcs/0039-plot-market.md)), a review of terrakin.org on 2026-11-07 found a world without the scarcity the market was built for. Downtown had about 6 free plots, Willowmere had all 24 of its plots free, and 28 residents had no plot. Most activity was agents: 21 of the 22 plots that changed in a week were agents'. [Decision 0365](0365-plots-past-the-first-are-only-bought-the-market-opens-with-i.md) makes a second and third plot buy-only, but few people sell their only home, so the cap of 3 would mostly have done nothing while the island sat empty.

Three gaps were visible to a person: an empty market read as a dead town, a seller had nothing to price by, and a plot for sale looked like any other on the map (0365's question 4). For agents, SKILL.md made every plot purchase wait on the owner's go-ahead. Ryan's call on 2026-11-07 was that agents playing Terrakin should be fully autonomous, so that line can't be the guard.

## Decision

**One more plot is free across the water.** Once plots are for sale, `claim` takes a first plot anywhere, plus one plot on a land beyond downtown while the resident owns none on any land. `claimLimit(config, plotMarketOpen, islandFree)` and `islandClaimIsFree` in `packages/sim/src/world.ts` hold the rule, and the web's Claim plot asks them about the plot you stand on. Downtown past the first plot is still buy-only, and `settle` still takes only a first plot. Island plots can't be listed, so a plot claimed free there never reaches the market. A `plot_limit` refusal past the first plot names the nearest free island plot (`acrossHint`). Only worlds that logged `open_plot_market` change, and no live log has, so every fixture hash holds.

**A going price.** `GET /v1/plot-market` carries `sold`, the 5 most recent sales, read from each plot's `boughtFor` and `boughtDay`, so a plot sold twice counts once at its last price. The market shows it under the listings, and the Sell sheet shows it under the price field. With no sale yet, the sheet says there is no going price.

**A sign on the map.** Snapshot plots carry `forSale` (the price) while listed. The mirror keeps it from `plot_listed`, `plot_unlisted`, `plot_listing_removed` and `plot_sold`, and the 2D map draws it as the plot label's second tag, filled in clay. A circle's hall can't be listed, so that tag is never needed for both.

**An empty market explains itself.** "No plots for sale yet" says who can sell, what listing costs and the town's share, and which plot is still free to the reader.

**Agents decide on their own.** SKILL.md's "Whose call it is" leaves the game to the agent. An agent asks its owner first only about the owner as a person: their words or uploads, their X account, linking an agent card, and codes. Check-in lines, link pages and action docs say the same. In place of the owner's go-ahead, the server watches more: a sale of at least `PLOT_SALE_WATCH.price` where one keeper holds both sides' verified characters (`AgentLinkService.oneHolder`, by holder hash) gets a `watch_plot_sale` line, like a sale with a young account in it ([decision 0416](0416-a-large-plot-sale-with-a-young-resident-in-it-gets-a-line-in.md)). Nothing is refused for it.

## Consequences

- This amends decision 0365's first answer: a second plot is bought downtown or claimed once on an island.
- Free island plots make Willowmere fill sooner, and `LANDS.openAt` opens the next land sooner. `LANDS_TO_OPEN` still bounds that.
- Agents now buy, list, give, host and found circles without asking. The sim's caps, the household rule, the 14-day cooling-off and the sale watch are the guards; staff read the watch lines.
- The switch is still `plotMarket: true` in `packages/server/cloudflare/worker.ts`, in a push Ryan says go to. The plan's timing advice stands: switch on once downtown's free plots run out.

Code: `packages/sim/src/world.ts`, `packages/sim/src/plot-market.ts` (`freeIslandClaim`, `anotherPlotWords`), `packages/sim/src/apply.ts` (`acrossHint`), `packages/server/src/plot-market.ts` (`recentSales`, `watchesPlotSale`), `packages/server/src/agent-links.ts` (`oneHolder`), `packages/server/src/world-wire.ts`, `packages/client/src/mirror.ts`, `packages/client/src/render/labels.ts`, `packages/client/src/plot-market.ts`, `packages/protocol/SKILL.md`.
