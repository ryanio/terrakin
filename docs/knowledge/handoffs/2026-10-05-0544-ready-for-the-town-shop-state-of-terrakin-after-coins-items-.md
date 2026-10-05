---
title: Ready for the town shop: state of Terrakin after coins, items, partners, putter
date: 2026-10-05
tags: [process, economy, agents, deploy]
---

# Ready for the town shop: state of Terrakin after coins, items, partners, putter

## Done

Everything below is on main and live on terrakin.org. The roadmap in [docs/plans/README.md](../../plans/README.md) is current as of this note.

- Coins phase 1, items (RFC 0005 step 2), partners phase 1 (RFC 0007), check-ins, putter, live posts, did_you_mean and dry runs, media stripping, praise, plot photos, townsfolk handles, trust and safety with the staff app at admin.terrakin.org. Decisions 0037 to 0051 record them.
- Staff: Access in front of admin.terrakin.org (one-time PIN, cookie SameSite Lax and HttpOnly), `TERRAKIN_MAINTAINER_EMAILS` is set to ralxzryan@gmail.com, and Ryan's resident `r_abf2279860f9ce4f` is a Town Hall maintainer (`TERRAKIN_MAINTAINERS` in wrangler.jsonc).
- Ryan's home: plot (6, 3), next to his AI Felipe (`r_c57a064912603b8c`, plot (5, 3)), with a starter hut, four planters, a kitchen, and a workbench.
- Townsfolk tips run daily from Ryan's laptop (launch agent `org.terrakin.townsfolk-tips`, 17:30 local).

## State of things

- In flight: a profile picture control on your own profile (the web had none; only the API could set `avatar`). An agent was building it in `.claude/worktrees/agent-ab5cf126b32d25285` on branch `avatar-upload`; check `git -C <path> status` and `log origin/main..`, finish it, and land it.
- Changing `ECONOMY`, `ITEMS`, recipes, or crop days changes how the live log replays: those need an RFC or a decision that says how old logs replay.
- Pushing: several sessions push to main. Follow the learning on guarded pushes: fetch, check `git merge-base --is-ancestor origin/main HEAD`, check `git diff origin/main --stat` lists only your files, then push, then deploy from a clean tree equal to origin/main.

## Next

1. The town shop (RFC 0008 phase 2): `shop_buy {sku}` and `sell_to_town {item}`, a catalog as data priced by item kind (decor blocks, wear, seeds, frames, lanterns; buy orders for jam and produce with per-day caps), half of shop spending burned and half to the treasury, `GET /v1/shop`, a shop building in the Commons with Clem as shopkeeper, `/shop` on the web, SKILL.md. Rerun `scripts/economy-sim.ts` with the new sinks and record the prices in a decision.
2. The market (RFC 0008 phase 4) and karma (phase 3), in either order.
3. RFC 0005 step 3: pieces, display, galleries, gift gestures that carry an item.
4. Ryan's answers on RFCs 0009 to 0011.

## Open questions

- The MUSEGOD line in the "Bring your AI" popover (`BRING_PARTNER_NOTE` in client/src/chrome.ts).
- Praise is refused on a resident's first UTC day.
