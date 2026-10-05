---
title: Putter, items, partners, praise, plot photos, hygiene all live
date: 2026-10-05
tags: [process, deploy, sim, economy, social, agents]
---

# Putter, items, partners, praise, plot photos, hygiene all live

## Done

All on main and deployed to terrakin.org (last deploy from d32fa13). `pnpm verify` (1,323 tests) and `pnpm e2e` (37) pass.

- **Putter** (decision 0049): `{"type": "putter"}` and `/v1/act/{key}/putter`. A short walk the sim plans (the log records the steps, so replay never runs the planner) and one wave at someone in earshot. Once a minute, 60 a day; one putter wave per pair a day; no streaks; never ends next to someone blocked either way. SKILL.md's check-in routine says to putter once each check-in.
- **Items, RFC 0005 step 2** (decision 0051; RFC 0005 accepted for steps 1 and 2): planters, kitchens, workbenches, crops that grow by the world's day, 8 recipes, a daily pantry, `give` for things, `GET /v1/inventory`, `/inventory` on the web. Items opened on production at seq 557.
- **Partners phase 1** (RFC 0007, decision 0050, closes #29): verified agents by `POST /v1/agent-link`, the MUSEGOD badge, ring and flair, `GET /v1/partners`, chain reads on Robinhood chain 4663 with a daily read budget, hourly rechecks, a sale drops the badge.
- **Praise** (#36, decision 0047), **plot photos** (#34, decision 0048, drawn by the Worker's own `PlotPhotos` service binding), **townsfolk handles** (claimed on production: @juniper and the rest).
- **Hygiene pass**: dead code, shared test helpers, docs drift.
- **Main repair**: 938a564 (another session's stale-tree squash) reverted landed work; 7ec6535 restored it. See the learning on guarded pushes.

## State of things

- Open GitHub issues left: #21 (CI deploy, needs a Cloudflare token as a GitHub secret), #23 (playtest), #32, #33, #37 (RFCs 0009 to 0011 drafted, waiting for Ryan).
- `BRING_PARTNER_NOTE` in client/src/chrome.ts puts a MUSEGOD line in the "Bring your AI" popover; Ryan hasn't confirmed it. Set it to null to remove it.
- Praise is refused on a resident's first UTC day; Ryan may want something softer.
- Changing `ITEMS`, a recipe, a crop's days, or `ECONOMY` changes how the live log replays: those need an RFC now.

## Next

1. Coins phase 2, the town shop (RFC 0008): price the item kinds, `shop_buy`, `sell_to_town`, sinks (half burned, half to the treasury); retune the pantry if the shop sells sugar, jars, and seeds.
2. RFC 0005 step 3: pieces, display, galleries. Gift gestures that carry an item, and declining gifts.
3. Partners phase 2: the muse's own art as the avatar (needs MUSEGOD's license), owner flair.
4. Ryan's answers on RFCs 0009 to 0011, then build the chosen one.
5. Ryan: `npx wrangler secret put TERRAKIN_MAINTAINER_EMAILS`; Access cookie SameSite Lax, HttpOnly, a week, in Zero Trust.

## Open questions

- The MUSEGOD popover line, the first-day praise rule, and the open questions in RFCs 0009, 0010, 0011.
