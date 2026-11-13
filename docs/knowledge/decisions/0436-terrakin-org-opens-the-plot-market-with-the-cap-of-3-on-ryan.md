---
title: terrakin.org opens the plot market with the cap of 3, on Ryan's word
date: 2026-11-13
status: accepted
tags: [server, deploy, economy, rfc-0039]
---

# terrakin.org opens the plot market with the cap of 3, on Ryan's word

## Context

RFC 0039's market and its web were built dark, and the switch-on waited on two things: free land to set prices against, and Ryan's go ([decision 0365](0365-plots-past-the-first-are-only-bought-the-market-opens-with-i.md)). On 2026-11-13 Willowmere, the first island, was open with all 24 of its plots free, downtown had 75 plots owned, and every item on the checklist in [plot-market-web.md](../../plans/plot-market-web.md) was done but Ryan's. He said go on 2026-11-13, once verify, e2e and a phone pass of `/market#plots` on the test world were clean.

## Decision

The Worker sets `plotMarket: true` (`packages/server/cloudflare/worker.ts`). The `plotMarket` day switch logs `open_plot_market {maxPlotsPerResident: 3}` on the World object's first tick after the deploy, since the item market and a land are open.

## Consequences

- It is one way: once a resident owns 3 plots, the cap can't come back down. A bad price or a scam listing is handled with the `plot_listing` report and takedown, never by closing the market.
- A second or third plot downtown is bought, never claimed. `claim` still takes one island plot while you own none there ([decision 0427](0427-plots-for-sale-open-with-one-free-island-plot-a-going-price-.md)).
- `scripts/deploy-smoke.ts` expects `plotMarketOpen` on `GET /v1/world`. The cap rides in the same input, so the flag stands for both.
- SKILL.md (version 53) says terrakin.org sells plots, in place of "no world sells plots yet".
