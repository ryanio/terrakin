---
title: Town shop and garment styles live
date: 2026-10-05
tags: [economy, sim, protocol, client, deploy, design]
---

# Town shop and garment styles live

## Done

Both are on main and live on terrakin.org.

- **The town shop** (RFC 0008 phase 2), commit `5684a37`, [decision 0052](../decisions/0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md).
  - `open_shop` opens it. The shop sells four decor blocks (lantern, frame, fence, bench; place them from your things, `remove` gives them back), three pieces of wear that are yours for good (top hat, raincoat, umbrella), seeds, sugar, and jars. Half of each price goes to the treasury, the rest is burned.
  - `sell_to_town` buys three made things and one crop a day on a fixed rotation, 1 or 3 each per resident, at most 17 coins a day. The pantry is 1 sugar and 1 jar a day (up to 6) once the shop is open.
  - `GET /v1/shop`, with Clem as keeper. The shop is also on `/v1/town` and in the snapshot. On the web: `/shop`, and the building on the Commons' south edge, which opens it when tapped. Every item has SVG art and a three.js model, the decor shows on the map and in plot photos, and the build bar shows the decor you hold.
  - `scripts/economy-sim.ts` plays gardens and shopping (`--no-shop` replays decision 0039's month exactly). Supply per active resident ends below the phase 1 world in every run.
- **Style any garment**, commit `061d1a2`, [decision 0053](../decisions/0053-any-garment-can-carry-its-own-pattern-and-color-with-bottoms.md).
  - `wearStyle` gives one garment its own pattern (or your uploaded tile) and color.
  - New slots: bottom (skirt, trousers, shorts) and feet (socks, boots, sneakers), plus a dress that covers the bottom half.
  - The look editor has five slot rows and a styler per garment.
  - `sim/src/fixtures/shop-log.ts` and `looks-log.ts` pin both features' replay hashes.
- Shared helpers: `sim/src/check.ts` and `sim/src/test-support.ts`, `e2e/support.ts`, `listOf` in `ui/src/format.ts`, `garmentName` in `ui/src/looks.ts`, `itemArt` in `ui/src/item-art.ts`.
- Learning: [symlinked package node_modules in a worktree](../learnings/2026-10-05-symlinked-package-node-modules-make-a-worktree-run-the-main-.md).

## State of things

- `pnpm verify` (1,408 tests) and `pnpm e2e` (42) were green at `061d1a2`.
- The treasury now gains half of all shop spending. The simulated month ends near 11,000 against 3,000 before. Grants and bounties (phase 5) are what it's for; otherwise, lower `treasuryMint` by a decision.
- The 3D peg figures still don't show wear or styles.
- In the style editor, pattern thumbnails are hard to see for a pale resident with no theme (snow). The outfit pattern row already had this problem.

## Next

1. Karma (RFC 0008 phase 3) or the market (phase 4). The market should price goods against the town's buy orders (`BUY_ORDERS` in `sim/src/shop.ts`) and decide whether decor can be listed (it moves between co-owners without gift caps today).
2. Move the older e2e specs onto `e2e/support.ts`. Every spec still has its own `join`, `act`, `signIn`, and `watchErrors`.
3. `client/src/garden-sheet.ts`: "All your things" closes the sheet and follows the link in one tap. Closing goes back in history, which likely undoes the navigation. `look-editor.ts`'s `leaveFor` waits for the history step back, and it's the pattern to copy.
4. Contrast for the pattern thumbnails in the look editor on pale colors.
5. Wear and styles on the 3D figures (RFC 0005 step C).

## Open questions

- Should the treasury mint come down now that half of shop spending flows in, or wait for grants?
- Shop prices and the rotation are pinned by the shop log's hash. A change needs a decision on how old logs replay, for example a new logged input that switches to the new numbers.
