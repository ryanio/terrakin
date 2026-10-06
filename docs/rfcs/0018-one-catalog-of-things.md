# RFC 0018: One catalog of things

- Author: drafted by Claude for Ryan
- Date: 2026-10-06
- Status: accepted (Ryan, 2026-10-06)
- Discussion: none
- Builds on: [RFC 0005](0005-make-show-and-give.md) (making and giving), [RFC 0008](0008-coins-karma-and-the-market.md) (the shop and the market), [decision 0051](../knowledge/decisions/0051-items-open-with-a-logged-input-grow-by-the-world-s-day-and-s.md) (items), [decision 0035](../knowledge/decisions/0035-draw-with-code-first-and-rasterize-only-at-the-edge.md) (draw with code), RFC 0016 (furniture), RFC 0017 (seasons).

## Summary

Every kind of thing in Terrakin (seeds, produce, staples, materials, decor, furniture, made goods) becomes one entry in one catalog, sorted into families such as food › fruit. A recipe can take a family instead of a kind: jam is three of any one fruit, a bag of sugar and a jar, and it makes that fruit's jam. Pictures are drawn from a family's template and a few colors. The API serves the whole catalog, and SKILL.md's lists are generated from it. Adding a fruit becomes one entry: it grows, the shop sells its seeds, it makes jam, and it draws itself in 2D, in 3D and in plot photos, with tests that cover every entry. Pomegranate is the first fruit added this way.

## Motivation

- Residents ask for things the world doesn't have yet: a fruit, a jam, a piece of furniture. Today each new kind is a small project. A crop is named in `CROPS`, `SEED_KINDS`, `ITEM_INFO`, `CROP_INFO`, `RECIPES` (for its jam), the shop's SKUs, `CROP_HEX` and three drawing functions in `ui/src/item-art.ts`, the 3D garden, SKILL.md's recipe list, and tests in a dozen files.
- Homesteaders get more to grow and make, added faster.
- Agents get one place to learn what exists and what makes what, with families they can reason about ("any fruit makes jam") instead of hand-kept lists that drift from SKILL.md.
- Contributors get a small, reviewable change for a new kind, with its tests already written.

## Design

### Entries

The catalog is plain data in `sim/src/catalog.ts`, one entry per kind, keyed by its id. Ids never change, since logs hold them, and new entries go on the end.

```ts
interface KindEntry {
  name: string;            // "Pomegranate"
  plural: string;          // "Pomegranates"
  family: Family;          // "fruit", its most specific family; the path (food › fruit) comes from the tree
  role: "seed" | "produce" | "staple" | "resource" | "decor" | "good" | "piece"; // what rules read; the API shows today's category, where a piece is a good
  grows?: string;          // a seed: the crop it grows
  crop?: { days: number; yield: number; seedsBack: number }; // a crop
  shop?: { price: number; seasons?: Season[] };              // sold at the town shop
  recipe?: { station: Station; needs: Record<string, number> }; // a made thing, its needs in order
  look: KindLook;          // a template and colors (see Pictures)
}
```

Decor needs no field of its own: every decor kind places as a block, and every block is solid.

Helpers keep entries short. `fruit("pomegranate", { name, plural, days, yield, seedsBack, seedPrice, look })` makes the fruit and its seed, and `crop(...)` does the same for a crop in another family. A family recipe makes its outputs (below).

The sim's existing names (`ITEM_KINDS`, `STACK_KINDS`, `GOOD_KINDS`, `CROPS`, `SEED_KINDS`, `ITEM_INFO`, `CROP_INFO`, `RECIPES`, the shop's SKUs) stay, derived from the catalog, so the rest of the code and the protocol's enums keep working. Each list groups kinds by role in catalog order, as today's lists do, so a new kind joins the end of its lists and every kind already listed keeps its place. The kind types (`ItemKind`, `SeedKind`, `Crop`, ...) are derived too, so tables keyed by kind still have to cover every kind to typecheck.

### Families

A family names the family it sits in, if any, so each family has a path from general to specific: food › fruit. A kind belongs to exactly one, and its entry names only the most specific. The starting tree:

| Family | Kinds |
|---|---|
| food › fruit | lemon, strawberry, pomegranate |
| food › vegetable | tomato, pumpkin (RFC 0017) |
| food › herb | herb |
| food › preserve | lemon jam, strawberry jam, pomegranate jam, tomato sauce |
| food › drink | lemonade, herb tea |
| food › baked | RFC 0017's pumpkin dishes, where they fit |
| flower | flower |
| keepsake | bouquet, herb sachet, flower wreath |
| seed | every seed, each naming what it grows |
| pantry | sugar, jar |
| material | wood, stone |
| decor | the shop's decor and RFC 0016's furniture, with sub-families where they help |
| art | pieces |

Families serve family recipes, the inventory screen, the shop's sections and the API. No rule reads a family except a family recipe.

### Recipes

Two shapes:

- A fixed recipe names its kinds. Lemonade is 2 lemons, 1 sugar and 1 jar.
- A family recipe names a family for one input, and what it makes is named after the kind used. Jam is 3 of one kind from food › fruit, 1 sugar and 1 jar, and it makes `<fruit>_jam`. `lemon_jam` and `strawberry_jam` are already exactly that, so they become instances of it, with the same ids, names and needs.

`craft` keeps its shape: `{"type": "craft", "recipe": "pomegranate_jam", ...}`. A family recipe adds one concrete entry per member when the catalog loads, right after the member, so `pomegranate_jam` is an ordinary kind and an ordinary recipe in every list and in the API, and it joins the end of the lists like any new kind. Agents never need to understand patterns to cook. Adding a fruit adds its jam.

This RFC builds jam only. A second family recipe (juice, pie) adds a kind for every member, so each one is its own decision.

### Pictures

Each entry has a `look`: a template and its colors, for example a pomegranate's `{ template: "produce", shape: "round", top: "crown", body: "#b8323f", detail: "#7a1f2b", jam: { fill: "#9e1b32", cloth: "#ea8a9d" } }`. Templates cover the families with many members:

- produce, for fruit and vegetables: an outline (an oval like a lemon, a berry, or round), what grows on top (a leaf, a leafy cap, a star of sepals, or a crown), its skin, and the color of its speckles, seeds, or ribs. A fruit also gives its jam's colors.
- sprig, for herbs, and bloom, for flowers.
- seed packet, drawn from what it grows.
- jar, filled with its color and labelled with what's in it, under a cloth like a jam or a lid like a sauce.

`body` is the one color that stands for a kind where it shows small: a ripe crop on the map and in 3D, a plot photo, a seed packet's band. `ui/src/item-art.ts` draws from the template; the 2D map and the 3D garden draw a growing crop from its entry; plot photos read the same colors. Things that need their own drawing (decor, furniture, wear, and drinks and dishes until two of them share a shape) keep it, as `{ template: "drawn" }`, drawn by the existing function for their id. A test draws every entry and fails on any kind without a picture.

### The API

- `GET /v1/catalog`, public and cacheable: the family tree, every kind with its family, name, plural and role, what grows it and how long it takes, its shop price and seasons if sold, and every recipe with its station and needs (family recipes listed per kind). It carries a `version`, a hash of the catalog, and the check-in names the version so an agent knows when to read it again.
- `GET /v1/inventory` keeps its `catalog` field, built from the same data (v1 is additive only).
- SKILL.md's lists of crops, recipes and decor become a generated block (`pnpm gen`), with a line pointing at `GET /v1/catalog` for the full list.

### The inventory screen

Things you hold are grouped by family (Food › Fruit, Food › Preserves, Seeds, Pantry, Materials, Decor), using the catalog's names, on a phone first.

### Adding a kind

`sim/AGENTS.md` gets "Adding a kind": one entry (or one `fruit(...)` call) on the end of the catalog, its look, and a shop price if it's sold. The tests that run over every entry cover the rest. A new family recipe, template, role or family is bigger and needs a decision record.

## Invariants

- **Replay.** Ids never change, and old logs never name a new kind. Lists that existing rules walk keep their exact contents and order, frozen by name in the code: the first pantry's starter seeds (`STARTER_SEEDS`), the staples the daily pantry tops up (`PANTRY_STAPLES`), the town's daily rotation (`ROTATION_GOODS` and `ROTATION_CROPS`, for `townBuys`), and anything RFC 0016 or RFC 0017 froze. A test pins each frozen list. A new kind joins rules like those only through a new logged input, never just by being added to the catalog. A parity test checks that the catalog gives exactly today's `ITEM_INFO`, `CROP_INFO` and `RECIPES` for every existing kind, and `replay.test.ts` with every fixture passes unchanged.
- **Server authority.** The catalog is code in the sim. Nothing in it comes from residents.
- **Untrusted text.** Entries hold no resident text.
- **Protocol.** Additive: a new route and new fields. Enums grow when kinds are added, as they already do.

## Economy impact

None by itself. A new kind is priced like its neighbors: a fruit's seeds cost what seeds cost, and its jam is a jam. The town's buy rotation stays frozen; anything new the town buys goes through RFC 0017's separate list, decided kind by kind.

## Security considerations

- The catalog is code, reviewed like code. Residents can't create kinds; a request reaches a maintainer, who decides.
- `GET /v1/catalog` is public data with a long cache.
- A bigger catalog makes the generated SKILL.md block longer. Keep it compact and point at the API for detail.

## Agent experience

- Read `GET /v1/catalog` when its version changes. It says what grows, how long it takes, what each thing makes, and where it fits.
- Family recipes need nothing new: every recipe is listed by the kind it makes.
- SKILL.md gains a short "Things and families" section and the generated tables.

## Migration and rollout

Old logs replay unchanged at every step.

1. `sim/src/catalog.ts`: entries for every kind on main, families, the jam family recipe, the frozen lists, and the parity test. Nothing reads it yet.
2. After RFC 0016 and RFC 0017 land: their kinds move in, the sim's lists and tables are derived from the catalog, and `craft` resolves family recipes.
3. `GET /v1/catalog`, the generated SKILL.md block, the check-in's version line, and the changelog.
4. Pictures from templates in 2D, 3D and plot photos, and the inventory grouped by family.
5. Pomegranate: seeds sold all year, pomegranate jam through the family recipe, pictures from the fruit template.

## Alternatives considered

- **Keep adding kinds by hand.** Each one touches a dozen files and drifts from SKILL.md.
- **A catalog in the database that staff edit.** The sim can't read it (no I/O), and a kind that changed under a log would break replay. The catalog has to be code.
- **Tags instead of a family tree.** More flexible, but harder to show on a phone and to explain. One family per kind, one family per recipe input.
- **Residents propose kinds in the Town Hall.** Maybe later, as a proposal staff turn into a catalog change.

## Open questions

- Which family recipe comes after jam: juice, pie, or something residents ask for?
- Should the town buy any of the new kinds? Only through RFC 0017's separate list, decided per kind.
