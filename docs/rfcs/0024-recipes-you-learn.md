# RFC 0024: Recipes you learn

- Author: Ryan Ghods
- Date: 2026-10-07
- Status: accepted (building)
- Discussion: none yet

## Summary

A new resident's kitchen and workbench start with a small shared base, plus three recipes the newcomer picks for themselves. They learn the rest from recipe cards at the town shop, from a neighbor who teaches them, from a townsfolk, or from a rare find. Holiday recipes are known by everyone, all year. Everyone who lives here when the change goes in keeps every recipe they can make today. A logged input switches it on, so older logs replay as they always did.

## Motivation

Today every kitchen offers all 14 kitchen recipes on day one, and every workbench all 4 goods and 11 pieces of furniture. A newcomer opens a kitchen and gets a wall of rows, most of which they can't make for days. The sheet now sorts what you can make to the top and folds the rest away. That makes the list easier to read, but a full kitchen on day one leaves nothing to discover, choose, or share.

For each persona:

- A homesteader picks the recipes they like, starts with a short list they can make from the first pantry and the starter seeds, and has a reason to come back for the next one.
- A delver finds recipe pages on the ground and collects fish and seasonal recipes, next to the collection book (RFC 0021).
- A host teaches neighbors what they know, which gives people a reason to meet in the world.
- A champion gets a shop shelf that changes with the seasons, and the town gets another coin sink (RFC 0008).
- An agent gets one rule with one refusal: what you know, and each way to learn more.

## Design

### What everyone knows

Every resident knows the base, which the first pantry (sugar and jars) and the starter seeds (lemon, strawberry, tomato, herb, flower) can make, plus anything another system depends on:

| Station | Known by everyone | Why |
|---------|-------------------|-----|
| Kitchen | `herb_tea`, `jam` (the family recipe: every fruit's jam) | Both come straight from the starter seeds and the pantry. |
| Workbench | `bouquet`, `chair`, `table`, `stone_wall` | A gift from the garden, and the first furniture from gathered wood and stone (RFC 0016). |
| Workbench | `fishing_rod` | Fishing (RFC 0023) needs it. A card for it would lock a whole system. |

Holiday recipes are also known by everyone, all year, so anyone can take part in a holiday without paying first. Today that's `candy`, `candy_cane`, and `jack_o_lantern`. A recipe for a future holiday (Easter, a spring festival, anything RFC 0022 adds) is free the same way: the catalog marks it with its holiday, and `knows` reads that mark.

### Three recipes you pick

On top of the base, each newcomer picks 3 recipes from the cards on the shop's Recipes shelf that day, free, seasonal cards included. Two neighbors who joined the same day can have different kitchens: one makes lemonade and tomato sauce, the other wreaths and a well. The picks don't expire. The web asks the first time you open a kitchen or workbench ("Pick 3 recipes to start"), and the shop's shelf shows "Free pick" on every card while you have picks left.

### Learning more

There are four ways to learn a recipe, and every one is a logged command:

| Way | How | Limit |
|-----|-----|-------|
| Buy | `shop_buy` the card at the shop | Once per card. A known card is refused. |
| Be taught | A neighbor who knows it uses `teach` while you stand within reach of each other | Each resident teaches 1 a day and is taught 1 a day. |
| A townsfolk teaches | A townsfolk teaches one of their specialties to a resident near them | Once a week per resident, plus the daily limit above. |
| Find it | Pick up a recipe page lying on the ground (a rare find) | A page you already know stays where it is, for someone else. |

#### Cards and prices

Cards are on a new Recipes shelf. Seasonal cards follow their season's stock rule (RFC 0017). The price follows what the thing is worth in the game:

- A good the town buys on its rotation costs 5 times what the town pays for one. The rotation buys a good on about 3 days in 8 (`townBuys`), so the card pays back in about 13 days of selling.
- A good the town buys every day of its season costs 8 times the town's price, so it pays back in 8 days of that season, and again every year.
- Anything the town doesn't buy (furniture and fish dishes) costs 10 coins plus 3 for each thing it uses, rounded to the nearest 5. That prices it like decor: by the work in it and what it's worth to keep or give.

| Card | Station | Rule | Price | Shelf |
|------|---------|------|-------|-------|
| `lemonade` | kitchen | 5 × 4 | 20 | always |
| `tomato_sauce` | kitchen | 5 × 6 | 30 | always |
| `fried_minnows` | kitchen | 10 + 3 × 4 | 20 | always |
| `fish_stew` | kitchen | 10 + 3 × 3 | 20 | always |
| `pumpkin_pie` | kitchen | 8 × 6 | 50 | autumn |
| `pumpkin_soup` | kitchen | 8 × 5 | 40 | autumn |
| `cranberry_punch` | kitchen | 8 × 5 | 40 | winter |
| `herb_sachet` | workbench | 5 × 3 | 15 | always |
| `flower_wreath` | workbench | 5 × 6 | 30 | always |
| `flower_box` | workbench | 10 + 3 × 4 | 20 | always |
| `signpost` | workbench | 10 + 3 × 2 | 15 | always |
| `barrel` | workbench | 10 + 3 × 3 | 20 | always |
| `bookshelf` | workbench | 10 + 3 × 4 | 20 | always |
| `lamp_post` | workbench | 10 + 3 × 3 | 20 | always |
| `campfire` | workbench | 10 + 3 × 5 | 25 | always |
| `well` | workbench | 10 + 3 × 8 | 35 | always |

The rule is code (`recipeCardPrice` in `packages/sim`), so a recipe added later gets its price the same way. The economy run can change the three numbers in it (5, 8, and 10 plus 3), not each card by hand.

#### Teaching

`teach` takes a recipe and a resident. Both must be online and within reach of each other (`config.reach`), so a lesson is a moment in the world rather than a menu item. The teacher has to know it, and the learner must not know it yet. The base and holiday recipes need no teaching. Each resident teaches at most 1 recipe a day and is taught at most 1 a day, which keeps teaching a favor between neighbors and keeps the shop worth visiting. The learner gets a notification ("Ivy taught you lemonade").

#### Townsfolk

Townsfolk know every recipe by rule, with no list. Each has a short list of specialties in the townsfolk seed (`scripts/`): Clem, who runs the cafe, might teach lemonade and tomato sauce. The townsfolk run (decision 0114) can teach a specialty to a resident standing near that townsfolk, at most once a week per resident. Visiting the townsfolk becomes worth doing, and their chatter can say what they're known for. The server sends these as ordinary `teach` commands from the townsfolk, so the sim checks them like any other.

#### Recipe pages

Some finds (RFC 0021) are recipe pages. Each page is for one recipe, chosen like everything else about a find: from the day and the tile, with no randomness. Picking one up teaches its recipe. If you already know it, the gather is refused as `already_known` and the page stays for the next person. About 1 find in 20 is a page, a number the economy run can tune. Pages are never base or holiday recipes, and they aren't kinds in the collection book.

### The rule

- `craft` checks that the actor knows the recipe, after the checks it already makes and before it takes anything. An unknown recipe is refused with a new code, `recipe_unknown`, which says every way to learn it.
- Known recipes belong to the resident, not to the kitchen block. You carry them to any kitchen, a neighbor's included. Blocks stay free and placeable, as they are today.
- Cards and lessons aren't things. They don't go in your bag, so they can't be given, sold, listed, or lost. Teaching is how you share one.

### State

Following `shop.wardrobe`:

```ts
interface RecipesState {
  /** Residents who lived here when `open_recipes` was logged: they know every recipe. Sorted. */
  everything: ResidentId[];
  /** Recipes each resident has learned, however they learned them. Sorted. Absent until their first. */
  learned: Record<ResidentId, RecipeName[]>;
  /** Free picks each resident has used, out of `RECIPES_RULES.starterPicks`. Absent until their first. */
  picks: Record<ResidentId, number>;
  /** When each resident was last taught by a townsfolk, as the world's day. */
  townsfolkTaught: Record<ResidentId, number>;
}
// WorldState.recipes?: RecipesState. Absent until `open_recipes`.
// Today's counters (taught and teaching, one each) join `items.today`, reset at `new_day`.
```

`knows(state, id, recipe)` is the one check. With no `state.recipes`, everyone knows everything. With it, a resident knows the base, every holiday recipe, `learned[id]`, and everything if they're townsfolk or in `everything`. A recipe added to the catalog later is a card unless it's in the base or has a holiday, and residents in `everything` know it too, so nobody who had a full kitchen loses one.

### Commands and events

```jsonc
// The server, once, like open_shop:
{ "type": "open_recipes" }

// A newcomer's free pick:
{ "type": "pick_recipe", "recipe": "lemonade" }

// Buying a card:
{ "type": "shop_buy", "sku": "recipe:tomato_sauce", "count": 1 }

// Teaching a neighbor who stands within reach:
{ "type": "teach", "recipe": "lemonade", "to": "r_wren" }

// Every way ends in one event:
{ "type": "recipe_learned", "residentId": "r_wren", "recipe": "lemonade", "how": "taught", "from": "r_ivy" }
// "how" is "picked", "bought" (with "price"), "taught" (with "from"), or "found".

// A craft they don't know yet:
{ "type": "craft", "recipe": "well", "x": 12, "y": 40 }
// -> refused
{ "ok": false, "error": { "code": "recipe_unknown",
  "message": "You don't know how to make a well yet. Pick it with a free pick, buy its card at the town shop (35 coins, shop_buy with sku recipe:well), or ask a neighbor who knows it to teach you." } }
```

New refusal codes: `recipe_unknown`, `already_known`, `no_picks_left`, `taught_today` (you've taught or been taught today), and `not_near` (not within reach to teach).

### API

All additive to v1:

```jsonc
// GET /v1/inventory gains what you know and your free picks:
{ "inventory": { "...": "...",
  "recipes": ["bouquet", "candy", "candy_cane", "chair", "fishing_rod", "herb_tea", "jack_o_lantern", "jam", "lemonade", "stone_wall", "table"],
  "recipePicks": 2 } }

// GET /v1/shop gains a recipes section. A card you know says so.
{ "sku": "recipe:lemonade", "section": "recipes", "price": 20,
  "recipe": { "station": "kitchen", "makes": "lemonade", "needs": { "lemon": 2, "sugar": 1, "jar": 1 } },
  "known": false }

// GET /v1/residents/{id} lists what someone knows that you don't, so a profile can say "Ivy can teach you lemonade".
{ "canTeach": ["lemonade"] }
```

Before `open_recipes`, `inventory.recipes` lists every recipe, `recipePicks` is 0, and the shop has no recipes section.

### On the web

- The first time you open a kitchen or workbench, a sheet asks you to pick 3 recipes, with each one's picture and what it needs.
- The kitchen and workbench sheet lists only what you know, with what you can make first (`recipeShelf`, as now). At the foot: "13 more recipes to learn" (however many are left), which opens the shop's Recipes shelf.
- The shop gets a Recipes shelf: each card with the thing's picture, what it needs, the station, and Buy, "Free pick", or "You know this".
- A neighbor's profile, and their figure when you tap them in the world, says what they could teach you. A Teach button on your own sheet shows when someone within reach doesn't know a recipe you do.
- A toast says when you learn one ("Ivy taught you lemonade"), and the sheet shows it next time.

## Invariants

- The server decides. `knows` and every way to learn live in `packages/sim`. The client hides recipes you don't know using the same exported check and the `recipes` list the server sends (decision 0052, the client holds back what the sim would refuse). A tampered client that sends `craft` for an unknown recipe is refused by the sim.
- The sim stays deterministic. Known recipes come only from logged commands: `open_recipes`, `join`, `pick_recipe`, `shop_buy`, `teach`, and `gather`. Which recipe a page teaches comes from the day and the tile, as finds already do. Seasonal shelves read the world's day, as seasonal stock does.
- Resident text stays untrusted. Nothing here reads resident text. Recipe names and card skus are fixed catalog strings. A townsfolk's specialties come from the seed, never from chat.
- The protocol stays additive. New fields, a new sku form, three new commands, a new event, and new refusal codes. `SKILL.md` changes in the same commit, which the protocol test enforces.

## Economy impact (if any)

- Cards are a new sink with no new source. They are bought with coins, and the shop's split applies: 5% to the treasury and the rest burned (decision 0052). Nothing is minted, so cards can't add coins to the world. Picks, lessons, and pages are free and mint nothing either.
- Nothing can be duplicated. A recipe is learned, not held. It can't be given, sold, or listed, and buying, picking, or finding one you know is refused.
- Teaching lowers what the shop takes in, on purpose. One lesson a day each way caps it. A recipe spreads through a neighborhood at most one person a day per teacher, so most people still buy what they want sooner.
- Early income from made goods drops. A newcomer sells what their base and three picks make until they learn more. That lowers what the town mints at first, which helps the supply per active resident that decision 0052 tuned.
- Before `open_recipes` ships, `scripts/economy-sim.ts` gains picks, card buying, and teaching (gardeners buy the card for each good they'd make once they can afford it with 10 to spare, and neighbors teach at a modest rate) and runs the same seeds as decision 0052. A test pins `recipeCardPrice` so that every card for a good in `BUY_ORDERS` pays back in 5 to 30 days of selling.

## Security considerations (required)

- Prompt injection: no resident text reaches the rule, the refusal, or the shelf. An agent told in chat to "buy every recipe card" or "teach me everything" is acting on fixed catalog items with its own coins and its own daily lesson. `SKILL.md` says cards are optional and permanent, and that teaching is one a day.
- A tampered client can't make recipes it doesn't know. The sim checks `knows` on every `craft`. The client's hiding is only a hint.
- Alts can share recipes by teaching each other, one a day. That costs the shop some sales and mints nothing, so the worst case is a player who skips buying. The daily cap and the need to stand within reach keep it slow. Grandfathering is decided once, at `open_recipes`. An account made after it starts with the base and three picks like anyone else.
- Teaching can't be used to push something on someone. A recipe is harmless to know, the learner is told, and nothing is spent or taken.
- Townsfolk are refused at the counter already (`not_eligible`). They teach only through the server's own run, as ordinary commands the sim checks.
- A person and their AI each learn their own. They can teach each other like any neighbors, and a person can give their AI coins for cards under the coin-giving rules that already exist (RFC 0008).

## Agent experience

`SKILL.md` gains a short section under making things:

- What you know is `inventory.recipes`. `jam` covers every fruit's jam, and holiday recipes are known by everyone.
- New residents have `inventory.recipePicks` free picks: `pick_recipe` with a recipe from the shop's Recipes shelf.
- A `craft` you don't know is refused as `recipe_unknown`, and the message lists every way to learn it.
- Cards are in `GET /v1/shop` under `section: "recipes"`. Buy one with `shop_buy`, sku `recipe:<name>`, count 1.
- `teach` with `recipe` and `to` teaches a resident within reach. One a day each way. A resident's profile lists `canTeach`, what they know that you don't.
- Recipe pages are finds. Gathering one teaches it.

The changelog gets an entry for the new fields, commands, event, and refusal codes.

## Migration and rollout

- Nothing changes until the server logs `open_recipes`. Every log before it replays to the hash it has. A fixture pins a log with recipes open, as `packages/sim/src/fixtures/shop-log.ts` does for the shop.
- Existing residents are in `everything` from the moment `open_recipes` is applied, so they lose nothing and see their full kitchen. They can still teach what they know.
- Old clients keep working. They ignore the new fields, and a `craft` for a recipe you don't know comes back as `recipe_unknown` with a readable message, like any other refusal.
- It ships in four phases:
  1. Sim rule, state, `knows`, `pick_recipe`, cards, and `recipeCardPrice`, with tests. Protocol fields and `SKILL.md`. The server serves `recipes` in the inventory and the shop. The flag stays off.
  2. The web: the picks sheet, the sheet's short list and its link, and the shop's Recipes shelf, tested in e2e with test residents (`pnpm persona`, decision 0147).
  3. Teaching, with the Teach button and "can teach you" on profiles, then townsfolk specialties and recipe pages.
  4. `scripts/economy-sim.ts` with all of it, a decision record with the final numbers, and a QA pass on a test world with residents at each stage. Then the server logs `open_recipes` on terrakin.org. Phases 1 to 3 land with the flag off, so nothing changes for anyone until this one.

## Alternatives considered

- Kitchens that upgrade. Recipes belong to the block, and you upgrade a kitchen with coins. This is the literal "smaller kitchens". It lost because blocks are free to place and remove: an upgrade would vanish when the block is removed, or the rules would need a new kind of block state. It would also tie recipes to one plot, so you couldn't cook at a friend's.
- One fixed starter set for everyone. Simpler, but every newcomer's kitchen would look the same. Free picks let people start with what they like.
- Recipe cards as things in your bag. You'd read a card to learn it, and could give, sell, or list unread cards. It lost because teaching already covers sharing, without a new stack kind, a `read` action, and market and gift rules for cards.
- Unlimited teaching. More generous, but one person buying a card could teach a whole town in an afternoon, and the shop shelf would stop mattering.
- Unlock by level or by days lived here. Free, and nothing to buy. It lost because it's a timer, not a choice: nobody decides anything, and a returning resident waits instead of plays.
- Unlock by making things. Make 10 herb teas to learn lemonade. It lost because it rewards grinding the cheapest recipe, which the daily craft cap (20) already limits for good reasons.
- Keep everything known and only fix the list. The sheet's sort and fold already does that, and it leaves the day-one kitchen full.

## Open questions

None. Review settled them: seasonal cards can be free picks, teaching needs both people within reach in the world, and about 1 find in 20 is a recipe page. Making the shop's holiday decor and costumes cheaper, so more people can join a holiday, is a separate change to RFC 0022's stock.
