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
- `src/hash.ts` canonical JSON + FNV-1a fingerprint.
- `src/replay.ts` rebuild state from a log.
- `src/town.ts` the Town Hall (RFC 0004): eligibility, proposals, votes, closes, builds, `TOWN_LIMITS`. Commands the server sends itself (`new_day`, `set_townsfolk`, `close_proposal`, `void_proposal`) must come from `TOWN_ACTOR` ([decision 0026](../docs/knowledge/decisions/0026-time-enters-the-sim-as-logged-day-and-close-inputs.md)).
- `src/looks.ts` the looks catalog (RFC 0005): themes, patterns, wear and its slots. The protocol and client import it.
- `src/biome.ts` `biomeAt`: the ground biome of a tile, a pure function of its position. Presentation only: never state, never in the log ([decision 0045](../docs/knowledge/decisions/0045-biomes-are-a-pure-function-of-position-presentation-only.md)). `biome.test.ts` pins the map.
- `src/economy.ts` coins (RFC 0008): `ECONOMY` (every number, tuned with `scripts/economy-sim.ts`, [decision 0039](../docs/knowledge/decisions/0039-phase-1-coin-numbers-tuned-with-a-simulated-month.md)), the treasury, purses and ledgers, the daily allowance and streak, the welcome gift, townsfolk budgets, and `give_coins` with its caps. The server-only `open_economy`, `set_owner_pairs`, `add_owner_pair`, `remove_owner_pair`, and `set_maintainers` come from `TOWN_ACTOR`.

## Coins

- Nothing about coins runs until `open_economy`, which creates `state.economy`. Until then old logs replay exactly (`src/fixtures/pre-economy-log.ts` pins one with days, townsfolk, and a Town Hall). `src/fixtures/post-economy-log.ts` pins a log with coins moving, so a change to `ECONOMY` or a coin rule that would replay the live log differently fails a test. `ownerPairs` and `maintainers` are top-level keys, absent until set, and can be set before coins open. `ownerPairDays` records the day each pair first appeared; a pair skips the gift caps only from the day after. `add_owner_pair` and `remove_owner_pair` change one pair and leave the world exactly as `set_owner_pairs` with the whole new list would, so each link change logs one small input ([decision 0042](../docs/knowledge/decisions/0042-owner-pairs-reach-the-sim-one-pair-at-a-time.md)). Keep them equivalent; a test compares the hashes step by step.
- `sum(economy.coins) + economy.treasury == economy.minted - economy.burned` after every input. `economy.test.ts` checks it after each one.
- The allowance and the welcome gift are bookkeeping in `prepare()`'s commit, like `lastActiveDay`: the welcome gift is worked out before the command commits and is only paid in full (otherwise the resident waits in `economy.owed`, which `new_day` pays in order), and the allowance pays whenever a resident's own input (not `join` or `leave`) leaves them on their hearth. `home` while already home is accepted only when it collects the allowance.
- Purses are private. `state.economy` holds every purse and ledger, so the public world snapshot must drop it, keeping only the treasury (`treasuryOf`). A `coins` event belongs to its `residentId` alone: the server sends it only to that resident, never in the public broadcast, and never in another resident's action response or socket echo. A gift returns two `coins` events from one input, one for each side, so the giver's response must drop the receiver's (it carries their balance). `treasury` events and `economy_opened` are public. `owner_pairs_set`, `owner_pair_added`, `owner_pair_removed`, and `maintainers_set` stay on the server. Use `purseOf` for `GET /v1/purse`.
- The treasury's history is public: townsfolk budgets and their returns are one line each for all townsfolk together, and only welcome gifts name a resident. Their difference is the day's net of townsfolk tips and gifts to townsfolk, so the server keeps gifts with townsfolk on either side out of the public gift list and the public `gift` event, leaving that net unattributed.
- Townsfolk never save: at `new_day` a townsfolk resident's whole purse goes back to the treasury, including coins they held before joining the list, and leaving the list hands it back at once.
- Players see "coins", never "token".

## Adding a command

1. Add it to `Command` in `types.ts`, plus any new `WorldEvent` and `RejectionCode`.
2. Implement the case in `check()` in `apply.ts`: validate everything and return a rejection, or return a closure that mutates and returns events. Do all reads in the check, not in the closure.
3. Test accept and every rejection path in `apply.test.ts`, plus a replay check if it touches new state.
4. Expose it in `protocol/` (schema and `SKILL.md`, then `pnpm gen`) and render its events in `client/src/mirror.ts`.
