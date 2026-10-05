---
title: Shop at 5%, garment styles, and what to build next
date: 2026-10-05
tags: [process, economy, design, agents, deploy]
---

# Shop at 5%, garment styles, and what to build next

## Start here

1. Read `AGENTS.md`, `docs/knowledge/INDEX.md`, and this note. The previous handoff, [Town shop and garment styles live](2026-10-05-0707-town-shop-and-garment-styles-live.md), has the detail on those two features.
2. Work in a worktree when other sessions are active: `git worktree add -b <name> .claude/worktrees/<name> origin/main`, then `pnpm install --frozen-lockfile --offline` there ([why not symlinks](../learnings/2026-10-05-symlinked-package-node-modules-make-a-worktree-run-the-main-.md)).
3. `pnpm verify`. It was green at `4de5f77` (about 1,450 tests), and `pnpm e2e` passed 53.
4. Push with the guarded routine ([learning](../learnings/2026-10-05-never-chain-git-push-onto-a-rebase-or-a-filter-in-one-shell-.md)): fetch, `git merge-base --is-ancestor origin/main HEAD`, `git diff origin/main --stat` lists only your files, push to main, then `pnpm cf:deploy` from a clean tree equal to origin/main. Pick decision numbers from a fresh origin/main right before committing.

## Done

All on main and live on terrakin.org.

- **The town shop.** Decision 0052. `GET /v1/shop`, `/shop`, the shop building in the Commons, and Clem as keeper.
  - What it sells and buys is in the decision; prices were tuned with `scripts/economy-sim.ts`.
  - The treasury gets **5%** of shop spending and the rest is burned (`8ed3f57`).
  - The live log's first 36 purchases were at 50%. The switch is a logged `set_shop_share`, so they still replay at 50%. To retune, change `SHOP.treasuryShare` and deploy, and the server logs the switch.
- **Style any garment.** Decision 0053. `wearStyle` gives any garment a pattern and color of its own. Bottoms and feet are new slots, plus a dress. The look editor has a styler per garment.
- **e2e helpers.** Specs share `e2e/support.ts` (`5dd141f`).
- **Sheet links.** Links out of a sheet go through the router's overlay close, so they no longer undo their own navigation (`4de5f77`).
- **Learnings:** [the changelog stamp](../learnings/2026-10-05-an-unpushed-changelog-entry-stamped-before-a-later-api-chang.md), [port 8790](../learnings/2026-10-05-two-e2e-runs-at-once-collide-on-port-8790.md).

## Next

In order. Each is startable from main as it is.

1. **Land PR ryanio/terrakin#39** (Felipe's devlog, docs only, checks green). Read it, fix anything that breaks repo style (no em dashes, plain words), and merge. Contributor PRs get landed, not just commented on.
2. **Karma, RFC 0008 phase 3.** The RFC's "Karma" section is the spec: a rolling 90-day score outside the sim, tiers, a profile number, and reactions counting toward appreciation coins only from Neighbor and up.
   - Praise rows are already kept for it (`server/src/praise.ts`).
   - Appreciation coins reach the sim through a logged `daily_awards` at `new_day`, the way decision 0027 brings townsfolk in.
   - Write a decision for the weights and tiers, and run the economy sim with the new faucet.
3. **The market, RFC 0008 phase 4.**
   - `list_item`, `unlist_item`, and `buy_listing`, with escrow held in the sim.
   - A 5% fee to the treasury and a 1-coin listing fee that's burned.
   - `/market` on the web, and stalls on profiles.
   - Price goods against `BUY_ORDERS` in `sim/src/shop.ts`. Decide whether decor can be listed: today it moves between co-owners without gift caps.
4. **Wear and styles on the 3D figures** (`client/src/scene3d/plot.ts` draws peg figures with no wear). Read `wearStyle` the way `ui/src/figure.ts` does, through `garmentLook`.
5. **Pattern thumbnails on pale outfits.** In `client/src/look-editor.ts`, thumbnails are drawn on the garment's main color, so a snow resident with no theme can barely see stripes. Give the thumbnail a contrasting backing when the color is light.
6. **Issue ryanio/terrakin#21, deploy on green.** A workflow that runs `pnpm cf:deploy` when main's CI passes. The `cf-deploy-token` skill sets up the Cloudflare token.

## Open questions for Ryan

- RFCs 0009 (offline routines), 0010 (hosted events), and 0011 (party games) are still drafts waiting on you. They're also issues ryanio/terrakin#32, #33, and #37.
- Issue ryanio/terrakin#40, welcome kits: residents giving starter items to newcomers. Is that a shop item, a gift with no caps on someone's first day, or a townsfolk job?
- The treasury now grows slowly. Grants and bounties (phase 5) are the planned outflow; how soon?
