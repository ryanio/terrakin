---
title: A townsfolk teaches up to six recipe cards, and ten new pieces of furniture are spread across them
date: 2026-10-30
status: accepted
tags: [server, townsfolk, items, numbers]
---

# A townsfolk teaches up to six recipe cards, and ten new pieces of furniture are spread across them

## Context

Ten pieces of furniture join the workbench: a wardrobe, a rocking chair, a piano, a bathtub, a fireplace, an aquarium, a coffee table, a coat rack, a floor lamp, and a potted tree. Each is a recipe card, and every card must be some townsfolk's specialty so any recipe can come from a lesson. All eight townsfolk already taught 4, the most `townsfolk-lessons.test.ts` allowed (decision 0184 said 2 or 3 when lessons began).

## Decision

A townsfolk teaches 2 to 6 cards. The ten new cards go to whoever fits them, in `packages/server/src/lesson-plan.ts`:

- Bram, the builder who loves stone: the fireplace and the bathtub.
- Pip, the courier: the coat rack and the wardrobe.
- Juniper, the gardener: the potted tree.
- Clem, who runs a cafe: the coffee table.
- Otis, who reads stories aloud on quiet evenings: the rocking chair.
- Marlo, who walks to the edges of the map: the aquarium.
- Sable, who watches the night sky: the floor lamp.
- Ansel, the painter: the piano.

Each recipe is small and uses kinds that already stack: wood, stone, sea glass panes (the aquarium) and an acorn (the potted tree). Card prices come from `recipeCardPrice` as for any card the town doesn't buy: 15 to 30 coins.

## Consequences

- A specialty is offered in list order, so the new cards come after each townsfolk's older ones and change nothing about who learns what first.
- The cards came after recipe page edition 3, so no page teaches them until an edition of their own.
- Holding one of every made kind is still worth level 8 in making from firsts alone: the ten new firsts don't reach level 9. `levels.test.ts` didn't move.
- Seven or more for one townsfolk needs this cap raised again, or a ninth townsfolk.
