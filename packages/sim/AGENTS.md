# packages/sim/

The rules engine. If a rule decides what's allowed in the world, it lives here and nowhere else.

## Invariants (tests enforce these; don't weaken them)

- **Pure and deterministic.** No `Date`, `Math.random`, timers, network, filesystem, or host globals. The tsconfig has no DOM or Node types on purpose. If you need randomness, add a seeded RNG to `WorldState` and draw from it, or have the server log the roll with the input.
- **Check, then commit.** `prepare()` runs every check and mutates nothing; its `commit()` makes the change. `apply()` is both in one call. A rejected input leaves state byte-identical (`hashWorld` before == after). The server persists between the two steps.
- **`seq` goes up by exactly one per accepted input.**
- **Events describe every change.** Clients mirror the world from events alone, without re-running rules. If you change state, emit an event for it.
- **State is plain JSON data.** Records, arrays, numbers, strings. No `Map`, classes, or `undefined` values, so `canonicalJson`/`hashWorld`/`cloneWorld` stay exact.
- **Replay must reproduce.** An accepted log replays to the same hash forever. Changing a rule that would change how existing logs replay needs an RFC ([decision 0003](../../docs/knowledge/decisions/0003-deterministic-sim-with-input-log.md)) and a bump of `REPLAY_VERSION` (`src/replay.ts`), since the server boots from snapshots ([decision 0070](../../docs/knowledge/decisions/0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md)).
- **A snapshot plus the rest of the log is a straight replay.** A world written with `JSON.stringify` and read back with `JSON.parse` must apply the inputs after it to the same hash and the same event bytes. `replay.test.ts` checks every split point of every log in `src/fixtures/`, so a new fixture is covered by adding the file. Rules may not depend on anything outside the state.
- **Ids from inputs are own keys.** Look a record up by an id from a command with `own(record, id)` or `residentById(state, id)` (`src/own.ts`), never `record[id]` or `id in record`: `__proto__`, `constructor`, or `toString` would find what every object inherits, and the damage would replay on every restart. Write under such an id only after it was found, or after `isOwnableKey`. `own.test.ts` throws those ids at every input that takes one.
- **A rename keeps the old name replayable.** A command or field the sim renames keeps its old name in `src/renamed.ts`, which `prepare` reads every input through (`currentCommand`); the API refuses the old name ([decision 0271](../../docs/knowledge/decisions/0271-a-renamed-command-or-field-keeps-its-old-name-in-the-sim-so-.md)). `floors.test.ts` and `circles.test.ts` replay logs under the old names. A logged command no rule knows throws, naming its type and `seq`, rather than building a different world.
- **New state is absent until used.** A new field stays off old records until an input sets it, and bookkeeping without an event starts only after a new input (like the first `new_day`), so old logs keep their hash. `src/fixtures/pre-town-log.ts` pins one such hash.
- **A rule change for a live world goes behind a logged switch.** A server-only input from `TOWN_ACTOR` turns it on (most use `oneTimeSwitch` in `src/check.ts`), so inputs logged before it replay as they were made and `REPLAY_VERSION` doesn't move. Each switch has a fixture with inputs on both sides of it. Once a system is on in a live world, its numbers, frozen tables, and editions change only behind a new switch or with an RFC and a `REPLAY_VERSION` bump.

One more rule, which no test enforces: the package is **free of side effects**. `package.json` says `"sideEffects": false`, so the web client's bundle leaves out the sim modules it doesn't use ([decision 0258](../../docs/knowledge/decisions/0258-the-first-load-s-budget-is-135-kb-counted-as-it-is-downloade.md)). A module may build its own tables when it loads (`CATALOG`, `SHOP_CATALOG`), but must never do something at import time that another module relies on without importing a name from it: no registering into, filling, or freezing a table another module owns, and no `import "./x"` for effect.

Commands the server sends itself (`new_day`, `set_townsfolk`, `close_proposal`, the switches, and every staff action) must come from `TOWN_ACTOR` ([decision 0026](../../docs/knowledge/decisions/0026-time-enters-the-sim-as-logged-day-and-close-inputs.md)).

## Where things are

Each system's module holds its numbers in one exported constant (`ECONOMY`, `ITEMS`, `FLOORS`, `PROGRESS`, `JOBS`, ...) and its own test pins them.

- `src/types.ts` world, command, event, and rejection types. Start here.
- `src/apply.ts` the rules. One `case` per command.
- `src/world.ts` geometry, `DEFAULT_CONFIG`, the buildings and table spots, the town squares, `settleProblem`, `claimLimit`, and `downtown(state)`.
- `src/walk.ts` walking ([decision 0072](../../docs/knowledge/decisions/0072-walking-is-eight-ways-around-solid-buildings-paced-by-your-f.md)): `stepFrom`, `walkLegsTo`, `walkWords`, `walkOrWhy`, `route`, and `solid_buildings`.
- `src/hash.ts` canonical JSON and the FNV-1a fingerprint. `src/keys.ts` the `"x,y"` record keys.
- `src/replay.ts` rebuilding state from a log, and `REPLAY_VERSION` (RFC 0014).
- `src/presence.ts` presence that comes with acting ([decision 0071](../../docs/knowledge/decisions/0071-presence-comes-with-acting-once-implicit-presence-is-logged.md)).
- `src/routines.ts` offline routines ([RFC 0009](../../docs/rfcs/0009-offline-routines.md), [decision 0082](../../docs/knowledge/decisions/0082-routines-are-logged-steps-the-sim-checks-due-from-their-utc-.md)).
- `src/town.ts` the Town Hall (RFC 0004): proposals, votes, closes, Commons builds ([decision 0101](../../docs/knowledge/decisions/0101-a-town-hall-build-lays-paths-and-places-decor-and-furniture-.md)).
- `src/doors.ts` `notAtDoor`, `nearestCounter`, `nearestPark`: the spots RFC 0042 actions need you at ([decision 0332](../../docs/knowledge/decisions/0332-every-island-gets-a-counter-and-a-hall-door-of-its-own-on-a-.md)).
- `src/looks.ts` themes, patterns and prints, wear and its slots, hair, earned and job wear.
- `src/putter.ts` `planPutter` and `PUTTER_MAX_STEPS` ([decision 0049](../../docs/knowledge/decisions/0049-putter-is-a-planned-short-walk-logged-as-its-steps-with-a-on.md)).
- `src/visit.ts` `visit`, `visitTile`, `plotHeart` ([decision 0091](../../docs/knowledge/decisions/0091-visit-is-a-jump-to-a-neighbor-s-door-logged-with-the-tile-th.md)).
- `src/plot-names.ts` plot names ([decision 0121](../../docs/knowledge/decisions/0121-a-plot-s-name-lives-on-the-plot-in-the-sim-set-by-its-reside.md)).
- `src/lands.ts` new lands, the sea, squares, and streets ([RFC 0038](../../docs/rfcs/0038-new-lands.md), [decision 0326](../../docs/knowledge/decisions/0326-an-island-is-a-region-of-the-same-plane-and-water-is-what-is.md), [decision 0356](../../docs/knowledge/decisions/0356-new-lands-are-laid-out-with-streets-logged-in-open-land-and-.md)).
- `src/ways.ts` public ways ([RFC 0046](../../docs/rfcs/0046-streets.md), [decision 0358](../../docs/knowledge/decisions/0358-a-public-way-is-tiles-of-a-plot-that-hold-no-block-laid-by-t.md)). `src/rebuild-home.ts` the server's `rebuild_home`.
- `src/biome.ts` `biomeAt` ([decision 0045](../../docs/knowledge/decisions/0045-biomes-are-a-pure-function-of-position-presentation-only.md)).
- `src/season.ts` `seasonOf`, `seasonSpan`, `weekStart`, the calendar words.
- `src/holiday.ts` holidays and their spans ([RFC 0022](../../docs/rfcs/0022-holidays.md), [RFC 0034](../../docs/rfcs/0034-winter-holidays.md), [decision 0106](../../docs/knowledge/decisions/0106-holidays-are-dated-windows-read-from-the-world-s-day-candy-i.md)).
- `src/weather.ts` `weatherAt` and `skyAt` ([decision 0073](../../docs/knowledge/decisions/0073-weather-is-a-pure-function-of-the-world-day-and-the-utc-hour.md)).
- `src/palette.ts` the world's colors and ground, way, roof, and crop looks. Presentation only; the client, the 3D views, and the plot photos all read it.
- `src/economy.ts` coins (RFC 0008, [decision 0039](../../docs/knowledge/decisions/0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md)): treasury, purses, allowance, welcome gift, budgets, `give_coins`, households.
- `src/awards.ts` recognition awards ([RFC 0036](../../docs/rfcs/0036-recognition-grants.md)).
- `src/test-grant.ts` `test_grant`, sent only from the server's test route ([decision 0147](../../docs/knowledge/decisions/0147-test-residents-are-built-through-real-actions-with-a-test-on.md)).
- `src/repeat-joins.ts` `retire_repeat_joins` ([decision 0230](../../docs/knowledge/decisions/0230-old-repeat-joins-are-retired-once-by-a-logged-input-the-sim-.md)).
- `src/names.ts` resident names and `rename_resident` ([decision 0379](../../docs/knowledge/decisions/0379-a-resident-s-name-is-ascii-letters-digits-and-underscores-ch.md)).
- `src/merge.ts` `merge_resident` ([decision 0239](../../docs/knowledge/decisions/0239-a-duplicate-record-is-merged-into-the-record-that-stays-by-a.md)).
- `src/catalog.ts` the catalog of things ([decision 0084](../../docs/knowledge/decisions/0084-every-kind-is-one-catalog-entry-in-one-family-the-sim-s-list.md)). See [Adding a kind](#adding-a-kind).
- `src/items.ts` growing, making, giving, the pantry, placing held blocks, `blockNeeds` ([decision 0051](../../docs/knowledge/decisions/0051-items-open-with-a-logged-input-grow-by-the-world-s-day-and-s.md)).
- `src/gather.ts` pickups, finds, gather-all ([decision 0063](../../docs/knowledge/decisions/0063-simple-gathering-is-in-phase-1-wood-and-stone-picku.md), [decision 0099](../../docs/knowledge/decisions/0099-finds-spawn-by-biome-and-season-after-a-logged-open-finds-fr.md), [decision 0125](../../docs/knowledge/decisions/0125-gather-with-no-tile-picks-up-everything-within-reach-north-t.md)).
- `src/ground.ts` paths and flooring ([decision 0075](../../docs/knowledge/decisions/0075-paths-and-floors-are-a-second-layer-that-never-blocks-and-fu.md)).
- `src/furniture.ts` furniture and the seats (RFC 0016, RFC 0044). `src/rest.ts` `rest`.
- `src/materials.ts` made walls and windows ([RFC 0041](../../docs/rfcs/0041-materials-and-roofs.md)).
- `src/build.ts` `build` plans ([decision 0076](../../docs/knowledge/decisions/0076-a-build-plan-uses-plot-coordinates-refuses-whole-what-the-pl.md)).
- `src/map.ts` plots as maps ([RFC 0032](../../docs/rfcs/0032-homes-agents-can-design.md), [decision 0280](../../docs/knowledge/decisions/0280-a-map-or-a-design-becomes-a-build-s-lists-in-the-protocol-be.md)). Read-only.
- `src/design.ts` design notes about a home ([decision 0281](../../docs/knowledge/decisions/0281-design-notes-read-the-ground-floor-from-the-plot-s-edge-and-.md), [decision 0354](../../docs/knowledge/decisions/0354-a-settle-or-claim-says-when-it-takes-a-neighbor-s-last-way-o.md)). Read-only.
- `src/openings.ts` a plot's exits ([decision 0351](../../docs/knowledge/decisions/0351-a-plot-s-way-out-is-a-step-from-its-hearth-s-walk-onto-groun.md), [decision 0364](../../docs/knowledge/decisions/0364-one-household-s-touching-plots-are-one-place-for-exits-and-t.md)). Read-only.
- `src/floors.ts` upstairs ([RFC 0028](../../docs/rfcs/0028-homes-with-storeys.md)). See [Floors](#floors-rfc-0028).
- `src/roofs.ts` roofs (RFC 0041, [decision 0324](../../docs/knowledge/decisions/0324-a-roof-is-a-look-on-the-plot-over-the-box-around-each-group-.md)).
- `src/front-doors.ts` built doors and `starter_doors` ([decision 0349](../../docs/knowledge/decisions/0349-a-door-is-a-free-ground-floor-block-walked-through-like-an-o.md)).
- `src/display.ts` pieces, displays, galleries, held-aside things ([decision 0059](../../docs/knowledge/decisions/0059-pieces-are-made-things-from-your-own-uploads-shown-on-pedest.md)).
- `src/shop.ts` the town shop ([decision 0052](../../docs/knowledge/decisions/0052-the-town-shop-sells-decor-and-wear-buys-a-rotating-few-goods.md), [decision 0078](../../docs/knowledge/decisions/0078-seasons-follow-the-utc-calendar-and-add-stock-crops-recipes-.md)).
- `src/recipes.ts` recipes you learn ([RFC 0024](../../docs/rfcs/0024-recipes-you-learn.md), [decision 0170](../../docs/knowledge/decisions/0170-recipes-are-learned-a-shared-base-three-free-picks-cards-pri.md)).
- `src/market.ts` the market ([decision 0056](../../docs/knowledge/decisions/0056-the-market-holds-listings-in-escrow-in-the-sim-burns-a-listi.md)).
- `src/plot-market.ts` the plot market ([RFC 0039](../../docs/rfcs/0039-plot-market.md), [decision 0344](../../docs/knowledge/decisions/0344-plots-are-sold-frozen-as-they-stand-downtown-only-behind-ope.md), [decision 0345](../../docs/knowledge/decisions/0345-the-plot-market-reaches-the-api-dark-priced-by-a-dry-run-rep.md)).
- `src/entitlements.ts` partner wear ([decision 0061](../../docs/knowledge/decisions/0061-partner-wear-reaches-the-sim-as-a-per-resident-entitlement-l.md)).
- `src/bounties.ts` bounties and grants ([decision 0062](../../docs/knowledge/decisions/0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md)).
- `src/events.ts` hosted events ([RFC 0010](../../docs/rfcs/0010-hosted-events.md), [decision 0080](../../docs/knowledge/decisions/0080-hosted-events-count-attendance-from-logged-samples-and-hold-.md)).
- `src/pets.ts` pets and the green ([RFC 0019](../../docs/rfcs/0019-pets.md), [RFC 0045](../../docs/rfcs/0045-the-green-where-pets-go-out.md), [decision 0090](../../docs/knowledge/decisions/0090-a-pet-is-for-good-free-to-adopt-renamed-free-once-a-day-and-.md), [decision 0348](../../docs/knowledge/decisions/0348-pets-go-out-on-the-green-the-middle-of-each-town-square-and-.md)). `src/pet-art.ts` the shared pet drawings.
- `src/games.ts` party games ([decision 0095](../../docs/knowledge/decisions/0095-party-games-are-sealed-rounds-the-server-stamps-closes-and-l.md)).
- `src/levels.ts` levels and skills ([RFC 0029](../../docs/rfcs/0029-levels-and-skills.md)).
- `src/jobs.ts` jobs ([RFC 0030](../../docs/rfcs/0030-jobs.md)).
- `src/circles.ts` circles ([RFC 0033](../../docs/rfcs/0033-kindreds.md)).
- `src/halloween.ts` trick-or-treating ([decision 0107](../../docs/knowledge/decisions/0107-halloween-s-numbers-costumes-candy-decor-and-the-night-s-cap.md)).
- `src/thanksgiving.ts` the feast and serving tea ([decision 0288](../../docs/knowledge/decisions/0288-thanksgiving-s-numbers-decor-the-feast-s-evening-and-one-dis.md)).
- `src/christmas.ts` wrapped presents ([decision 0291](../../docs/knowledge/decisions/0291-christmas-and-new-year-s-numbers-presents-wrapped-from-decem.md)). `src/newyear.ts` fireworks.
- `src/pottery.ts` clay, kilns, pots, tea ([RFC 0047](../../docs/rfcs/0047-trades-and-your-mark.md)).
- `src/fishing.ts` fishing ([RFC 0023](../../docs/rfcs/0023-fishing.md), [decision 0122](../../docs/knowledge/decisions/0122-fishing-is-a-cast-beside-a-pond-dug-for-stone-rolled-and-sta.md), [decision 0123](../../docs/knowledge/decisions/0123-fishing-s-numbers-ten-casts-a-day-what-bites-two-stone-a-pon.md)).
- `src/clock.ts` lengths of time and `utcDay`, for code handed a clock's reading. Nothing in it reads a clock.
- `src/day-words.ts` world days in words ([decision 0277](../../docs/knowledge/decisions/0277-world-days-are-shown-to-residents-in-human-words-never-as-th.md)).
- `src/time-of-day.ts` `timeOfDayAt`, which the server stamps a cast with.
- `src/check.ts` `refuse`, `isWhole`, `coinCount`, `oneTimeSwitch`. `src/test-support.ts` `expectSupplyHolds`, `fund`, `stock`.

## The world, walking, and reach

- `downtown(state)` is the rectangle the world had before any land opened (`state.lands.home`). Every rule about the town's centre reads it, never `state.config`, which `open_land` grows; the helpers take the world so passing the grown config is a type error.
- `stepFrom` is the one rule for a step: eight directions, never off the world, into a block, onto a solid building, or diagonally past a corner. Every `move`, putter step, and routine stroll is checked with it.
- Every refusal for a place too far away ends with the walk that fixes it, through `walkOrWhy` (`outOfReachHere` in `floors.ts` for the shared `out_of_reach`), never a straight line. `reach.test.ts` sends each such command from behind the starter hut, follows the refusal's walk, and sends it again; a new command that checks reach goes in its table.
- Planners (`planPutter`, `planStroll`, `visitTile`, `joinTile`, the land and way plans) run on the server and their result is logged with the input. The sim checks the logged result and never runs a planner, so improving one never changes how a log replays. `PUTTER_MAX_STEPS` may go up but never down.
- `biomeAt`, `seasonOf`, holidays, `weatherAt`, `timeOfDayAt`, and the day words are pure functions of position or day: never state, never in the log. Changing the biome map or the calendar changes replay; `biome.test.ts`, `weather.test.ts`, and `hanukkah.test.ts` pin them. Fishing reads the weather only from the copy the server logs with each cast.
- Append-only lists: new patterns go on the end of `PRINTS`, new wear slots on the end of `WEAR_SLOTS`, partner wear on the end of `WEAR_ITEMS`, new holidays on the end of `HOLIDAYS`, new blocks on the end of `BLOCK_KINDS`, new stacks on the end of `STACK_KINDS`, so older records sort and hash the same. `jobs.test.ts` pins that a new holiday moves no logged day's board.
- Whatever lists wear for everyone leaves out earned wear (`isEarnedWear`) and job wear (`isJobWear`).

## Lands, streets, and ways

- An island is a region of the same plane. Water is what's left: a tile in bounds on no land's plots, square, or streets and not a bridge is sea. `seaFrom(config, lands)` is that one rule, built from the snapshot's facts so the web answers as the rules do. `settle` and `claim` refuse it, no pickup lies on it, and `fish` casts into it ([decision 0339](../../docs/knowledge/decisions/0339-the-sea-is-water-you-can-fish-in-and-the-same-fish-bite.md)).
- Everything geometric about a land (size, plots, bridge, square, streets) arrives in the logged `open_land`, which refuses a square or street that would break the land's shape. `src/fixtures/lands-log.ts` and `streets-log.ts` pin it, and `LANDS_ISLAND` is the island every test that needs a land open sends.
- A square, a street, and a public way are nobody's: `settle`, `claim`, `place`, `remove`, `lay`, `lift`, and `build` refuse them (`public_ground` for streets and ways). No block goes on the ground floor of a way tile; `build_starter_home` skips one.
- An island's hall building takes no filings: `propose` measures only to downtown's `townHallTile` ([decision 0352](../../docs/knowledge/decisions/0352-an-island-s-presence-is-its-shop-counter-town-hall-filing-stays.md), [decision 0353](../../docs/knowledge/decisions/0353-an-island-s-hall-building-stays-standing-and-takes-no-filing.md)). `nearestCounter` and `nearestPark` pick the land you stand on first, then distance, and the refusal names the walk, never which door.
- A way counts as an exit only when a walk from the Commons reaches it over unclaimed ground and ways (`joinedWays`, seeded from every open Commons tile). `ways.test.ts` pins every refusal.

## Exits and design notes

- `openings.ts`, `design.ts`, and `map.ts` are read-only: no rule calls them, and `apply` reads only `nearestFreePlot`, for a refusal's words. `scripts/landlocked.ts`, `scripts/ways.ts`, and the web's claim picker ask the same question through `openingFactsFrom`.
- One household's touching plots are one place for exits, so a place never has fewer exits than a plot of it alone (decision 0364).
- A design note's words are fixed strings with numbers and tiles, never a name or anything a resident wrote, and a note never refuses.

## Coins

- Nothing about coins runs until `open_economy`. `src/fixtures/pre-economy-log.ts` and `post-economy-log.ts` pin both sides, so a change to `ECONOMY` that would replay the live log differently fails a test.
- The supply identity holds after every input: `sum(economy.coins) + economy.treasury + bountyHeld + eventHeld == economy.minted - economy.burned`. `economy.test.ts` checks it after each one, and `expectSupplyHolds` is the helper other suites call.
- The allowance, the welcome gift, and the pantry are bookkeeping in `prepare()`'s commit, paid when a resident's own input (not `join` or `leave`) leaves them on their hearth, once a day, only when there's something to pay, and never to townsfolk. `home` while already home is accepted only when one of them is due.
- Purses are private. The public world snapshot drops `state.economy` and keeps only the treasury (`treasuryOf`). A `coins` event belongs to its `residentId` alone, and a gift's response drops the receiver's `coins` event. `owner_pairs_set`, `owner_pair_added`, `owner_pair_removed`, and `maintainers_set` stay on the server.
- `add_owner_pair` and `remove_owner_pair` leave the world exactly as `set_owner_pairs` with the whole new list would ([decision 0042](../../docs/knowledge/decisions/0042-owner-pairs-reach-the-sim-one-pair-at-a-time.md)); a test compares the hashes step by step. A pair skips the gift caps only from the day after it appears.
- `daily_awards` pays each ended day at most once and in order ([decision 0055](../../docs/knowledge/decisions/0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)). `ECONOMY.appreciationCap` may go up, never down.
- Townsfolk never save: at `new_day` a townsfolk's whole purse goes back to the treasury. The server keeps gifts with townsfolk on either side out of the public gift list, so the treasury's townsfolk net stays unattributed.
- An award (`award_grant`) moves treasury coins under `treasurySpare`, mints nothing, and requires the awarding maintainer's `resident`: an award the sim can't place in a household is refused. Its household mark goes on `state.awards`, the public `award_paid`, and the treasury's ledger line, which is the durable public record.
- `test_grant` takes coins from the treasury, so nothing is minted. No production log holds one.
- Players see "coins", never "token".

## Residents: names, merges, retired joins

- `join` checks only a name's length, because logged joins hold older names; the protocol's `ResidentName` and the server's `createResident` hold every new name to `NAME_PATTERN`.
- `merge_resident` refuses, changing nothing, while anything `from` shares with others still runs, and moves or drops each kind of per-resident state. A new kind of per-resident state decides in `merge.ts` whether it moves, drops, or refuses, and `retireProblems` in `repeat-joins.ts` whether it makes a record "used". `src/fixtures/merge-log.ts` and `repeat-joins-log.ts` pin them.
- `retireProblems` compares names with ASCII letters folded, never the server's `nameKey`, whose Unicode tables come from the runtime.

## Items

- Nothing about items runs until `open_items`; `src/fixtures/items-log.ts` pins a log on top of the post-economy one.
- Growth reads only `state.day` (`plantedDay`, `readyDay`), so `new_day` changes nothing about crops and a skipped day counts like any other.
- The first pantry gives `STARTER_SEEDS` and every pantry tops up `PANTRY_STAPLES`, both frozen, so a new seed or staple never changes what an old pantry gave. `catalog.test.ts` pins them. Read the pantry's numbers through `pantryNumbers(state)`.
- Every unit counts toward `inventoryMax`. A made thing keeps its id, maker, and made day wherever it goes. Inventories are private: an `inventory` event belongs to its `residentId`; `planted`, `harvested`, `gathered`, and `item_given` (no count, no note) are public.
- Anything that goes back to a resident whose things are full is held aside (`items.heldAside`) and returned in `prepare()`'s commit with their first input that leaves room. Nothing goes past `inventoryMax`.
- A planter with a crop, a pedestal or frame with something on it, and a kiln with a pot can't be removed.
- Gifts can be sent back once `open_gifts` is logged ([decision 0057](../../docs/knowledge/decisions/0057-a-gift-can-carry-a-thing-and-its-recipient-can-send-it-back-.md)).

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
- Every piece of furniture blocks walking but `WALKED_ONTO_SEATS`, and only stairs, a door, and those seats are let through by `blocksWalkers`. The chair and the bench stay solid, since making them walkable would change logged walks.
- `build` refuses all of a plan it gets wrong, and skips and reports what moved. Its events are the single actions' own plus one `inventory` with the net change. `src/fixtures/build-log.ts` pins it.
- A Town Hall `commons_build` uses nobody's things and, once `keep_table_spots` is logged, puts no block on a game table's spot ([decision 0126](../../docs/knowledge/decisions/0126-town-hall-builds-keep-the-game-tables-spots-clear-from-a-log.md)). `commons-log.ts` and `table-spots-log.ts` pin it.
- A door is ground floor only and holds nothing up. A lock, if one comes, never counts against a plot's way out. `src/fixtures/doors-log.ts` pins `starter_doors`.

## Floors (RFC 0028)

- A `floor` is a level of a home, always a number; flooring is a ground kind laid on a tile. The two words never stand for each other ([decision 0252](../../docs/knowledge/decisions/0252-a-home-s-levels-are-floors-in-the-api-and-an-upstairs-in-wha.md)).
- The ground floor is floor 0 in `state.blocks` and `state.ground`. A reader that means any floor goes through `blocksOn`, `groundOn`, and `solidAt`; nothing else reaches into `state.floors`. A floor from an input becomes a key only after `floorOf` checks it.
- `FLOORS.max` may go up, never down. `FLOORS.price` changes only behind a logged switch ([decision 0242](../../docs/knowledge/decisions/0242-a-storey-costs-200-coins-the-economy-run-with-builders-says-.md)).
- Stations whose state is keyed by tile alone (planters, kitchens, workbenches, pedestals, frames, ponds, candy bowls, kilns, doors) stay on the ground floor. Hearths, crops, displays, gathering, fishing, and knocking are ground floor only.
- The climb hints are a contract: `floors.test.ts` walks the whole way up by parsing them, so a reword that drops a call fails it.
- A `build` plan's order is fixed (removals from the top floor down, then the ground floor, then each floor up), and each tile is checked against the plan's running view. The protocol's `PLAN_MAX` is `planMax`. `src/fixtures/floors-log.ts` pins it.
- The client builds its walking ground and climbs from its mirror with the same pure functions (`groundOf`, `upstairsGroundOf`, `climbsAt`, `upstairsProblem`).

## Resting (RFC 0044)

- Resting is where you stand, never a field: someone on a seat's tile is resting, and any move takes them off ([decision 0350](../../docs/knowledge/decisions/0350-homes-get-more-room-from-seats-you-walk-onto-not-a-bigger-st.md)). `rest` pays nothing. `src/fixtures/cozy-log.ts` and `rest.test.ts` pin it.

## Roofs (RFC 0041)

- A roof is one `roof` field on the plot, never on tiles. What it covers is read from the walls each time it's drawn (`roofShape`), so taking a wall down never has to be checked against a roof. Every view draws from `roofShape`, so all of them agree tile for tile.
- Its covering costs `blockNeeds(material)` times `ROOFS.blocks`, taken when it goes up and given back when it changes or comes down. `roof_set`, `roof_changed`, and `roof_top_set` are distinct so readers can count roofs. `src/fixtures/roof-log.ts` and `roofs.test.ts` pin it.

## Displays and plot names

- A displayed thing stays its displayer's. A find on display is never admired, reported, or in a gallery; the made-thing helpers leave finds out.
- A plot name changes once a world day, with two free renames; `null` clears it any time and keeps `namedDay`, so a clear or a takedown never makes room for another name that day. `plot-names-log.ts` and `free-renames-log.ts` pin it.
- A pet's, plot's, circle's, or invite's text is resident text: the sim checks its length; the server cleans and filters it before it's logged, and events carrying it go out marked `untrusted`.

## The market

- Nothing about the market runs until `open_market`; `src/fixtures/market-log.ts` pins it.
- A listed lot is in escrow in `market.listings`. A sale pays the seller the price less `marketFee(price)`, which goes to the treasury in a line that names nobody. `listing_sold` never names the buyer.
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

- A round is sealed: no event carries a choice before `close_round`, and the order choices came in never matters. The server stamps times and decides when a round closes ([decision 0095](../../docs/knowledge/decisions/0095-party-games-are-sealed-rounds-the-server-stamps-closes-and-l.md)).
- The table's `secret` is in the hashed world and its key must sort after `sealed`, since FNV-1a can be run backwards over known bytes. `games.test.ts` checks the order.
- Ratings are whole-number Elo ([decision 0096](../../docs/knowledge/decisions/0096-game-ratings-are-whole-number-elo-kept-in-the-sim-between-se.md)); who's rated is fixed at `start_game` and leaves out households and residents who couldn't vote. `src/fixtures/games-log.ts` pins it.

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
- `hand_in` takes only a made good its resident made (or a record merged into them made): a jar passed around a household finishes one job, its maker's ([decision 0260](../../docs/knowledge/decisions/0260-jobs-reach-the-api-behind-an-option-no-adapter-sets-with-fiv.md)).
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
3. Decor, furniture and made materials are blocks too: their id goes on the end of `BLOCK_KINDS` in `types.ts`, with a color in `BLOCK_COLORS` and their 3D and plot photo pictures.

The tests that run over every entry cover the rest: ids, families, names, looks, seeds and crops that pair up, recipes from things that stack, a jam for every fruit, and a picture for every kind ([decision 0085](../../docs/knowledge/decisions/0085-furniture-keeps-its-own-role-in-decor-furniture-and-pomegran.md), [decision 0308](../../docs/knowledge/decisions/0308-a-basket-of-fourteen-crops-sold-all-year-with-ten-recipes-an.md)). A new kind never joins a frozen list or what the town buys by being added: those are their own decisions. A new find lies nowhere until a new spawn table starts at a logged switch. A new family recipe, template, role, or family needs a decision record.

## Adding a command

1. Add it to `Command` in `types.ts`, plus any new `WorldEvent` and `RejectionCode`.
2. Implement the case in `check()` in `apply.ts`: validate everything and return a rejection, or return a closure that mutates and returns events. Do all reads in the check, not in the closure.
3. Test accept and every rejection path, plus a replay check if it touches new state. A command that checks reach goes in `reach.test.ts`'s table; one that changes a plot goes in `plot-market.test.ts`'s; one that takes an id goes through `own.test.ts`.
4. Expose it in `packages/protocol/` (schema and `SKILL.md`, then `pnpm gen`) and render its events in `packages/client/src/mirror.ts`.

## Writing tests

A rule is tested here, at the lowest layer that catches its failure (the root [definition of done](../../AGENTS.md#definition-of-done)): a command through `apply`, with the world's hash checked after a refusal, and a pure function like `biomeAt` or `seasonOf` directly. Before you add a test, answer four questions, and leave it out while one has no answer:

1. What behavior does it protect: a rule, a refusal, a number, or a replay?
2. What change to the sim would make it fail?
3. Why doesn't a test already here catch that? A catalog fact belongs in `catalog.test.ts`, and a field a pinned hash covers needs no check of its own. Add a case to an existing test before writing a near-copy.
4. Does it need an export, flag, or hook that only tests use? Then test through `apply` instead.

Every fixture hash pin and replay test stays. A test in front of a guard (a cap, a limit, an owners-only rule) must fail when the guard is removed: remove it once and watch the test go red before you commit. A loop over thousands of cases collects what's wrong and checks the list once, instead of an `expect` each time.
