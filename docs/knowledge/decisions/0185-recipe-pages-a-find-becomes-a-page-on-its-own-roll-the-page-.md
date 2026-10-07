---
title: Recipe pages: a find becomes a page on its own roll, the page list is frozen, and a page is a pickup kind that teaches instead of filling your things
date: 2026-10-07
status: accepted
tags: [sim, protocol, replay, items, client]
---

# Recipe pages: a find becomes a page on its own roll, the page list is frozen, and a page is a pickup kind that teaches instead of filling your things

## Context

[RFC 0024](../../rfcs/0024-recipes-you-learn.md) says about 1 find in 20 is a recipe page for a recipe that isn't base or holiday, chosen from the day and the tile with no randomness, that gathering one teaches it, and that a page you know is refused as `already_known` and stays. It leaves open how a page fits the find roll, how it's named on the wire, what `gather` with no tile does with one, and what keeps old logs replaying as the catalog grows.

## Decision

- A page only ever stands where a find would. Once finds are out and recipes are learned, a tile whose find roll lands on a find is a page instead when `pageOn(x, y, day)` says so: a roll of its own (its own constants and finalizer), one in `RECIPES_RULES.pageOneIn` (20), with every recipe in `PAGE_RECIPES` as likely. No branch, stone, or other find moves.
- `PAGE_RECIPES` is frozen by name, like `FIND_SPAWNS`: today it's every card. A recipe added later is no page until a new list starts at a logged switch, since a longer list would change the page on every past day.
- A page is the pickup kind `recipe_page`. The snapshot's `pickups` carry its `recipe`, the `gathered` event doesn't (who learned what is private; `recipe_learned` with `how: "found"` says it to the learner). It takes no room, so a full bag still gathers one.
- `gather` with no tile takes each page for a recipe you don't know, one page a recipe, after its stacks; a page you know, or a second one for the same recipe, stays where it lies. When a known page is all that's within reach, it's refused `already_known`.
- The map and the 3D world draw a page like a find, from its own picture (a small scroll, `recipe_page` in `item-art.ts`).

## Consequences

- Finds you can collect are a little rarer once recipes are learned (19 in 20 of what they were); the collection book counts only real finds.
- Changing `pageOneIn` or `PAGE_RECIPES` once recipes are live changes how logged gathers replay, so it needs a logged switch. `recipes.test.ts` pins the page count over four weeks of the real world's size, and `src/fixtures/lessons-log.ts` gathers one.
- Code: `pageOn` and `PAGE_RECIPES` in `packages/sim/src/recipes.ts`, `gatherableAt`, `checkGather`, and `checkGatherAll` in `packages/sim/src/gather.ts`, `pickupsToday` in `packages/server/src/world-wire.ts`.
