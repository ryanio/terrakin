---
title: Karma, the market, 3D wear, and deploy on green
date: 2026-10-05
tags: [process, economy, social, client, deploy, agents]
---

# Karma, the market, 3D wear, and deploy on green

## Start here

1. Read `AGENTS.md`, `docs/knowledge/INDEX.md`, and this note.
2. Work in a worktree when other sessions are active (`git worktree add -b <name> .claude/worktrees/<name> origin/main`, then `pnpm install --frozen-lockfile --offline`).
3. `pnpm verify` was green at `2d1ece5` (about 1,530 tests), and `pnpm e2e` passed 55.
4. **Main now deploys itself.** CI's `deploy` job runs `pnpm cf:deploy` once verify, e2e, and secrets pass on a push to main ([docs/deploy.md](../../deploy.md)). Its first run is the push of `2d1ece5`; if it went red, the likely cause is the two-day-old `CLOUDFLARE_API_TOKEN` secret's scope, and the `cf-deploy-token` skill makes a new one.

## Done

All on main and live on terrakin.org.

- **Felipe's devlog (PR ryanio/terrakin#39)** landed as `a23f333` plus a fix-up. The PR shows closed, not merged: the force-push to its branch was refused, so the rebased commits went to main directly.
- **Karma**, [decision 0055](../decisions/0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md):
  - Profiles carry `karma: {score, tier}`, scored once a UTC day over 90 days. Sources: reactions (weighted by the reactor's tier), praise, gifts, hearted replies, votes, and upheld reports.
  - Appreciation coins reach the sim as a logged `daily_awards`: 1 per Neighbor reactor, up to 20, catching up to 7 missed days.
  - A household (a person and every AI they claimed) never counts for itself.
- **The market**, [decision 0056](../decisions/0056-the-market-holds-listings-in-escrow-in-the-sim-burns-a-listi.md):
  - `list_item`, `unlist_item`, and `buy_listing`, with lots held in escrow in the sim, a burned 1-coin listing fee, and a 5% fee to the treasury.
  - A sale keeps to the gift caps, and nobody buys on their first day. Buyers aren't named anywhere.
  - `GET /v1/market`, `/market`, and a stall on each profile.
- **3D figures wear their wear** (`client/src/scene3d/wear.ts`), colored from one table, `GARMENT_COLOR` in `ui/src/figure.ts`, which the 2D figure uses too.
- **Look editor:** pattern swatches on pale outfits sit on a darker backing (`swatchBacking`), and section labels have room before their chips.

## Next

1. **Turn on the Neighbor gate for listing** once residents reach it. It's `MARKET_LISTING.tier` in `protocol/src/market.ts`, `newcomer` today because nobody on the live world was a Neighbor. Add a changelog entry when it changes.
2. **Grants and bounties, RFC 0008 phase 5.** Karma already reserves a `bounty` source (5 points) for completed bounties.
3. **Market follow-ups from review** (decision 0056, Consequences):
   - A staff action that removes one listing, since a made thing's label is now public.
   - Paging on `GET /v1/market` past 200.
   - Listing expiry, if stale ones pile up.
4. **Karma follow-up:** praise weighted by the giver's tier, or a minimum age before Neighbor, if account rings farm appreciation. The risk is written up in decision 0055.

## Open questions for Ryan

- **The market's listing gate.** It ships as a hearth plus 3 days in Terrakin, not the RFC's Neighbor tier. Keep it, or switch to Neighbor once some residents get there?
- RFCs 0009 to 0011 are still drafts (issues ryanio/terrakin#32, #33, #37), and issue ryanio/terrakin#40 (welcome kits) still needs a call.
- Two decisions share the number 0052. Renumbering one would break links, so they stay.
