# RFC 0054: A log checkpoint, so old switch branches can retire

- Author: drafted by Claude for Ryan
- Date: 2026-11-09
- Status: draft
- Discussion: <PR link>
- Builds on: [decision 0003](../knowledge/decisions/0003-deterministic-sim-with-input-log.md) (the input log), [RFC 0014](0014-world-snapshots.md) and [decision 0069](../knowledge/decisions/0069-the-world-boots-from-a-verified-snapshot-and-the-log-after-i.md) (snapshots), [decision 0070](../knowledge/decisions/0070-replay-version-marks-rule-changes-that-make-old-snapshots-un.md) (`REPLAY_VERSION`), [decision 0373](../knowledge/decisions/0373-every-node-world-opens-the-systems-terrakin-org-runs-recipes.md) (every world opens what terrakin.org runs)

## Summary

Every rule change for a live world goes behind a logged switch, so the sim keeps the old rule beside the new one forever. This RFC counts what that costs today, weighs three ways to let old branches go (keep the rule; a checkpoint of the live log with a frozen legacy replayer; a genesis with every switch on for new worlds only), and recommends **not now**. The branches are about 25 one-to-three-line reads spread over 23 switches, the snapshot boot already makes the log's length cheap, and both ways to retire branches give up the promise that the whole history replays to the same hash. The RFC names what would change that: a count of switch branches, a replay time, or a `REPLAY_VERSION` bump needed for some other reason.

## Motivation

The persona is the contributor, human or AI, reading `packages/sim`. Each switch leaves a branch: `if (state.x) new rule else old rule`. Each adds a fixture with inputs on both sides of it, and each adds a row in the server's switch tables. A reader has to know which branch the live world takes. The question is whether there is a safe way to delete the old branches once every world has passed them, and whether it is worth it now.

### What is there today

Switches come in two kinds. A system opener (`open_economy`, `open_items`, `open_shop`, `open_market`, `open_bounties`, `open_recipes`, `open_levels`, `open_jobs`, `open_circles`, `open_clay`, `open_grades`, `open_plot_market`, `open_land`) turns on something that wasn't there. Its "off" branch is "this system doesn't exist", which every world needs before it opens, and which a checkpoint would not remove. This RFC is about the other kind, a behavior switch, which changes a rule that already ran.

The behavior switches, read from `oneTimeSwitch` callers in `packages/sim/src`, the `*?: true` flags in `WorldState` (`types.ts`), and the server's `DAY_SWITCHES`, `PRESENCE_SWITCH` and `RETIRE_SWITCH` in `packages/server/src/world-service.ts`, with the places a rule reads each flag (setters and comments left out):

| Switch | Flag | Rule reads | Where |
|---|---|---:|---|
| `solid_buildings` | `solidBuildings` | 2, plus 3 that carry it into walk facts | `walk.ts` (`stepFrom` facts), `shop.ts`; facts in `design.ts`, `openings.ts`, `walk.ts` |
| `keep_table_spots` | `tableSpotsKept` | 1 | `tableSpots` in `town.ts` |
| `starter_doors` | `starterDoors` | 1 | `build_starter_home` in `apply.ts` |
| `starter_edges` | `starterEdges` | 3 | `build_starter_home` in `apply.ts` |
| `plot_reach` | `plotReach` | 2 | `plotReachOk` in `plot-building.ts`, `apply.ts` |
| `walls_on_lines` | `wallsOnLines` | 1 | `wallOnTileProblem` in `plot-building.ts` |
| `slim_homes` | `homesSlimmed` | 0 in the sim; the server reads it | `slimEveryHome`, `wallsToLines` |
| `regrid` | `regridded`, `config.plotSize` | 1 flag read; the grid size is read everywhere through `insetOf` and `baseTile` in `grid.ts` | `regrid.ts`, `grid.ts` |
| `own_plot_pickups` | `items.plotPickupsOwned` | 1 | `mayGatherAt` in `gather.ts` |
| `open_way_pickups` | `items.wayPickups` | 1 | `gather.ts` |
| `raise_inventory` | `items.inventoryRaised` | 1 | `inventoryMaxOf` in `items.ts` |
| `lower_holiday_prices` | `shop.holidayPricesLowered` | 1, plus the frozen `HOLIDAY_PRICES_BEFORE` table | `priceOf` in `shop.ts` |
| `shop_in_person` | `shop.inPerson` | 1 | `opened` in `shop.ts` |
| `propose_in_person` | `proposeInPerson` | 1 | `town.ts` |
| `schedule_in_person` | `scheduleInPerson` | 1 | `checkScheduleEvent` in `events.ts` |
| `attend_at_ten` | `attendAtTen` | 2 | `events.ts` |
| `name_sales` | `namedSales` | 1 | `soldWhat` in `shop.ts` |
| `implicit_presence` | `implicitPresence` | 1 | `prepare` path in `apply.ts` |
| `retire_repeat_joins` | `retiredRepeatJoins` | 1, and it is data (the retired ids), not a rule | `isRetired` in `repeat-joins.ts` |
| `set_shop_share` | `shop.treasuryShare` | a number, not a branch | `treasuryShareOf` |
| `set_job_edition` | `jobs.edition` | editions 1 and 2 of `JOB_EDITIONS` (both `FIRST_TABLE`) | `jobs.ts` |
| `set_page_edition` | page edition | the earlier `PAGE_EDITIONS` | `recipes.ts` |
| `open_clay` with `water` | `items.clayByWater` | 1 (`clayRule`'s first rule) | `pottery.ts` |

That is 23 behavior switches and about 25 branch points, almost all one to three lines. `renamed.ts` (101 lines: old command names, `storey`, `kindred`, a title id) is the same kind of legacy: it exists only so old logs replay.

### What the log costs

RFC 0014 measured 1.2 to 2.4 microseconds of replay per input, and the snapshot boot (decision 0069) replays only the inputs since the newest verified snapshot, about a day's worth. The full log is replayed once a week in the minute sweep, 25,000 inputs a minute (`VERIFY_SLICE` in `packages/server/src/snapshots.ts`), so a log of 10 million inputs verifies in about 400 minutes of sweeps. The log's length does not slow a boot today.

## Design

Three options, each with what it costs and what it buys.

### Option 1: keep the rule (do nothing)

Every switch stays, every fixture stays, every branch stays.

- Cost: about 25 branch points today, and each new behavior switch adds one to three more, one fixture, and one server row. Reading a rule means knowing which branch the live world takes.
- Gain: the whole history keeps replaying to the same hash, from the first input, in every world. The weekly full replay keeps catching a rule change that would replay old inputs differently, which is the one guard a snapshot boot no longer gives (decision 0070).

### Option 2: a checkpoint of the live log, with a frozen legacy replayer

At a chosen `seq` S, terrakin.org's verified snapshot becomes the world's *checkpoint*: the boot and the weekly verify start from it instead of from `createWorld` and the first input. The log before S is archived as it is. The sim as of the commit before any branch is deleted is kept as a tag (`sim-legacy-v2`) or a package (`@terrakin/sim-legacy`), and a script replays the archive with it and checks that it reaches the checkpoint's hash and SHA-256. Then the current sim drops every off branch, `renamed.ts`, `HOLIDAY_PRICES_BEFORE`, job editions 1 and 2, the old page editions and the first clay rule.

For that deletion to be safe, no world may ever again take an input under an off branch. That is not true today: `createWorld` in `world.ts` starts with every switch off, and every dev, e2e, self-hosted and test world reaches the on state only by logging the switches on its first ticks, with resident inputs possible in between (jobs wait for levels, levels wait for the social layer). So option 2 needs option 3 as well.

- Cost:
  - `REPLAY_VERSION` goes to 3, because a log that holds an input under an off branch no longer replays.
  - Decisions 0003 and 0070 and the sim's invariant "an accepted log replays to the same hash forever" change to "from its checkpoint". The archive before S is verifiable only by the legacy replayer, which nothing exercises after the one check, and which has to keep building as the toolchain moves.
  - All 62 logs in `packages/sim/src/fixtures/` start from `createWorld` with switches off, and most of them exist to pin the off side or both sides of one switch. They would be rewritten on the new genesis or moved to the legacy package, and every pinned hash changes.
  - Every world other than terrakin.org needs its own checkpoint (each log differs) or a wipe. Dev and test worlds wipe; a self-hosted owner gets a command and a CHANGELOG line.
  - 13 of the flags are on the wire in `worldSnapshot` (`world-wire.ts`): `solidBuildings`, `tableSpotsKept`, `starterDoors`, `starterEdges`, `plotReach`, `wallsOnLines`, `regridded`, `homesSlimmed`, `shopInPerson`, `proposeInPerson`, `scheduleInPerson`, `attendAtTen`, `namedSales`. The client reads some of them to mirror the rules. Dropping them is a breaking protocol change (allowed pre-alpha, decision 0146), with client branches to delete too.
  - Some state written under old rules stays in the world whatever the code does: wall blocks the sweep couldn't convert yet (the rule that such a block "can only come down" stays while any exist), lines and purse entries from before `name_sales`, jobs held under an earlier edition. Code that reads that data stays.
  - The plot market is off everywhere, so its switch and its branches stay regardless, and so does `open_land`, which comes again for each land.
- Gain: about 25 short branches, `renamed.ts`, and four frozen tables, perhaps 200 to 300 lines in all, and a simpler table for a reader. Boot time gains nothing, since the boot already starts from a snapshot; the weekly verify gets shorter by the length of the archive.

### Option 3: a genesis with every switch on, for new worlds only

`createWorld` takes an option (or a second function, `createCurrentWorld`) that starts a world with every behavior flag already set, so a new dev, e2e, self-hosted or test world never logs the switches and never runs an off branch. terrakin.org's log is left alone.

- Cost: a second way to start a world, and a test that the genesis world equals a world that logged every switch (the same hash after the same inputs). Existing fixtures stay, since they start from the old `createWorld`.
- Gain: close to none on its own. terrakin.org's log still replays through every off branch, so none can be deleted. A new world skips about 35 switch inputs on its first ticks, which `WORLD_SWITCHES` already makes it log in one go. What it does buy is the precondition for option 2.

## Recommendation

**Option 1, not now.** The branches are many but small, each sits next to the rule it changes, and each has a fixture that says what it does. Options 2 and 3 together would delete perhaps 200 to 300 lines and would cost a `REPLAY_VERSION` bump, rewriting 62 fixtures, a protocol break on 13 wire flags, a checkpoint or a wipe for every other world, and the end of the full-history replay that is the project's strongest correctness check. Option 3 alone costs little but buys nothing to delete.

What would change this, any one of:

1. **A `REPLAY_VERSION` bump is needed anyway**, for a change that already makes every log replay differently (as the circles rename did for version 2). The fixture rewrite and every other world's replay are then paid once for both, and a checkpoint and genesis should ride along.
2. **More than 40 behavior switches with live branches**, or a single rule (a building check, say) that reads more than three of them, so the branches start to interact.
3. **The weekly full replay stops fitting**: the live log past about 10 million inputs (some 400 minutes of verify sweeps a week), or a full replay over 60 seconds on the Worker, or the log's storage past a tenth of the Durable Object's 10 GB of SQLite (at about 76 bytes an input, RFC 0014, that is 13 million inputs).

Until then, one cheap thing helps the reader: the table above, kept in `packages/sim/AGENTS.md` beside the switch rule (or generated by a test that lists every `oneTimeSwitch` caller), so the count is visible when a new switch is added.

## Invariants

- **Server authority** is untouched by every option.
- **Determinism.** Option 1 changes nothing. Option 2 narrows "replays to the same hash forever" to "from its checkpoint", with the archive checked once by a frozen replayer. Option 3 adds a second genesis that must hash the same as logging every switch.
- **Untrusted text** is untouched.
- **Protocol.** Option 2 breaks 13 wire flags (decision 0146 allows it pre-alpha); options 1 and 3 change nothing on the wire.

## Economy impact

None. A checkpoint carries purses, the treasury, `minted` and `burned` exactly; the boot's coin supply check in `snapshots.ts` would run on it like any snapshot.

## Security considerations

- **A bad checkpoint becomes the truth.** Today a snapshot is only a cache, used once a replay has reproduced it, and deleting every snapshot gives the same world. A checkpoint can't be rebuilt from the code that runs, so a mistake in it (a purse, a plot owner) is permanent unless the legacy replayer catches it. The check has to pass before the archive is retired, and the archive must never be deleted.
- **The legacy replayer is code nobody runs.** It reads the old log, which holds residents' words, so it runs where the staff log export (`logPage`) is allowed, for maintainers only, never in CI with the log checked in.
- Options 1 and 3 add no new trust.

## Agent experience

Nothing for option 1 or 3. For option 2, SKILL.md and the CHANGELOG lose the wire flags, and a self-hosted owner's guide in `docs/deploy.md` gains the checkpoint command.

## Migration and rollout

Option 1: none. If Ryan takes the recommendation, the only change is the switch table in `packages/sim/AGENTS.md`.

If a trigger above fires, the order is: option 3 first (genesis with every switch on, proven equal to logging them), ship it and let every new world start on it; then option 2 on terrakin.org at a quiet hour, with the legacy check passed on a copy of the live log before the archive is cut; then delete branches one switch at a time, each its own commit with its fixture removed.

## Alternatives considered

- **Delete a branch once no live log takes it, without a checkpoint.** If no input in terrakin.org's log ever reached the off branch of, say, `attend_at_ten` (no event before the switch), the branch could go with no replay change there. But every other world's log may hold one, and fixtures pin both sides on purpose. It trades a known check for a guess about logs we can't read.
- **Squash the old switches into one.** A single `modern_rules` switch that turns on every behavior at once would not remove a branch; it would add one.
- **Move the legacy branches to a separate module.** Readers would see less in each rule, but nothing is deleted and the module is read on every replay. It's a refactor that could be done now, without an RFC, if a rule's reader finds the branches in the way.

## Open questions

1. Take the recommendation (option 1, not now) and the triggers above? **Recommended: yes.**
2. Keep the switch table in `packages/sim/AGENTS.md`, or as a test that lists every `oneTimeSwitch` caller and fails when one is missing from it? **Recommended: the table**, since a test that restates a list protects nothing (the root definition of done).
3. If a `REPLAY_VERSION` bump comes for another reason, fold the checkpoint and genesis into it by default? **Recommended: yes**, with its own RFC section at the time.
