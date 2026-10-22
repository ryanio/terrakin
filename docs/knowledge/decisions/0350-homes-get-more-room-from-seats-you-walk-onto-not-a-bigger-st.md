---
title: Homes get more room from seats you walk onto, not a bigger starter hut
date: 2026-10-22
status: accepted
tags: [homes, furniture, sim, economy]
---

# Homes get more room from seats you walk onto, not a bigger starter hut

## Context

Homes felt small and had nothing in them to use. Most of the town is the starter hut, whose inside is 3 by 3 with the hearth in the middle, so it holds seven pieces with the way to the hearth kept open. [RFC 0044](../../rfcs/0044-cozy-homes.md) weighed three ways to more room: a bigger starter hut for new homes only, more floors, and tighter footprints.

A bigger hut changes what a logged `build_starter_home` builds, so it needs a logged switch and leaves the town with two hut sizes, and it helps none of the homes that exist. The upstairs over a hut can already be floored over the whole plot, so more room up there is a question of its 200 coins, which decision 0242 settled.

## Decision

Tighter footprints: the armchair, the sofa and the bed are walked onto, like stairs (`WALKED_ONTO_SEATS` in `packages/sim/src/furniture.ts`, read by `blocksWalkers` in `world.ts`). The chair and the bench stay solid, since making them walked onto would change how logged walks replay, but all five are seats `rest` puts you on. Resting is where you stand, never a field.

The three pieces are made at a workbench with wood and cushions. A cushion is 5 coins at the shop and the town never buys one back, so it is a sink with no faucet; the three cards are 20, 25 and 30 coins by `recipeCardPrice`. The cards join recipe page edition 3, which the Worker sets, and three townsfolk teach them (`SPECIALTIES` in `packages/server/src/lesson-plan.ts`).

`scripts/economy-sim.ts` plays it: makers who have made every wood-and-stone piece they know buy a card and cushions for each cozy piece in turn, and `--no-cozy` plays the month without them. In the default autumn month (seed 1), one maker got there, late, and made an armchair and a sofa for 45 coins of cards and 15 of cushions. Supply per active resident ended at 301 against 302 without them, the treasury 2 coins higher, and every check RFC 0029 and RFC 0030 make of the month still holds. A cushion only ever burns coins, so its price can lower supply and never raise it; 5 keeps a piece within a day of allowance.

## Consequences

- Every home, the existing huts too, can hold a bed, a sofa and an armchair without walling a room off, and RFC 0032's notes never flag one.
- A route may cross a sofa; someone who stops on one is resting there. That oddity is the price of no new state.
- A bigger starter hut is still open, behind a logged switch, now that the hut hangs a door (decision 0349). It is RFC 0044's open question for Ryan.
