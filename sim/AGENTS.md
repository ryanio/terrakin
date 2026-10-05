# sim/

The rules engine. If a rule decides what's allowed in the world, it lives here and nowhere else.

## Invariants (tests enforce these; don't weaken them)

- **Pure and deterministic.** No `Date`, `Math.random`, timers, network, filesystem, or host globals. The tsconfig has no DOM or Node types on purpose. If you need randomness, add a seeded RNG to `WorldState` and draw from it.
- **Check, then commit.** `prepare()` runs every check and mutates nothing; its `commit()` makes the change. `apply()` is both in one call. A rejected input leaves state byte-identical (`hashWorld` before == after). The server persists between the two steps.
- **`seq` goes up by exactly one per accepted input.**
- **Events describe every change.** Clients mirror the world from events alone, without re-running rules. If you change state, emit an event for it.
- **State is plain JSON data.** Records, arrays, numbers, strings. No `Map`, classes, or `undefined` values, so `canonicalJson`/`hashWorld`/`cloneWorld` stay exact.
- **Replay must reproduce.** An accepted log replays to the same hash forever. Changing a rule that would change how existing logs replay needs an RFC ([decision 0003](../docs/knowledge/decisions/0003-deterministic-sim-with-input-log.md)).
- **New state is absent until used.** A new field stays off old records until an input sets it, and bookkeeping without an event starts only after a new input (like the first `new_day`), so old logs keep their hash. `src/fixtures/pre-town-log.ts` pins one such hash.

## Where things are

- `src/types.ts` world, command, event, and rejection types. Start here.
- `src/apply.ts` the rules. One `case` per command.
- `src/world.ts` geometry helpers and `DEFAULT_CONFIG`.
- `src/hash.ts` canonical JSON + FNV-1a fingerprint. `src/keys.ts` the `"x,y"` record keys for tiles and plots.
- `src/replay.ts` rebuild state from a log.
- `src/town.ts` the Town Hall (RFC 0004): eligibility, proposals, votes, closes, builds, `TOWN_LIMITS`. Commands the server sends itself (`new_day`, `set_townsfolk`, `close_proposal`, `void_proposal`) must come from `TOWN_ACTOR` ([decision 0026](../docs/knowledge/decisions/0026-time-enters-the-sim-as-logged-day-and-close-inputs.md)).
- `src/looks.ts` the looks catalog (RFC 0005): themes, patterns, wear and its five slots (a dress covers the bottom slot), and `wearStyle`, a pattern and color per garment merged item by item ([decision 0053](../docs/knowledge/decisions/0053-any-garment-can-carry-its-own-pattern-and-color-with-bottoms.md)). New slots go on the end of `WEAR_SLOTS`, so older wear lists sort the same. The protocol and client import it.
- `src/putter.ts` `planPutter`: where a `putter` walks (up to `PUTTER.steps` tiles, next to someone nearby, else a neighbor's plot or your own plot's edge, else the Commons, else anywhere open), with choices picked by a hash of the actor, `seq`, and `day`. The server calls it and logs the steps; the sim checks them like moves, so replay never runs the planner and tuning it never changes old logs. `PUTTER_MAX_STEPS`, the sim's cap on logged steps, may go up but never down ([decision 0049](../docs/knowledge/decisions/0049-putter-is-a-planned-short-walk-logged-as-its-steps-with-a-on.md)).
- `src/biome.ts` `biomeAt`: the ground biome of a tile, a pure function of its position. Presentation only: never state, never in the log ([decision 0045](../docs/knowledge/decisions/0045-biomes-are-a-pure-function-of-position-presentation-only.md)). `biome.test.ts` pins the map.
- `src/palette.ts` the world's colors: ground per biome, blocks (and how a theme dresses them), the hearth, and each tile's tuft or flower (`groundTile`). Presentation only, like the looks catalog. `client/src/render.ts` and the plot photos (`server/src/plot-photo.ts`, drawn by `cards/`) both read it, so a photo looks like the world.
- `src/economy.ts` coins (RFC 0008): `ECONOMY` (every number, tuned with `scripts/economy-sim.ts`, [decision 0039](../docs/knowledge/decisions/0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md)), the treasury, purses and ledgers, the daily allowance and streak, the welcome gift, townsfolk budgets, and `give_coins` with its caps. The server-only `open_economy`, `set_owner_pairs`, `add_owner_pair`, `remove_owner_pair`, `set_maintainers`, and `daily_awards` come from `TOWN_ACTOR`.
- `src/items.ts` growing, making, and giving (RFC 0005 step 2): the catalog as data (`ITEM_INFO`, `CROP_INFO`, `RECIPES`), `ITEMS` (every number, [decision 0051](../docs/knowledge/decisions/0051-items-open-with-a-logged-input-grow-by-the-world-s-day-and-s.md)), inventories, `plant`, `harvest`, `craft`, `give` with its caps, the daily pantry (`pantryNumbers`), and placing and taking up decor. The server-only `open_items` comes from `TOWN_ACTOR`.
- `src/display.ts` showing (RFC 0005 step 3, [decision 0059](../docs/knowledge/decisions/0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md)): `make_piece` (a made thing of kind `piece` from an upload), `display` and `take_down` on a `pedestal` or `frame`, and the read helpers `displayAt` and `displaysOf`.
- `src/shop.ts` the town shop (RFC 0008 phase 2, [decision 0052](../docs/knowledge/decisions/0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md)): `SHOP_CATALOG`, `BUY_ORDERS`, `SHOP`, the daily rotation `townBuys(day)`, `shop_buy`, `sell_to_town`, and the read helpers `shopOf` and `shopFor`. The server-only `open_shop` comes from `TOWN_ACTOR`.
- `src/market.ts` the market (RFC 0008 phase 4, [decision 0056](../docs/knowledge/decisions/0056-the-market-holds-listings-in-escrow-in-the-sim-burns-a-listi.md)): `MARKET`, `marketFee`, `list_item`, `unlist_item`, `buy_listing`, and the read helpers `listingsOf`, `stallOf`, and `takenDownOf`. The server-only `open_market` and `remove_listing` come from `TOWN_ACTOR`.
- `src/entitlements.ts` partner wear (RFC 0007 phase 3, [decision 0061](../docs/knowledge/decisions/0061-partner-wear-reaches-the-sim-as-a-per-resident-entitlement-l.md)): `set_entitlements {residentId, items}` from `TOWN_ACTOR` replaces a resident's list of `EXCLUSIVE_WEAR` (`state.entitlements`, absent until the first), and takes off what they may no longer wear with a `profile_changed`. `join` and `profile` refuse partner wear without it (`not_entitled`). `src/fixtures/entitlements-log.ts` pins a log that uses it. Partner wear goes on the end of `WEAR_ITEMS`.
- `src/bounties.ts` bounties and grants (RFC 0008 phase 5, [decision 0062](../docs/knowledge/decisions/0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md)): `BOUNTIES`, `post_bounty`, `claim_bounty`, `drop_bounty`, `complete_bounty`, `confirm_bounty`, `cancel_bounty`, expiry at `new_day`, what a passed `grant` or `bounty` proposal pays (`townMoneyOnPass`, called from `close_proposal` in `town.ts`), and the read helpers `bountyHeld`, `bountyMoves`, and `postBountyProblem`. The server-only `open_bounties`, `confirm_town_bounty`, and `void_bounty` come from `TOWN_ACTOR`.
- `src/check.ts` `refuse`, `isWhole`, and `coinCount`, which the rule modules share. `src/test-support.ts` the helpers tests share: `expectSupplyHolds`, `fund`, `stock`.

## Items

- Nothing about items runs until `open_items`, which creates `state.items`. Until then old logs replay exactly; `src/fixtures/items-log.ts` pins a log with crops, crafting, and gifts on top of the post-economy one.
- Growth reads only `state.day`: a crop stores `plantedDay` and `readyDay` and is ready once the day reaches `readyDay`. `new_day` changes nothing about crops (it resets the daily counters), so a skipped day counts like any other and there is nothing to replay per crop.
- The pantry is bookkeeping in `prepare()`'s commit, like the allowance: it pays when a resident's own input leaves them on their hearth, once a day, only when it has something to add (so it never changes state without an event), and never to townsfolk. The first one brings the starter seeds. `home` while already home is accepted when the allowance or the pantry is due.
- Seeds, produce, and staples stack as counts (absent at 0). A made thing has an id from `items.nextId`, its maker, and its made day, and keeps them wherever it goes. Every unit counts toward `inventoryMax`.
- Inventories are private, like purses. An `inventory` event belongs to its `residentId` alone; a gift makes two. `planted`, `harvested`, and `item_given` (no count, no note) are public. Use `inventoryOf` for `GET /v1/inventory`.
- A planter with a crop in it can't be removed. Anyone who can build on the plot may harvest it into their own inventory.
- Pieces (`PIECE_KINDS`) are made things but not in `GOOD_KINDS`, whose length sets `townBuys`; use `MADE_KINDS` and `isMadeKind` for "its own item with an id". Displays live in `items.displays`, absent until the first `display`; a displayed thing stays its displayer's (`by`), `take_down` returns it to them, and a pedestal or frame with something on it can't be removed.
- Gifts can be sent back once the server logs `open_gifts`, which creates `items.gifts`. From then on each accepted `give` records a gift (`gift_1`, ...) that its recipient may send back whole with `decline_gift` until `lastDeclineDay`, if the giver has room. `new_day` forgets older ones. Before `open_gifts`, `give` hashes exactly as it did ([decision 0057](../docs/knowledge/decisions/0057-a-gift-can-carry-a-thing-and-its-recipient-can-send-it-back-.md)).

## The town shop

- Nothing about the shop runs until `open_shop`, which needs coins and items open and creates `state.shop`. Until then old logs replay exactly; `src/fixtures/shop-log.ts` pins a log with the shop open, and `shop.test.ts` pins every price.
- Decor (`DECOR_BLOCKS`: `lantern`, `frame`, `fence`, `bench`) is both a block kind and a stack kind. `place` takes one from the placer's things and `remove` gives it to whoever takes it up; free blocks touch nobody's things. A starter home is never built from decor.
- Shop wear (`SHOP_WEAR` in `looks.ts`) is bought once into `shop.wardrobe` and kept. `join` and `profile` refuse shop wear the resident doesn't own (`not_owned`).
- A purchase moves the price out of the purse, the treasury's share (`treasuryShareOf`, rounded down) into the treasury with a line that names nobody, and burns the rest. The share is `shop.treasuryShare`, absent (50%) until the server logs `set_shop_share` to match `SHOP.treasuryShare` (5%), so purchases replay at the share they were made at. A sale to the town mints the price. The town buys only `townBuys(day)`, each kind up to its `perDay` per resident, counted in `shop.today` and reset at `new_day`.
- Once the shop is open the pantry uses `ITEMS.shopPantry` and `ITEMS.shopStapleMax`. Read it through `pantryNumbers(state)`.
- Townsfolk never shop (`not_eligible`).

## The market

- Nothing about the market runs until `open_market`, which needs the shop open and creates `state.market`. Until then old logs replay exactly; `src/fixtures/market-log.ts` pins a log with trades.
- A listed lot leaves the seller's things and lives in `market.listings` (escrow) until `unlist_item` gives it back (if there's room) or `buy_listing` moves it to the buyer. Listing needs a hearth and burns `MARKET.listingFee`. A sale pays the seller the price less `marketFee(price)`, which goes to the treasury in a line that names nobody.
- `listed`, `unlisted`, `listing_sold`, and `listing_removed` are public; `listing_sold` never names the buyer. Coin and inventory events stay private.
- `remove_listing` (staff, after a report) gives the lot back to its seller, or, when their things are full, marks the listing `takenDown` and keeps it out of `listingsOf` and `stallOf` until the seller collects it with `unlist_item`. Nothing goes past `inventoryMax`, and no coins move.
- Townsfolk never trade (`not_eligible`). The server adds two gates the sim can't see: time in Terrakin and karma for listing, and blocks for buying.

## Bounties and grants

- Nothing about bounties runs until `open_bounties`, which needs coins open and creates `state.bounties`. `grant` and `bounty` proposals are refused until then too. Until then old logs replay exactly; `src/fixtures/bounties-log.ts` pins a log with a bounty paid, one cancelled, and a grant.
- A bounty's reward leaves its poster's purse (or the treasury, for a town bounty) when it's posted and is held in the bounty until it's paid, cancelled, or expires. `bountyHeld` is part of the supply identity: `sum(coins) + treasury + bountyHeld == minted - burned`. `expectSupplyHolds` checks it.
- A resident's bounty is paid by its poster (`confirm_bounty`), a town bounty by a maintainer through the server (`confirm_town_bounty`, never the claimant, the proposer, or either's household). `to` must name the claimant in both, so a payout can't race a change of claimant. A maintainer sends a town bounty's claimant back with `reopen_bounty`.
- A passed `grant` doesn't pay at close: its coins go into a bounty with `grant: true`, held by its resident and marked done, and `confirm_town_bounty` releases it (coin reason `grant`, event `grant_paid`). It can't be claimed, dropped, or reopened, and doesn't expire.
- Grants and town bounties take only what the treasury holds above `ECONOMY.budgetReserve` (`treasurySpare`), when filed and when they close.
- Posting counts toward the poster's `giveCap`, paying toward the claimant's `receiveCap` (an owner pair skips it). Grants and town bounties come from the treasury and skip the caps. Townsfolk neither post nor claim.
- Open or claimed bounties expire at `new_day` once `expiresDay` comes; done ones wait. Only the `BOUNTIES.keepFinished` most recently finished bounties (by `closedDay`) stay in the world.
- `bountyMoves` and `postBountyProblem` run the commands' own checks without committing, so views offer only what the sim would accept.
- `bounty_posted` carries the bounty's words; the server strips them on the wire, like proposal titles.

## Coins

- Nothing about coins runs until `open_economy`, which creates `state.economy`. Until then old logs replay exactly (`src/fixtures/pre-economy-log.ts` pins one with days, townsfolk, and a Town Hall). `src/fixtures/post-economy-log.ts` pins a log with coins moving, so a change to `ECONOMY` or a coin rule that would replay the live log differently fails a test. `ownerPairs` and `maintainers` are top-level keys, absent until set, and can be set before coins open. `ownerPairDays` records the day each pair first appeared; a pair skips the gift caps only from the day after. `add_owner_pair` and `remove_owner_pair` change one pair and leave the world exactly as `set_owner_pairs` with the whole new list would, so each link change logs one small input ([decision 0042](../docs/knowledge/decisions/0042-owner-pairs-reach-the-sim-one-pair-at-a-time.md)). Keep them equivalent; a test compares the hashes step by step.
- `sum(economy.coins) + economy.treasury + bountyHeld == economy.minted - economy.burned` after every input. `economy.test.ts` checks it after each one.
- The allowance and the welcome gift are bookkeeping in `prepare()`'s commit, like `lastActiveDay`: the welcome gift is worked out before the command commits and is only paid in full (otherwise the resident waits in `economy.owed`, which `new_day` pays in order), and the allowance pays whenever a resident's own input (not `join` or `leave`) leaves them on their hearth. `home` while already home is accepted only when it collects the allowance.
- Purses are private. `state.economy` holds every purse and ledger, so the public world snapshot must drop it, keeping only the treasury (`treasuryOf`). A `coins` event belongs to its `residentId` alone: the server sends it only to that resident, never in the public broadcast, and never in another resident's action response or socket echo. A gift returns two `coins` events from one input, one for each side, so the giver's response must drop the receiver's (it carries their balance). `treasury` events and `economy_opened` are public. `owner_pairs_set`, `owner_pair_added`, `owner_pair_removed`, and `maintainers_set` stay on the server. Use `purseOf` for `GET /v1/purse`.
- The treasury's history is public: townsfolk budgets and their returns are one line each for all townsfolk together, and only welcome gifts name a resident. Their difference is the day's net of townsfolk tips and gifts to townsfolk, so the server keeps gifts with townsfolk on either side out of the public gift list and the public `gift` event, leaving that net unattributed.
- `daily_awards {day, awards}` mints coins the server counted for a day that has ended (appreciation, [decision 0055](../docs/knowledge/decisions/0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)). Each day is paid at most once and in order (`economy.awardedDay`, absent until the first). `ECONOMY.appreciationCap` may go up, never down, since replay checks every logged award against it.
- Townsfolk never save: at `new_day` a townsfolk resident's whole purse goes back to the treasury, including coins they held before joining the list, and leaving the list hands it back at once.
- Players see "coins", never "token".

## Adding a command

1. Add it to `Command` in `types.ts`, plus any new `WorldEvent` and `RejectionCode`.
2. Implement the case in `check()` in `apply.ts`: validate everything and return a rejection, or return a closure that mutates and returns events. Do all reads in the check, not in the closure.
3. Test accept and every rejection path in `apply.test.ts`, plus a replay check if it touches new state.
4. Expose it in `protocol/` (schema and `SKILL.md`, then `pnpm gen`) and render its events in `client/src/mirror.ts`.
