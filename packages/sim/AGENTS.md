# packages/sim/

The rules engine. If a rule decides what's allowed in the world, it lives here and nowhere else.

## Invariants (tests enforce these; don't weaken them)

- **Pure and deterministic.** No `Date`, `Math.random`, timers, network, filesystem, or host globals. The tsconfig has no DOM or Node types on purpose. If you need randomness, add a seeded RNG to `WorldState` and draw from it, or have the server log the roll with the input. `src/clock.ts` only converts a reading it is handed.
- **Check, then commit.** `prepare()` runs every check and mutates nothing; its `commit()` makes the change. `apply()` is both in one call. A rejected input leaves state byte-identical (`hashWorld` before == after). The server persists between the two steps.
- **`seq` goes up by exactly one per accepted input.**
- **Events describe every change.** Clients mirror the world from events alone, without re-running rules. If you change state, emit an event for it.
- **State is plain JSON data.** Records, arrays, numbers, strings. No `Map`, classes, or `undefined` values, so `canonicalJson`/`hashWorld`/`cloneWorld` stay exact.
- **Replay must reproduce.** An accepted log replays to the same hash forever. Changing a rule that would change how existing logs replay needs an RFC ([decision 0003](../../docs/knowledge/decisions/0003-deterministic-sim-with-input-log.md)) and a bump of `REPLAY_VERSION` (`src/replay.ts`), since the server boots from snapshots ([decision 0070](../../docs/knowledge/decisions/0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)).
- **A snapshot plus the rest of the log is a straight replay.** A world written with `JSON.stringify` and read back with `JSON.parse` must apply the inputs after it to the same hash and the same event bytes. `replay.test.ts` checks every split point of every log in `src/fixtures/`, so a new fixture is covered by adding the file. Rules may not depend on anything outside the state.
- **Ids from inputs are own keys.** Look a record up by an id from a command with `own(record, id)` or `residentById(state, id)` (`src/own.ts`), never `record[id]` or `id in record`: `__proto__`, `constructor`, or `toString` would find what every object inherits, and the damage would replay on every restart. Write under such an id only after it was found, or after `isOwnableKey`. `own.test.ts` throws those ids at every input that takes one.
- **A rename keeps the old name replayable.** A command or field the sim renames keeps its old name in `src/renamed.ts`, which `prepare` reads every input through (`currentCommand`); the API refuses the old name. `floors.test.ts` and `circles.test.ts` replay logs under the old names. A logged command no rule knows throws, naming its type and `seq`, rather than building a different world.
- **New state is absent until used.** A new field stays off old records until an input sets it, and bookkeeping without an event starts only after a new input (like the first `new_day`), so old logs keep their hash. `src/fixtures/pre-town-log.ts` pins one such hash.
- **A rule change for a live world goes behind a logged switch.** A server-only input from `TOWN_ACTOR` turns it on (most use `oneTimeSwitch` in `src/check.ts`), so inputs logged before it replay as they were made and `REPLAY_VERSION` doesn't move. Each switch has a fixture with inputs on both sides of it. Once a system is on in a live world, its numbers, frozen tables, and editions change only behind a new switch or with an RFC and a `REPLAY_VERSION` bump.

One more rule, which no test enforces: the package is **free of side effects**. `package.json` says `"sideEffects": false`, so the web client's bundle leaves out the sim modules it doesn't use. A module may build its own tables when it loads (`CATALOG`, `SHOP_CATALOG`), but must never do something at import time that another module relies on without importing a name from it: no registering into, filling, or freezing a table another module owns, and no `import "./x"` for effect.

Commands the server sends itself (`new_day`, `set_townsfolk`, `close_proposal`, the switches, and every staff action) must come from `TOWN_ACTOR`.

## Where things are

Each system's module holds its numbers in one exported constant (`ECONOMY`, `ITEMS`, `FLOORS`, `PROGRESS`, `JOBS`, ...) and its own test pins them.

- `src/types.ts`: world, command, event, and rejection types. Start here.
- `src/apply.ts`: the rules, one `case` per command in `check()`.
- `src/world.ts`: geometry, `DEFAULT_CONFIG`, buildings and table spots, `downtown`, `settleProblem`, `claimLimit`.
- `src/walk.ts`: `stepFrom`, `walkOrWhy`, `walkLegsTo`, `route`. `src/putter.ts`, `src/visit.ts`, `src/presence.ts`, `src/routines.ts`: putter, visits, presence, offline routines.
- `src/hash.ts`, `src/keys.ts`, `src/own.ts`, `src/renamed.ts`, `src/replay.ts` (`REPLAY_VERSION`): the plumbing the invariants name.
- `src/check.ts`: `refuse`, `isWhole`, `coinCount`, `oneTimeSwitch`. `src/test-support.ts`: `expectSupplyHolds`, `fund`, `stock`.
- `src/catalog.ts`: every kind of thing (see [Adding a kind](#adding-a-kind)). `src/looks.ts`: themes, prints, wear slots, hair.
- A system's rules are in a module named for it (`economy.ts` for coins, `pottery.ts`, one per holiday). Less obvious homes: `ground.ts` paths and flooring, `furniture.ts` and `rest.ts` seats, `materials.ts` made walls and windows, `front-doors.ts` built doors, `display.ts` pieces and galleries, `entitlements.ts` partner wear, `awards.ts` recognition awards, `town.ts` the Town Hall, `doors.ts` the counter, park, and hall door an action needs you at ([RFC 0042](../../docs/rfcs/0042-actions-that-need-you-there.md)), `rebuild-home.ts` the server's `rebuild_home`, `openings.ts` exits, `design.ts` design notes, `map.ts` a plot as a map, `furnished.ts` how furnished a home is (counts only, read by views, never a rule; [decision 0400](../../docs/knowledge/decisions/0400-a-furnished-home-counts-furniture-and-seats-as-pieces-and-wh.md)).
- Pure functions of place, day, or hour: `biome.ts`, `season.ts`, `holiday.ts`, `weather.ts`, `time-of-day.ts`, `day-words.ts`, `clock.ts`. `palette.ts`: colors and looks, and `wall-look.ts` what each wall is made of (kept out of the web's first load).

## The world, walking, and reach

- `downtown(state)` is the rectangle the world had before any land opened (`state.lands.home`). Every rule about the town's centre reads it, never `state.config`, which `open_land` grows; the helpers take the world so passing the grown config is a type error.
- `stepFrom` is the one rule for a step: eight directions, never off the world, into a block, onto a solid building, or diagonally past a corner. Every `move`, putter step, and routine stroll is checked with it.
- Every refusal for a place too far away ends with the walk that fixes it, through `walkOrWhy` (`outOfReachHere` in `floors.ts` for the shared `out_of_reach`), never a straight line. `reach.test.ts` sends each such command from behind the starter hut, follows the refusal's walk, and sends it again; a new command that checks reach goes in its table.
- Planners (`planPutter`, `planStroll`, `visitTile`, `joinTile`, the land and way plans) run on the server and their result is logged with the input. The sim checks the logged result and never runs a planner, so improving one never changes how a log replays. `PUTTER_MAX_STEPS` may go up but never down.
- `biomeAt`, `seasonOf`, holidays, `weatherAt`, `timeOfDayAt`, and the day words are pure functions of position or day: never state, never in the log. Changing the biome map or the calendar changes replay; `biome.test.ts`, `weather.test.ts`, and `hanukkah.test.ts` pin them. Fishing reads the weather only from the copy the server logs with each cast.
- `palette.ts` is presentation only: no rule reads it, and the client, the 3D views, and the plot photos all draw from it. Residents see a world day in words (`day-words.ts`), never its number.
- Append-only lists: new patterns go on the end of `PRINTS`, new wear slots on the end of `WEAR_SLOTS`, partner wear on the end of `WEAR_ITEMS`, new holidays on the end of `HOLIDAYS`, new blocks on the end of `BLOCK_KINDS`, new stacks on the end of `STACK_KINDS`, so older records sort and hash the same. `jobs.test.ts` pins that a new holiday moves no logged day's board.
- Whatever lists wear for everyone leaves out earned wear (`isEarnedWear`) and job wear (`isJobWear`).

## Lands, streets, and ways

- An island is a region of the same plane. Water is what's left: a tile in bounds on no land's plots, square, or streets and not a bridge is sea. `seaFrom(config, lands)` is that one rule, built from the snapshot's facts so the web answers as the rules do. `settle` and `claim` refuse it, no pickup lies on it, and `fish` casts into it.
- Everything geometric about a land (size, plots, bridge, square, streets) arrives in the logged `open_land`, which refuses a square or street that would break the land's shape. `src/fixtures/lands-log.ts` and `streets-log.ts` pin it, and `LANDS_ISLAND` is the island every test that needs a land open sends.
- A square, a street, and a public way are nobody's: `settle`, `claim`, `place`, `remove`, `lay`, `lift`, and `build` refuse them (`public_ground` for streets and ways). No block goes on the ground floor of a way tile; `build_starter_home` skips one.
- An island's hall building takes no filings: `propose` measures only to downtown's `townHallTile`. `nearestCounter` and `nearestPark` pick the land you stand on first, then distance, and the refusal names the walk, never which door.
- A way counts as an exit only when a walk from the Commons reaches it over unclaimed ground and ways (`joinedWays`, seeded from every open Commons tile). `ways.test.ts` pins every refusal.

## Exits and design notes

- `openings.ts`, `design.ts`, and `map.ts` are read-only: no rule calls them, and `apply` reads only `nearestFreePlot`, for a refusal's words. `scripts/landlocked.ts`, `scripts/ways.ts`, and the web's claim picker ask the same question through `openingFactsFrom`, and the server's way planner reads the exported `placeOf` and `placeWalk` so it plans on the same place and walk.
- One household's touching plots are one place for exits, so a place never has fewer exits than a plot of it alone (decision 0364).
- A design note's words are fixed strings with numbers and tiles, never a name or anything a resident wrote, and a note never refuses.

## Coins

- Nothing about coins runs until `open_economy`. `src/fixtures/pre-economy-log.ts` and `post-economy-log.ts` pin both sides, so a change to `ECONOMY` that would replay the live log differently fails a test.
- The supply identity holds after every input: `sum(economy.coins) + economy.treasury + bountyHeld + eventHeld == economy.minted - economy.burned`. `economy.test.ts` checks it after each one, and `expectSupplyHolds` is the helper other suites call.
- The allowance, the welcome gift, and the pantry are bookkeeping in `prepare()`'s commit, paid when a resident's own input (not `join` or `leave`) leaves them on their hearth, once a day, only when there's something to pay, and never to townsfolk. `home` while already home is accepted only when one of them is due.
- Purses are private. The public world snapshot drops `state.economy` and keeps only the treasury (`treasuryOf`). A `coins` event belongs to its `residentId` alone, and a gift's response drops the receiver's `coins` event. `owner_pairs_set`, `owner_pair_added`, `owner_pair_removed`, and `maintainers_set` stay on the server.
- `add_owner_pair` and `remove_owner_pair` leave the world exactly as `set_owner_pairs` with the whole new list would; a test compares the hashes step by step. A pair skips the gift caps only from the day after it appears.
- `daily_awards` pays each ended day at most once and in order ([decision 0055](../../docs/knowledge/decisions/0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)). `ECONOMY.appreciationCap` may go up, never down.
- Townsfolk never save: at `new_day` a townsfolk's whole purse goes back to the treasury. The server keeps gifts with townsfolk on either side out of the public gift list, so the treasury's townsfolk net stays unattributed.
- An award (`award_grant`) moves treasury coins under `treasurySpare`, mints nothing, and requires the awarding maintainer's `resident`: an award the sim can't place in a household is refused. Its household mark goes on `state.awards`, the public `award_paid`, and the treasury's ledger line, which is the durable public record.
- `test_grant` comes only from the server's test route and takes coins from the treasury, so nothing is minted. No production log holds one.
- Players see "coins", never "token".

## Residents: names, merges, retired joins

- `join` checks only a name's length, because logged joins hold older names; the protocol's `ResidentName` and the server's `createResident` hold every new name to `NAME_PATTERN`.
- `merge_resident` refuses, changing nothing, while anything `from` shares with others still runs, and moves or drops each kind of per-resident state. A new kind of per-resident state decides in `merge.ts` whether it moves, drops, or refuses, and `retireProblems` in `repeat-joins.ts` whether it makes a record "used". `src/fixtures/merge-log.ts` and `repeat-joins-log.ts` pin them.
- `retireProblems` compares names with ASCII letters folded, never the server's `nameKey`, whose Unicode tables come from the runtime.

## Items

- Nothing about items runs until `open_items`; `src/fixtures/items-log.ts` pins a log on top of the post-economy one.
- Growth reads only `state.day` (`plantedDay`, `readyDay`), so `new_day` changes nothing about crops and a skipped day counts like any other.
- The first pantry gives `STARTER_SEEDS` and every pantry tops up `PANTRY_STAPLES`, both frozen, so a new seed or staple never changes what an old pantry gave. `catalog.test.ts` pins them. Read the pantry's numbers through `pantryNumbers(state)`.
- Every unit counts toward the cap, which rules read through `inventoryMaxOf(state)`: 200, or 400 once `raise_inventory` is logged ([decision 0388](../../docs/knowledge/decisions/0388-a-resident-holds-400-things-from-a-logged-raise-inventory-an.md)). `src/fixtures/raised-inventory-log.ts` pins both sides. A made thing keeps its id, maker, and made day wherever it goes. Inventories are private: an `inventory` event belongs to its `residentId`; `planted`, `harvested`, `gathered`, and `item_given` (no count, no note) are public.
- Anything that goes back to a resident whose things are full is held aside (`items.heldAside`) and returned in `prepare()`'s commit with their first input that leaves room. Nothing goes past the cap.
- A planter with a crop, a pedestal or frame with something on it, and a kiln with a pot can't be removed.
- Gifts can be sent back once `open_gifts` is logged.

## Gathering and finds

- What lies where is a pure function of tile and day (`gatherableAt`). Changing the spawn or `GATHER`'s chances changes replay; `gather.test.ts` pins both. Only today's picked tiles live in state.
- `FIND_SPAWNS` and `PAGE_RECIPES` are frozen: a new find, card page, or new numbers is a new table behind a new switch. `gather.test.ts` fails on a find no table spawns. Finds, pages, and clay each roll on their own and only where nothing else lies, so turning one on moves nothing else.
- `own_plot_pickups` and `open_way_pickups` gate who may gather where (`mayGatherOn`, which clients call too).

## The town shop

- Nothing about the shop runs until `open_shop`; `src/fixtures/shop-log.ts` pins a log and `shop.test.ts` every price.
- A purchase moves the price out of the purse, the treasury's share (`treasuryShareOf`, rounded down) into the treasury, and burns the rest. A sale to the town mints the price. `priceOf(state, sku)` is what the shop asks, including the frozen `HOLIDAY_PRICES_BEFORE` until `lower_holiday_prices` ([decision 0210](../../docs/knowledge/decisions/0210-halloween-s-costumes-and-decor-cost-half-from-a-logged-lower.md)).
- `ROTATION_GOODS` and `ROTATION_CROPS` are frozen: a longer list would change what the town bought on every past day. A new kind for the town to buy gets a buy order and goes in a season's buys by a decision of its own. Seasonal fish go on the end of `SEASON_BUYS`.
- Seasonal and holiday stock is refused outside its window; what a resident bought stays theirs all year. `seasons.test.ts`, `winter.test.ts`, and `halloween.test.ts` pin each window's numbers ([decision 0079](../../docs/knowledge/decisions/0079-autumn-s-numbers-pumpkins-pumpkin-pie-and-soup-hay-bales-and.md), [decision 0124](../../docs/knowledge/decisions/0124-winter-s-numbers-cranberries-hot-cranberry-punch-winter-deco.md)).
- Once `shop_in_person` is logged, every shop command needs the actor at a counter on the ground floor, through `opened()` ([decision 0323](../../docs/knowledge/decisions/0323-shopping-needs-you-at-the-counter-behind-a-logged-switch.md)). A free `pick_recipe` doesn't go through it. `src/fixtures/shop-counter-log.ts` pins both sides.
- Townsfolk never shop, trade, groom, take jobs, or post or claim bounties (`not_eligible`).

## Recipes (RFC 0024)

- Nothing about recipes runs until `open_recipes`; until then `knows` says yes to everyone. `src/fixtures/recipes-log.ts` and `lessons-log.ts` pin it.
- A resident knows `BASE_RECIPES` (frozen), every holiday recipe, what they learned, and everything when they're townsfolk or in `everything`. A new base recipe needs a logged input of its own. Made materials are never a recipe anyone learns.
- `craft` checks `knows` after every check of its own and before it takes anything.
- Cards aren't things: nothing goes in an inventory, so nothing can be given, sold, or listed. Every way to learn ends in a private `recipe_learned`.
- Card prices come from `recipeCardPrice`, never a table; `recipes.test.ts` pins every one and the page rate. Which townsfolk teaches what is the server's; the sim checks each lesson like any other.

## Building (RFC 0016)

- Ground (`state.ground`) never blocks: `isSolid` reads blocks only. `release` refuses while a plot has ground, blocks, a roof, or anything on any floor (`plotHasAnything`).
- What any block costs is `blockNeeds` in `items.ts`, which `place`, `remove`, `build`, `build_starter_home`, and `set_roof` all read; it's given back to whoever takes it up. Free blocks touch nobody's things and work before items open. A starter home is never built from decor, ponds, or doors.
- A new furniture piece is a catalog entry with the role `furniture` and its name on the end of `BLOCK_KINDS`, never in `FREE_BLOCKS` or `BUILDING_BLOCKS`. `BUILDING_BLOCKS` stays the four free walls, since it's what a Town Hall build places from nobody's things and what a theme dresses.
- Every piece of furniture blocks walking but `WALKED_ONTO_SEATS`, and only stairs, a door, and those seats are let through by `blocksWalkers`. The chair and the bench stay solid, since making them walkable would change logged walks, and the rocking chair stays solid like them.
- A `build` plan is in plot coordinates. `build` refuses all of a plan it gets wrong, and skips and reports what moved. Its events are the single actions' own plus one `inventory` with the net change. `src/fixtures/build-log.ts` pins it.
- A Town Hall `commons_build` uses nobody's things and, once `keep_table_spots` is logged, puts no block on a game table's spot ([decision 0126](../../docs/knowledge/decisions/0126-town-hall-builds-keep-the-game-tables-spots-clear-from-a-log.md)). `commons-log.ts` and `table-spots-log.ts` pin it.
- A door is ground floor only and holds nothing up. A lock, if one comes, never counts against a plot's way out. `src/fixtures/doors-log.ts` pins `starter_doors`.

## Floors (RFC 0028)

- A `floor` is a level of a home, always a number; flooring is a ground kind laid on a tile. The two words never stand for each other.
- The ground floor is floor 0 in `state.blocks` and `state.ground`. A reader that means any floor goes through `blocksOn`, `groundOn`, and `solidAt`; nothing else reaches into `state.floors`. A floor from an input becomes a key only after `floorOf` checks it.
- `FLOORS.max` may go up, never down. `FLOORS.price` changes only behind a logged switch ([decision 0242](../../docs/knowledge/decisions/0242-a-storey-costs-200-coins-the-economy-run-with-builders-says-.md)).
- Stations whose state is keyed by tile alone (planters, kitchens, workbenches, pedestals, frames, ponds, candy bowls, kilns, doors) stay on the ground floor. Hearths, crops, displays, gathering, fishing, and knocking are ground floor only.
- The climb hints are a contract: `floors.test.ts` walks the whole way up by parsing them, so a reword that drops a call fails it.
- A `build` plan's order is fixed (removals from the top floor down, then the ground floor, then each floor up), and each tile is checked against the plan's running view. The protocol's `PLAN_MAX` is `planMax`. `src/fixtures/floors-log.ts` pins it.
- The client builds its walking ground and climbs from its mirror with the same pure functions (`groundOf`, `upstairsGroundOf`, `climbsAt`, `upstairsProblem`).

## Surfaces and walls (RFC 0050)

- A surface (`SURFACE_BLOCKS`) holds one small thing in `items.tops`, keyed like a pot; a solid wall face holds one thing in `items.hung`, keyed by the tile it's seen from and the side its wall is on (`faceKey`). Both keep whoever put it there and give it back, held aside when they're full ([decision 0392](../../docs/knowledge/decisions/0392-things-on-surfaces-and-walls-are-kept-by-tile-and-face-shop-.md)).
- A surface with something on it refuses `remove`, `clear_block` and a plan's removal. A wall coming down any way gives back what hung on it (`releaseHungOn`) in the same commit, never refuses. A tile something hangs facing takes no block.
- `src/fixtures/surfaces-log.ts` and `surfaces.test.ts` pin it.

## Resting (RFC 0044)

- Resting is where you stand, never a field: someone on a seat's tile is resting, and any move takes them off. `rest` pays nothing. `src/fixtures/cozy-log.ts` and `rest.test.ts` pin it.

## Walls between tiles (RFC 0050)

- A line between two tiles has one key, a tile and `n` or `w` (`edgeKey`); readers go through `edgeAt` and `edgesOn`, and nothing else reaches into `state.edges` or a floor's `edges` ([decision 0396](../../docs/knowledge/decisions/0396-walls-between-tiles-are-keyed-by-a-tile-s-north-and-west-lin.md)).
- `stepFrom` reads a ground's `edge` only when it has one, and `worldGround` and `floorGround` give one only to a world with edges (`withEdges`), so a world without them walks as it always did. Every wrapper of a `Ground` passes `edge` through.
- A line counts as a wall at both its tiles for holding flooring up, for a roof (`spanBoxes`, only when a plot has edges), and for hanging. Taking one down gives back its cost and what hung on it, by `remove`, a plan's `removeEdges`, or a slim.
- `slim_walls` is the server's plan logged as lists and checked as the resident's `build`; the plot's first one gets a gift of made material through `planBuild`'s `gift`. `src/fixtures/edges-log.ts` and `edges.test.ts` pin it.

## Roofs (RFC 0041)

- A roof is one `roof` field on the plot, never on tiles. What it covers is read from the walls each time it's drawn (`roofShape`), so taking a wall down never has to be checked against a roof. Every view draws from `roofShape`, so all of them agree tile for tile.
- Its covering costs `blockNeeds(material)` times `ROOFS.blocks`, taken when it goes up and given back when it changes or comes down. `roof_set`, `roof_changed`, and `roof_top_set` are distinct so readers can count roofs. `src/fixtures/roof-log.ts` and `roofs.test.ts` pin it.

## Displays and plot names

- A displayed thing stays its displayer's. A find on display is never admired, reported, or in a gallery; the made-thing helpers leave finds out.
- A plot name changes once a world day, with two free renames; `null` clears it any time and keeps `namedDay`, so a clear or a takedown never makes room for another name that day. `plot-names-log.ts` and `free-renames-log.ts` pin it.
- A pet's, plot's, circle's, or invite's text is resident text: the sim checks its length; the server cleans and filters it before it's logged, and events carrying it go out marked `untrusted`.

## The market

- Nothing about the market runs until `open_market`; `src/fixtures/market-log.ts` pins it.
- Listing burns `MARKET.listingFee` from the seller's purse. A listed lot is in escrow in `market.listings`. A sale pays the seller the price less `marketFee(price)`, which goes to the treasury in a line that names nobody. `listing_sold` never names the buyer.
- `remove_listing` gives the lot back, or marks it `takenDown` until the seller collects it. No coins move.
- The server adds two gates the sim can't see: time in Terrakin and karma for listing, and blocks for buying.

## The plot market

- A listed plot is frozen: every rule that changes a plot asks `plotListedProblem` or `tileListedProblem`. The compiler can't check that list, so `plot-market.test.ts` tries each rule on a listed plot, and a new rule that changes a plot belongs in its table.
- A sale moves only the plot record's `ownerId`, so everything on it goes along untouched. It's downtown only, refused inside one household, and exempt from the gift caps. Once `open_plot_market` is logged, `claim` and `settle` take only a first plot. `src/fixtures/plot-market-log.ts` pins it.

## Bounties and grants

- Nothing about bounties runs until `open_bounties`; `src/fixtures/bounties-log.ts` pins it.
- A bounty's reward is held from posting until it's paid, cancelled, or expires, and counts in the supply identity (`bountyHeld`).
- A town bounty is confirmed by a maintainer through the server, never the claimant, the proposer, or either's household. `to` must name the claimant, so a payout can't race a change of claimant.
- Grants and town bounties take only `treasurySpare`, when filed and when they close.
- `bountyMoves` and `postBountyProblem` run the commands' own checks without committing, so views offer only what the sim would accept. `bounty_posted`'s words are stripped on the wire.

## Hosted events

- The server logs an event's life (`event_start`, `event_tick`, `event_end`); the sim has no clock and never compares a time. `src/fixtures/events-log.ts` pins it.
- A Commons deposit counts in the supply identity (`eventHeld`) and comes back only when the event counted enough attendees outside the host's household, was called off in time, or was voided.
- `event_scheduled` carries where and when, never the words. `event_ticked` stays off the wire.

## Pets

- One pet each, for good, kept on its owner's resident. Where a pet stands is never state, and pats are server social rows. `src/fixtures/pets-log.ts` and `pet-park-log.ts` pin it.
- The green is worked out from each square, never built. A pet meeting counts only between two households, neither townsfolk.

## Fishing (RFC 0023)

- A cast reads no clock, weather, or random number: the server logs `roll`, `weather`, and `timeOfDay`, and `checkFish` refuses values it would never log.
- Fish never run out: no pond holds a stock. `CATCHES` is frozen by name; a new fish or new numbers is a new table behind a logged switch. `src/fixtures/fishing-log.ts` pins it.

## Pottery (RFC 0047)

- Pottery's rules are frozen like any other system's: terrakin.org logs `open_clay` ([decision 0371](../../docs/knowledge/decisions/0371-pottery-is-on-at-terrakin-org-the-worker-sets-clay-the-node-.md)). A change to how clay lies, what a kiln takes or does, the finishes and their odds, a pot card's price, or how tea is poured and credited moves `REPLAY_VERSION` with an RFC or goes behind a logged switch. A local test world written under older rules can stop replaying: wipe it ([learning](../../docs/knowledge/learnings/2026-10-23-a-test-world-s-log-written-under-earlier-pottery-rules-no-lo.md)).
- Nothing about pottery runs until `open_clay`, which the server logs only with its `clay` option ([decision 0362](../../docs/knowledge/decisions/0362-the-kiln-is-built-behind-open-clay-which-no-adapter-sets-unt.md)). `clayRule` keeps the first rule only so the kiln fixture's hash holds.
- A finish comes from a roll the server logs and the frozen `FINISHES`; the sim never rolls. A finish's name is in the world's hash, so renaming one is a replay change ([decision 0367](../../docs/knowledge/decisions/0367-a-pot-is-named-by-its-finish-and-glaze-everywhere-and-the-pl.md)). Events carry a pot by its codes, never its label (`potName` is the words).
- A pot set down or firing still counts as its owner's (`everyGood`), so `merge_resident`, `list_plot`, `clear_block`, and a plan's removal refuse or skip around it. `src/fixtures/kiln-log.ts` and `pottery.test.ts` pin every refusal.
- Who a cup of tea reaches is the server's to say (ages, blocks); the sim refuses a guest outside the event's own samples.
- Jobs' third edition adds the pot jobs only once clay is out, so without clay it reads the second edition's boards, which `jobs.test.ts` pins.

## Holidays

- A trick-or-treat night may be added but never taken away, since logged knocks replay only while their day counts. `src/fixtures/halloween-log.ts` pins it.
- A wrapped present is held by its giver until opened, and `present_given` never says what's in it. `christmas.test.ts`, `thanksgiving.test.ts`, and `newyear.test.ts` cover each refusal leaving the world as it was.

## Party games

- A round is sealed: no event carries a choice before `close_round`, and the order choices came in never matters. The server stamps times and decides when a round closes.
- The table's `secret` is in the hashed world and its key must sort after `sealed`, since FNV-1a can be run backwards over known bytes. `games.test.ts` checks the order.
- Ratings are whole-number Elo; who's rated is fixed at `start_game` and leaves out households and residents who couldn't vote. `src/fixtures/games-log.ts` pins it.

## Levels (RFC 0029)

- Points are not coins: nothing here mints, burns, or moves a coin or a thing, and `expectSupplyHolds` passes after every input in `levels.test.ts`. Points never go down.
- A level is never state; `levelOf(points)` reads it. The table may grow at the end and never change for a level anyone has reached.
- Each deed's rule has two halves: `...Counts` (whether it counts and its worth) and `underCap` (what fits today). Jobs read the first half alone. Townsfolk never earn, and a deed with a second resident counts only outside the household ([decision 0246](../../docs/knowledge/decisions/0246-level-n-to-n-1-takes-20-points-times-n-a-lesson-and-a-counte.md)).
- `credit_event`'s guest list can only leave a guest out, never add one: every guest must be in the event's own `attended`, outside the host's household, and not townsfolk.
- Levels unlock only fixed-word titles and earned wear; no action, coins, odds, or caps read a level. A garment's slot may not change once someone wears it.
- `progress` is private like `coins`; `level_reached` and `title_changed` are public. `src/fixtures/levels-log.ts` and `levels.test.ts` pin every number.

## Jobs (RFC 0030)

- Jobs are not coins, and a thing handed in leaves the world. `expectSupplyHolds` passes after every input in `jobs.test.ts`.
- The board is never state: `jobsOn(state)` reads it from the day and the edition's table. Every day has one job that needs nothing bought (`soloJob`), and no regular job waits two rounds of its lane from the second edition on ([decision 0265](../../docs/knowledge/decisions/0265-the-jobs-board-s-second-edition-a-lane-s-regular-jobs-carry-.md)). `jobs.test.ts` checks both over four years.
- An edition is frozen once a live world reads it. A changed table is the next edition, switched on by `set_job_edition`. A job's id and what it asks stay the same in every edition that has it, and `jobsOn` hashes for each edition are pinned ([decision 0268](../../docs/knowledge/decisions/0268-spring-and-summer-jobs-are-marlo-s-seasonal-finds-filled-in-.md)).
- A deed job reads the deed's own `...Counts`, so the household and ring rules that stop points farming stop job farming too. A held job moves only for deeds after the input that took it (`seq`, `endedSeq`).
- `hand_in` takes only a made good its resident made (or a record merged into them made): a jar passed around a household finishes one job, its maker's.
- Job events belong to their resident alone, like `coins`. `src/fixtures/jobs-log.ts` and `job-edition-log.ts` pin it, and the numbers come from [decision 0255](../../docs/knowledge/decisions/0255-a-job-pays-10-points-and-three-count-a-week-the-economy-run-.md).

## Circles (RFC 0033)

- Membership is read from `list` (`circleOf`), never kept twice. A circle that doesn't form gives back all but `trialBurn` of its fee ([decision 0290](../../docs/knowledge/decisions/0290-a-kindred-that-doesn-t-form-gives-back-all-but-5-of-its-fee-.md)).
- A circle night counts only members seen at `attendNeeded` samples, so leaving during a night never makes a member a counted guest; `credit_event` refuses a guest in `kin`.
- A forming circle's events go only to its members and invitees. `CIRCLES` numbers come from [decision 0279](../../docs/knowledge/decisions/0279-kindreds-land-in-the-sim-with-rfc-0033-s-answers-weeks-from-.md). `src/fixtures/circles-log.ts` pins it, and `CIRCLES_SETUP` is the world every circle test starts from.

## Tuning numbers

Rerun `scripts/economy-sim.ts` before changing a number in `ECONOMY`, the pantry, the shop, a season, `RECIPES_RULES`, `FLOORS`, `PROGRESS`, `JOBS`, or `CIRCLES`. Its header comment lists the flags.

## Adding a kind

A new kind of thing is an entry in `src/catalog.ts`, on the end of `WRITTEN`:

1. One entry: a `fruit(...)` or `crop(...)` call for something that grows (it makes the seed too, and a fruit's jam comes from the jam family recipe), or an `entry(...)` with its name and plural, family, role, and, as it needs them, a recipe or a shop price with seasons or a holiday.
2. Its look: a template and colors (`produce`, `sprig`, `bloom`, `jar`), or `drawn` with a picture under its id in `packages/ui/src/item-art.ts`.
3. Decor, furniture and made materials are blocks too: their id goes on the end of `BLOCK_KINDS` in `types.ts`, with a color in `BLOCK_COLORS` and their 3D and plot photo pictures. A made material's surface goes in `WALL_LOOK`.

The tests that run over every entry cover the rest: ids, families, names, looks, seeds and crops that pair up, recipes from things that stack, a jam for every fruit, and a picture for every kind ([decision 0085](../../docs/knowledge/decisions/0085-furniture-keeps-its-own-role-in-decor-furniture-and-pomegran.md), [decision 0308](../../docs/knowledge/decisions/0308-a-basket-of-fourteen-crops-sold-all-year-with-ten-recipes-an.md)). A new kind never joins a frozen list or what the town buys by being added: those are their own decisions. A new find lies nowhere until a new spawn table starts at a logged switch. A new family recipe, template, role, or family needs a decision record.

## Adding a command

1. Add it to `Command` in `types.ts`, plus any new `WorldEvent` and `RejectionCode`.
2. Implement the case in `check()` in `apply.ts`: validate everything and return a rejection, or return a closure that mutates and returns events. Do all reads in the check, not in the closure.
3. Test accept and every rejection path, plus a replay check if it touches new state. A command that checks reach goes in `reach.test.ts`'s table; one that changes a plot goes in `plot-market.test.ts`'s; one that takes an id goes through `own.test.ts`.
4. Expose it in `packages/protocol/` (schema and `SKILL.md`, then `pnpm gen`) and render its events in `packages/client/src/mirror.ts`.

## Writing tests

A rule is tested here, at the lowest layer that catches its failure (the root [definition of done](../../AGENTS.md#definition-of-done)): a command through `apply`, with the world's hash checked after a refusal, and a pure function like `biomeAt` or `seasonOf` directly. A test answers the four questions in the root definition of done first. A catalog fact belongs in `catalog.test.ts`, a field a pinned hash covers needs no check of its own, and a test that needs a test-only export goes through `apply` instead.

Every fixture hash pin and replay test stays. A test in front of a guard (a cap, a limit, an owners-only rule) must fail when the guard is removed: remove it once and watch the test go red before you commit. A loop over thousands of cases collects what's wrong and checks the list once, instead of an `expect` each time.
