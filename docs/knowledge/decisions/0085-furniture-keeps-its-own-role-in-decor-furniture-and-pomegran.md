---
title: Furniture keeps its own role in decor › furniture, and pomegranates and jack-o'-lanterns are the first kinds added through the catalog
date: 2026-10-06
status: accepted
tags: [sim, economy, numbers, items, seasons]
---

# Furniture keeps its own role in decor › furniture, and pomegranates and jack-o'-lanterns are the first kinds added through the catalog

## Context

[RFC 0016](../../rfcs/0016-build-with-what-you-gather.md) brought furniture as its own item category, and [RFC 0018](../../rfcs/0018-one-catalog-of-things.md) says a new role or family needs a decision. Furniture could have been decor with a recipe, sorted by family alone. RFC 0018 also adds the first kinds through the catalog, a fruit and a piece of furniture, whose numbers had to fit the shop's ([decision 0052](0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md)) and autumn's ([decision 0079](0079-autumn-s-numbers-pumpkins-pumpkin-pie-and-soup-hay-bales-and.md)).

## Decision

Furniture keeps its own role, in a decor › furniture family. Rules read the role: `craft` makes furniture as a stack with no label, not a signed good, and `place` and `remove` hold it like decor. The API already shows `category: "furniture"`, which v1 can't take back. The family makes it read as decor where people see it: "Decor › Furniture" on the things page, and `path: ["decor", "furniture"]` in `GET /v1/catalog`.

Pomegranates are one `fruit(...)` entry, numbered like a lemon:

| | |
|---|---|
| Days to grow | 4 |
| A harvest | 3 pomegranates and a seed back |
| Seeds at the shop | 4 coins, all year, like the other fruit seeds |
| Pomegranate jam | 3 pomegranates, a bag of sugar, and a jar, from the jam family recipe |

They aren't a starter seed, they aren't in the town's rotation, and the town has no buy order for pomegranates or their jam.

A jack-o'-lantern is furniture carved from 1 pumpkin at a workbench. It stacks, places like furniture, and glows after dark on the map and in 3D, which is drawing only. The town neither sells nor buys it.

The economy simulation's gardeners buy seeds only for crops the town buys, since they grow to sell. Its recorded runs stay as decisions 0052 and 0079 have them.

## Consequences

- Neither kind mints a coin. Pomegranates and their jam are for gardens, gifts, and the market, and a jack-o'-lantern costs a pumpkin the town would pay 2 coins for in autumn. If the town should buy any of them, that's a buy order and a season's buys, by a decision of its own.
- A pumpkin now has three uses in autumn (pie, soup, and a jack-o'-lantern), so a little less of autumn's crop may reach the town.
- Code: the entries in `packages/sim/src/catalog.ts`, `jack_o_lantern` in `BLOCK_KINDS` and `BLOCK_COLORS`, its drawing in `packages/ui/src/item-art.ts`, its 3D model in `packages/client/src/scene3d/furniture.ts`, and its plot photo in `packages/cards/src/plot.ts`.
