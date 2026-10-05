---
title: Market moderation, bounties, pieces and galleries, 3D world, partner wear, gathering
date: 2026-10-05
tags: [economy, items, 3d, partners, safety, e2e, deploy]
---

# Market moderation, bounties, pieces and galleries, 3D world, partner wear, gathering

Follows [Open follow-ups after karma, the market, 3D wear, and deploy on green](2026-10-05-1821-open-follow-ups-after-karma-the-market-3d-wear-and-deploy-on.md). Every item on its list is done.

## Done

- Deploys: CI's `deploy` job is the only path. Cloudflare Workers Builds has no builds for `terrakin`; its GitHub check suite sits queued and never runs. `bd0b824` lets a superseded CI run deploy when every newer commit is `[skip ci]` (those get no run, so before this a feature followed by a docs commit never went out).
- Market: paging with `before` and `next` (`f3f5bdc`); staff take down a listing, residents report one (`44df920`, `b75b62a`, decision 0056).
- Karma: Newcomer praise counts 1 (`015e245`, decision 0055).
- Grants and bounties, RFC 0008 phase 5 (`bacd06c`, `88bc5c7`, decision 0062). A maintainer confirms town bounties and releases grants.
- RFC 0005 step 3: gifts carry a thing and can be sent back (`d2b291a`, 0057); pieces, display, admire, galleries (`2c52121`, `283188c`, `40a45b5`, `a7248ae`, 0059).
- Staff take a thing off display or delete a piece's picture (`6e4b450`); a former co-owner can't pin a pedestal (`eef8e93`).
- Id safety: every sim and server lookup keyed by request input goes through `sim/src/own.ts` (`22aeb6a`). Before, `__proto__` as a recipient or co-owner was accepted, and some cases threw after being logged.
- The world in 3D, RFC 0005 step C (`f85d585`, `d3f7827`, `5f17b81`, decision 0060), then displays and crops in both 3D views (`fdab775`).
- Partners, RFC 0007 phases 2 and 3 (`486ff06`, `b88fd92`, decisions 0058, 0061).
- Gathering wood and stone, landed from musefelipe's ryanio/terrakin#42 (`e6026ff`, decision 0063).
- Tests: the flaky share-home e2e (`6317884`); six flaky unit tests (`0fb6786`), the worst being test servers on every address picking up Tailscale's 127.0.0.1 port; the two 3D specs now run alone at the end of the e2e chain (`3d42b5a`), which is what kept main red.
- `TERRAKIN_E2E_PORT` runs a second e2e suite from another worktree (`e2e/ports.ts`).

## State of things

- `pnpm verify` and `pnpm e2e` (62) pass at `3d42b5a`. CI on main failed from `0fb6786` to `e6026ff` on the 3D specs alone, so nothing after the takedown commits deployed until `3d42b5a`'s run. Check `gh run list --repo ryanio/terrakin --branch main` and `/v1/health` first.
- The id-safety change refuses `share_plot`, grants, and gifts to inherited ids that were accepted before. If the live log ever held one, replay would fail at boot and CI's health check would go red. A green deploy of `3d42b5a` or later rules it out.
- 3D numbers in decision 0060 are from headless Chromium only, never a real mid-range phone.
- Many agents running e2e at once pushed load past 100 and timed out the 3D specs locally. Run them alone before blaming a change.

## Next

1. Piece pictures purged by other moderation (hiding a post, deleting a resident's pictures) still point at the deleted file until a `piece` report clears them. Clear them in the same purge (decision 0059 notes it).
2. Check-ins don't tell an agent that a taken-down lot went straight back to its things (decision 0056).
3. With Cloudflare Access sign-in, the sim can't tell a maintainer is also a bounty's claimant or proposer. Map Access emails to residents, then extend the household check (decision 0062).
4. The RFC 0008 20-coin proposal deposit isn't built.
5. Partners: the RFC's owner flair ("Keeper of Saddlebag"), placed partner decor, and a `kept` flag for promo items.
6. 3D: draw `.glb` pieces as models under a per-piece budget, or keep the framed placeholder; measure on a real phone.

## Decided after this note (Ryan, 2026-10-05)

- Only a plot's owners gather on it; the Commons and open land stay open (`9c7a3cf`, decision 0063). It switched on at a logged point, so earlier gathers replay.
- In 3D the d-pad walks the way the camera looks (`e62fa6e`, decision 0060).
- Staff takedowns send the owner a notice from Terrakin naming the rule (`acd9e5c`, decision 0064).
- MUSEGOD runs no promo until it agrees to one (`ab6a2c5`, decision 0061).
- Kept as built: a maintainer confirms town bounties and releases grants; the first partner designs; muse art as avatar only when there's none; admiring from anywhere, karma only; the 3D toggle hidden on low-end phones; the shop's facing left alone. Check the grant cap against the treasury before a big grant.
- Pillar and Elder praise counts 3, like reactions (`7bac79f`, decision 0055).
- A cheapest-order market page whose cursor sold keeps answering `bad_request`. If the market passes 200 listings, make the cursor price plus id so it never fails.
- `MARKET_LISTING.tier` goes to `neighbor` on a trigger, not a date: about 25 active Neighbors, or the market's first real abuse case, whichever comes first.

## Open questions

- Who approves a new partner (Ryan for now; the bar is a takedown contact and an art license, to write into RFC 0007 when a second partner asks).
- From before: RFCs 0009 to 0011 and ryanio/terrakin#40.
