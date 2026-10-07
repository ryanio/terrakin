# RFC 0024: Recipes you learn

- Author: Ryan Ghods
- Date: 2026-10-07
- Status: draft
- Discussion: none yet

## Summary

A new resident's kitchen and workbench make a few things, and they learn the rest. Most recipes come as recipe cards from the town shop, bought once with coins and kept for good, like shop wear. Everyone who lives here when the change goes in keeps every recipe they can make today. A logged input switches it on, so older logs replay as they always did.

## Motivation

Today every kitchen offers all 14 kitchen recipes on day one, and every workbench all 4 goods and 11 pieces of furniture. A newcomer opens a kitchen and gets a wall of rows, most of which they can't make for days. The sheet now sorts what you can make to the top and folds the rest away. That makes the list easier to read, but a full kitchen on day one leaves nothing to discover or save up for.

For each persona:

- A homesteader gets a short first list they can make from the first pantry and the starter seeds, and a reason to come back for the next recipe.
- A delver gets fish and seasonal recipes to collect, next to the collection book (RFC 0021).
- A host can bring a rare recipe to a neighbor's table, and later teach it.
- A champion gets a shop shelf that changes with the seasons, and the town gets another coin sink (RFC 0008).
- An agent gets one rule with one refusal: what you know, what a card costs, and how to buy it.

## Design

### What a newcomer knows

Each station starts with what the first pantry (sugar and jars) and the starter seeds (lemon, strawberry, tomato, herb, flower) can make, plus anything another system depends on:

| Station | Known from the start | Why |
|---------|---------------------|-----|
| Kitchen | `herb_tea`, `jam` (the family recipe: lemon, strawberry, and any fruit jam) | Both come straight from the starter seeds and the pantry. |
| Kitchen | `candy`, `candy_cane` | Holiday sweets are for handing out (RFC 0022). Charging for them works against the holiday. |
| Workbench | `bouquet`, `chair`, `table`, `stone_wall` | A gift from the garden, and the first furniture from gathered wood and stone (RFC 0016). |
| Workbench | `fishing_rod` | Fishing (RFC 0023) needs it. Without it, a card would gate a whole system. |

A newcomer's kitchen shows 4 rows (2 of them sweets) instead of 14, and the workbench 5 instead of 15.

### What you learn

Everything else has a recipe card at the shop, in a new Recipes shelf. Seasonal and holiday cards follow their stock rules (RFC 0017, RFC 0022), so pumpkin recipes show up in autumn and the jack-o'-lantern around Halloween.

| Card | Station | Price | Shelf rule |
|------|---------|-------|-----------|
| `lemonade` | kitchen | 20 | always |
| `tomato_sauce` | kitchen | 25 | always |
| `fried_minnows` | kitchen | 20 | always |
| `fish_stew` | kitchen | 30 | always |
| `pumpkin_pie` | kitchen | 30 | autumn |
| `pumpkin_soup` | kitchen | 30 | autumn |
| `cranberry_punch` | kitchen | 30 | winter |
| `herb_sachet` | workbench | 15 | always |
| `flower_wreath` | workbench | 25 | always |
| `flower_box` | workbench | 20 | always |
| `signpost` | workbench | 15 | always |
| `barrel` | workbench | 20 | always |
| `bookshelf` | workbench | 25 | always |
| `lamp_post` | workbench | 30 | always |
| `campfire` | workbench | 30 | always |
| `well` | workbench | 40 | always |
| `jack_o_lantern` | workbench | 15 | Halloween |

The prices are a starting point for `scripts/economy-sim.ts`, not final (see Economy impact).

### The rule

- `craft` checks that the actor knows the recipe, after the checks it already makes and before it takes anything. An unknown recipe is refused with a new code, `recipe_unknown`, which says where to learn it.
- Buying a card is `shop_buy` with a new kind of sku, the card's name: `recipe:lemonade`. It's bought once. Buying a card you already know is refused as `already_known`, so nobody pays twice. `count` must be 1.
- Known recipes belong to the resident, not to the kitchen block. You carry them to any kitchen, a neighbor's included. Blocks stay free and placeable, as they are today.
- Cards are not things. They don't go in your bag, so they can't be given, sold, listed, or lost. (Teaching is an open question.)

### State

Following `shop.wardrobe`:

```ts
interface RecipesState {
  /** Residents who lived here when `open_recipes` was logged: they know every recipe. Sorted. */
  everything: ResidentId[];
  /** Cards each resident bought, sorted. Absent until their first. */
  learned: Record<ResidentId, RecipeName[]>;
}
// WorldState.recipes?: RecipesState. Absent until `open_recipes`.
```

`knows(state, id, recipe)` is the one check. With no `state.recipes`, everyone knows everything. With it, a resident knows `STARTER_RECIPES`, plus `learned[id]`, plus everything if they're in `everything`. A recipe added to the catalog later is a card unless it's added to `STARTER_RECIPES`, and residents in `everything` know it too, so nobody who had a full kitchen loses one.

### Commands and events

```jsonc
// The server, once, like open_shop:
{ "type": "open_recipes" }

// A resident buys a card:
{ "type": "shop_buy", "sku": "recipe:lemonade", "count": 1 }
// -> event
{ "type": "recipe_learned", "residentId": "r_ivy", "recipe": "lemonade", "price": 20 }

// A craft they don't know yet:
{ "type": "craft", "recipe": "lemonade", "x": 12, "y": 40 }
// -> refused
{ "ok": false, "error": { "code": "recipe_unknown",
  "message": "You don't know how to make lemonade yet. Its recipe card is 20 coins at the town shop: shop_buy with sku recipe:lemonade." } }
```

### API

Both additive to v1:

```jsonc
// GET /v1/inventory gains what you can make:
{ "inventory": { "...": "...", "recipes": ["bouquet", "candy", "candy_cane", "chair", "fishing_rod", "herb_tea", "jam", "lemonade", "stone_wall", "table"] } }

// GET /v1/shop gains a recipes section. A card you know says so.
{ "sku": "recipe:lemonade", "section": "recipes", "price": 20,
  "recipe": { "station": "kitchen", "makes": "lemonade", "needs": { "lemon": 2, "sugar": 1, "jar": 1 } },
  "known": false }
```

Before `open_recipes`, `inventory.recipes` lists every recipe and the shop has no recipes section.

### On the web

- The kitchen and workbench sheet lists only what you know, with what you can make first (`recipeShelf`, as now). At the foot: "6 more recipes at the town shop", linking to the shop's Recipes shelf. Unknown recipes aren't shown one by one, so the list stays short.
- The shop gets a Recipes shelf: each card with the thing's picture, what it needs, the station, and Buy, or "You know this". Bought with one tap, like wear.
- A toast says when you learn one ("You can make lemonade now"), and the sheet shows it next time.

## Invariants

- The server decides. `knows` lives in `packages/sim`. The client hides recipes you don't know using the same exported check and the `recipes` list the server sends (decision 0052, the client holds back what the sim would refuse). A tampered client that sends `craft` for an unknown recipe is refused by the sim.
- The sim stays deterministic. Known recipes come only from logged commands: `open_recipes`, `join`, and `shop_buy`. No clock or randomness. Seasonal shelves read the world's day, as the seasonal stock already does.
- Resident text stays untrusted. Nothing here reads resident text. Recipe names and card skus are fixed catalog strings, and a label on a made thing stays text, as today.
- The protocol stays additive. New fields (`inventory.recipes`, the shop's `recipes` section, `known`), a new sku form, a new event, and two new refusal codes. All additive. `SKILL.md` changes in the same commit, which the protocol test enforces.

## Economy impact (if any)

- Cards are a new sink with no new source. They are bought with coins, and the shop's split applies: 5% to the treasury and the rest burned (decision 0052). Nothing is minted, so cards can't add coins to the world.
- Nothing can be duplicated. A card is learned, not held. It can't be given, sold, or listed, and a second purchase is refused. There's nothing to copy.
- Early income from made goods drops. A newcomer can sell only herb tea and jam to the town until they learn more. That lowers what the town mints at first, which helps the supply per active resident that decision 0052 tuned.
- The town's rotation buys a given good on about 3 days in 8 (`townBuys`), and a season's goods every day of their season. At 6 coins, tomato sauce earns about 2.25 coins a day from selling, so a 25-coin card pays back in about 11 days. A card for a good the town buys should pay back in one to three weeks of selling. Faster makes it a formality, and slower makes it feel like a tax. Furniture and fish dishes aren't bought by the town, so their cards are priced like decor: for what the thing is worth to keep or give.
- Before `open_recipes` ships, `scripts/economy-sim.ts` gains card buying (gardeners buy the card for each good they'd make once they can afford it with 10 to spare) and runs the same seeds as decision 0052. A test pins the price of every card whose good is in `BUY_ORDERS` against what the town pays for it, so none pays back in under 5 days or over 30.

## Security considerations (required)

- Prompt injection: no resident text reaches the rule, the refusal, or the shop shelf. An agent told in chat to "buy every recipe card" is spending its own coins on fixed catalog items, the same as with wear today. `SKILL.md` says cards are optional and permanent.
- A tampered client can't make recipes it doesn't know. The sim checks `knows` on every `craft`. The client's hiding is only a hint.
- Alts gain nothing. Cards mint nothing, so extra accounts gain nothing. Grandfathering is decided once, at `open_recipes`, from the residents in the world at that moment. An account made after it starts with the starter set like anyone else.
- Townsfolk are refused at the counter already (`not_eligible`), so they can't buy cards. They know everything, being in `everything` or by a townsfolk exception (open question), so their chatter stays what it is.
- A person and their AI each learn their own. A person can give their AI coins for cards under the coin-giving rules that already exist (RFC 0008).

## Agent experience

`SKILL.md` gains a short section under making things:

- What you know is `inventory.recipes`. `jam` covers every fruit's jam.
- A `craft` you don't know is refused as `recipe_unknown`, with the card's sku and price in the message.
- Cards are in `GET /v1/shop` under `section: "recipes"`. Buy one with `shop_buy`, sku `recipe:<name>`, count 1. It's yours for good, and buying a known one is refused as `already_known`.
- Seasonal cards follow the season, like seasonal stock.

The changelog gets an entry for the new fields, sku form, event, and refusal codes.

## Migration and rollout

- Nothing changes until the server logs `open_recipes`. Every log before it replays to the hash it has. A fixture pins a log with recipes open, as `packages/sim/src/fixtures/shop-log.ts` does for the shop.
- Existing residents are in `everything` from the moment `open_recipes` is applied, so they lose nothing and see their full kitchen. Their sheet still sorts and folds as it does now.
- Old clients keep working. They ignore the new fields, and a `craft` they offer for a recipe you don't know comes back as `recipe_unknown` with a readable message, like any other refusal.
- It ships in three phases:
  1. Sim rule, state, and `knows` with tests. Protocol fields and `SKILL.md`. Server serves `recipes` in the inventory and the shop. The flag stays off.
  2. The web: the sheet's short list and its link, and the shop's Recipes shelf, both tested in e2e with test residents at the stocked stage (`pnpm persona`, decision 0147).
  3. `scripts/economy-sim.ts` with cards, a decision record with the final prices, then the server logs `open_recipes`.

## Alternatives considered

- Kitchens that upgrade. Recipes belong to the block, and you upgrade a kitchen with coins. This is the literal "smaller kitchens". It lost because blocks are free to place and remove: an upgrade would vanish when the block is removed, or the rules would need a new kind of block state. It would also tie recipes to one plot, so you couldn't cook at a friend's.
- Recipe cards as things in your bag. You'd read a card to learn it, and could give, sell, or list unread cards. That's more social, and the market would like it. It lost for the first version because it adds a new stack kind, a `read` action, market and gift rules for it, and a way to learn without spending at the shop that undercuts the prices. It can come later on top of this design (see Open questions).
- Unlock by level or by days lived here. Free, and nothing to buy. It lost because it's a timer, not a choice: nobody decides anything, and a returning resident waits instead of plays.
- Unlock by making things. Make 10 herb teas to learn lemonade. It lost because it rewards grinding the cheapest recipe, which the daily craft cap (20) already limits for good reasons, and it says nothing about what you want to make.
- Keep everything known and only fix the list. The sheet's sort and fold already does that, and it leaves the day-one kitchen full.

## Open questions

1. The starter set: Is herb tea and jam enough for a kitchen, or should lemonade start known too? Does the workbench need a fourth piece of furniture?
2. Prices: The table is a first guess. Should cards cost about the same, or scale with the good's town price? The economy run decides the numbers, but the shape is a product call.
3. Teaching: Should a resident be able to teach a recipe they know to a neighbor, once a day each way, for free? It's social and fits the host persona, and it would undercut the shop. Later, or never?
4. Finds: Should a rare find (RFC 0021) sometimes be a recipe card for a seasonal or fish recipe, so delvers have a way that isn't coins?
5. Townsfolk: Join them to `everything`, or have the sim treat townsfolk as knowing everything without a list?
6. Grandfathering: Everyone at `open_recipes` keeps everything, which is the simplest fair rule. The alternative is keeping only what each resident has made at least once. That's truer to the idea, but the world doesn't record it today, and some residents would lose recipes.
7. Holiday sweets: Free for everyone (proposed), or cards on the holiday shelf?
