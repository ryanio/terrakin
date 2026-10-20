---
title: Made materials are a role of their own, never learned, and never free
date: 2026-10-20
status: accepted
tags: [sim, protocol, client, design, economy]
---

# Made materials are a role of their own, never learned, and never free

## Context

Walls were four blocks: wood, stone, glass and leaf, free and unlimited. The design picker offered
fewer still, two walls and two windows, so a newcomer chose between a brown house and a grey one
and the Visit page was a row of near-identical homes.
[RFC 0041](../../rfcs/0041-materials-and-roofs.md) proposed made materials to fix that. Building it
forced four choices the RFC left open or got wrong.

## Decision

**A role of their own (`material`), in the existing Materials family.** The cheap path was the
`furniture` role, which would have needed no new plumbing at all: `isHeldBlock`, `craft`, `place`
and `remove` would all have worked untouched. It was rejected because the words would have lied in
two places a person and an agent both read: SKILL.md's generated furniture table would have called
a brick wall furniture, and the workbench sheet would have listed it under Furniture. The family is
the existing `material`, where wood and stone already live, so nothing new was needed there.
`STACK_KINDS` takes the new role on the very end, after fish, so no kind that shipped earlier moves.

**Never learned.** RFC 0024 turns every catalog recipe into a card unless it is base or a holiday's,
so adding materials silently put five building supplies on the Recipes shelf with prices, and three
tests went red. They are left out of `RECIPE_NAMES` instead: `knowsCraft` always has them,
`recipeUnknown` passes them, and there is no card, no page and no lesson. Two reasons. The scarcity
that makes a brick wall earned is the stone and the walk to the shore, and a card in front of it
would be a second gate on the same thing. And `recipes.test.ts` holds every card's price to paying
back in 5 to 30 days of selling what it makes, which cannot mean anything for a wall the town never
buys.

**Never free, and the free four stay free.** `BUILDING_BLOCKS` is still exactly wood, stone, glass
and leaf. That list is what a Town Hall `commons_build` may place from nobody's things and what a
plot's theme recolors, and a material someone crafted should be neither: free to the town would let
a proposal mint forty bricks, and themed would repaint a choice its owner made deliberately. More
free blocks was the obvious alternative and it fails the goal: free and unlimited means everyone
uses the prettiest one, and the town goes uniformly pink instead of uniformly grey.

**Four a craft.** A day holds `ITEMS.craftPerDay` (20) crafts and a hut's walls are far more tiles
than that, so one a craft would have made a brick house a week of crafting. `makes: 4` is the
sweets' existing mechanic, and it brings the room check (`inventory_full`) with it.

## Consequences

- Adding one is the ordinary "Adding a kind" recipe in `packages/sim/AGENTS.md` plus a drawing, so
  the cost is per material and it is mostly art. That is the argument for a small set done well
  rather than a long list, and it is why five shipped rather than the six the RFC guessed at.
- `brick` could not be the kind's name: a `brick` ground kind already exists (the brick path you
  `lay`), and one word meaning a wall to `place` and a path to `lay` reads as the same thing in two
  tables of SKILL.md. It is `brickwork`. Caught after the first push and renamed before it reached
  terrakin.org, so no logged craft ever named it.
- A real bug the work surfaced: `checkCraft`'s commit branched on `furniture || sweet`, so anything
  else became a made good with an id and a maker. A material fell through it and came out as a
  one-off thing rather than a stack. `materials.test.ts` caught it, which is the argument for
  testing a new kind through `apply` rather than trusting the catalog's own tests.
- Old logs never named any of these kinds, so replay is untouched and `REPLAY_VERSION` did not
  move. The same holds for every material added later.
- The design picker still offers only the free four. `designToPlan` gates `choices.walls` on
  `design.options.walls`, and `maps.test.ts` pins that a design builds free by default and that
  every wall option is a `BUILDING_BLOCK`, which is RFC 0032's promise and worth keeping. Offering
  materials there needs an options list of its own, and it would reach nobody at the moment the
  picker is shown: the home sheet opens the instant a plot is claimed, when a resident has no
  workbench, no finds and no materials. The build bar is where a wall gets chosen, and that is
  where these are.
