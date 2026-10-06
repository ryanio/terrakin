---
title: Every kind is one catalog entry in one family, the sim's lists are its views, and the lists rules walk are frozen by name
date: 2026-10-06
status: accepted
tags: [sim, protocol, client, agents, replay, items]
---

# Every kind is one catalog entry in one family, the sim's lists are its views, and the lists rules walk are frozen by name

## Context

[RFC 0018](../../rfcs/0018-one-catalog-of-things.md) makes a new kind of thing one entry instead of a small project. Before it, a crop was named in `CROPS`, `SEED_KINDS`, `ITEM_INFO`, `CROP_INFO`, `RECIPES`, the shop's prices, `CROP_HEX`, three drawing functions, SKILL.md, and tests. Some of those lists are also walked by rules whose contents and order decide how an old log replays: the first pantry's seeds, the pantry's staples, the town's daily rotation, and `build`, which orders what a plan uses by `STACK_KINDS`. A new kind must never change any of them.

## Decision

- The catalog is code: `sim/src/catalog.ts` holds one entry per kind: its name and plural, one family (its most specific; families form a tree through `parent`), its role, crop numbers, shop price and seasons, recipe, and look. Rules read roles (seed, produce, staple, resource, decor, furniture, good, piece), never families. Only a family recipe reads a family.
- The sim's lists and tables are views of it, under the names they always had. Each list groups kinds by role in catalog order, and new entries go on the end, so a new kind joins the end of its role's list and every kind already listed keeps its place. The kind types are derived from the entries too, so a table keyed by kind still has to cover every kind to typecheck. An entry's recipe names its needs as plain strings, since typing them by kind would make the catalog's type depend on itself, and `catalog.test.ts` checks them instead.
- Lists that rules walk are frozen by name: `STARTER_SEEDS`, `PANTRY_STAPLES` (which the pantry now walks in place of every staple), `ROTATION_GOODS`, and `ROTATION_CROPS`. The town buys only kinds with a buy order (`SellKind`), so no kind joins what the town buys by joining the catalog. `catalog.test.ts` pins every shipped kind, recipe, and crop literally, and replay.test.ts and every fixture pass unchanged.
- A family recipe adds one ordinary entry per member, right after the member: jam is 3 of one fruit, a bag of sugar, and a jar, and makes `<fruit>_jam`, so `lemon_jam` and `strawberry_jam` are instances of it. Asked for one with a kind outside the family (`tomato_jam`), `craft` names the kinds it takes. Jam is the only one.
- Pictures come from looks. Produce is an outline, what grows on top, and colors; a seed packet is drawn from the crop it grows; a jar from its fill, its cloth or lid, and the kind on its label. Decor, furniture, staples, materials, wear, and made goods without a template keep their own drawings. `CROP_COLORS` is each crop's one color, for the map, the 3D garden, plot photos, and seed packets. A crop with a vine on top grows along the soil.
- Agents read the same data. `GET /v1/catalog` serves every family and kind with its family path, crop, price, seasons, recipe, and the recipes it goes into. Its `version` is a hash of the answer, and the check-in names it as `catalog`, beside `weather` and `season`. The version is the answer's `ETag` too, with `Cache-Control: public, no-cache`: a cache keeps the catalog and asks each time, a matching `If-None-Match` gets a 304, and a deploy that changes it reaches everyone at once. A `todo` line would need the version each agent last read, which the server doesn't keep, and every catalog change comes with a changelog entry, which already brings the "Terrakin changed" line. SKILL.md's crop, recipe, decor, and furniture tables are generated from the catalog by `pnpm gen`.

## Consequences

- Adding a fruit is one `fruit(...)` call: its seed, its jam, its pictures, its rows in SKILL.md and the API, and the tests that run over every entry come with it. `sim/AGENTS.md` has "Adding a kind".
- `ITEM_INFO` now lists kinds in `ITEM_KINDS` order. Nothing walks a table's keys, so nothing changes for anyone.
- A second family recipe, a new template, role, or family is a decision of its own. So is anything new the town buys, a new starter seed, or a longer rotation, since each changes what old inputs did or what the town mints.
- Code: `sim/src/catalog.ts`, `sim/src/catalog.test.ts`, `protocol/src/catalog.ts`, `catalogBlock` and `furnitureBlock` in `protocol/src/docs.ts`, `ui/src/item-art.ts`, and `byFamily` in `client/src/things.ts`.
