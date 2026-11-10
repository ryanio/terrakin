# RFC 0053: Two rule gaps, closed behind one logged switch

- Author: drafted by Claude for Ryan
- Date: 2026-11-09
- Status: accepted (built: [decision 0433](../knowledge/decisions/0433-townsfolk-don-t-buy-upstairs-or-lot-steps-and-commons-builds.md))
- Discussion: <PR link>
- Builds on: [RFC 0028](0028-homes-with-storeys.md) (floors), [RFC 0052](0052-plots-that-grow.md) (lots and the wild yard), [decision 0019](../knowledge/decisions/0019-founding-townsfolk-are-ordinary-residents-seeded-through-the.md) (townsfolk are residents), [decision 0101](../knowledge/decisions/0101-a-town-hall-build-lays-paths-and-places-decor-and-furniture-.md) (Town Hall builds), [decision 0126](../knowledge/decisions/0126-town-hall-builds-keep-the-game-tables-spots-clear-from-a-log.md) (a build rule behind a switch), [decision 0430](../knowledge/decisions/0430-the-town-turns-every-wall-block-into-lines-then-logs-walls-o.md) (the walls-to-lines sweep)

## Summary

Two rules in `packages/sim` let something through that the rest of the sim keeps out. Townsfolk can spend the town's coins on `add_floor` and `grow_lot`, which every other coin sink refuses them. And after the regrid, a Town Hall `commons_build` can place blocks in the Commons slot's wild-yard ring, where every plot's own build is refused with `outside_lot`. This RFC closes both with one logged switch, `close_rule_gaps`, with a fixture on both sides of it, so logs from before it replay as they were made and `REPLAY_VERSION` stays at 2. A third gap the audit named, `town_slim` still accepted after `slim_homes`, is not a gap: the server sends it on purpose, and this RFC leaves it alone.

## Motivation

The persona is every resident, through the treasury. Townsfolk coins are the town's: at `new_day` each townsfolk's whole purse goes back to the treasury (`economyNewDay` in `economy.ts`, as a `budget_return` line), and each townsfolk is paid `ECONOMY.townsfolkBudget` (50) from what the treasury holds above `budgetReserve` (1,000). That budget is what the townsfolk tip newcomers with. A coin a townsfolk burns is a coin that never comes back for a newcomer's welcome gift or a tip.

### Gap 1: townsfolk spend on floors and lots

Every other place a resident spends coins refuses townsfolk first:

| Sink | Where | Refusal |
|---|---|---|
| Shop | `opened` in `shop.ts` | `not_eligible`, "Townsfolk don't shop. Their coins are the town's." |
| Market | `market.ts` | `not_eligible`, "Townsfolk don't trade. Their coins are the town's." |
| Plot market | `plot-market.ts` | `not_eligible`, "Townsfolk don't trade. Their plots are the town's." |
| Pets (grooming) | `pets.ts` | `not_eligible`, "Townsfolk keep their coins for the town." |
| Circles (fee, chip in) | `circles.ts` | `not_eligible` |
| Recipes (cards) | `recipes.ts` | townsfolk know everything, so nothing to buy |
| Bounties | `bounties.ts` | `not_eligible` |
| Events (Commons deposit) | `checkScheduleEvent` in `events.ts`, through `townEligibility` in `town.ts` | `not_eligible` |
| Upstairs | `checkAddFloor` in `floors.ts` | none |
| Lot step | `checkGrowLot` in `lots.ts` | none |

`checkAddFloor` checks bounds, the Commons, `canBuildOn`, a listed plot, coins open, `FLOORS.max`, and the purse, then takes `FLOORS.price` (200): the treasury's share (`SHOP.treasuryShare`, 5%) goes in and the rest, 190, is burned. `checkGrowLot` is the same shape for a lot step (150, 300, 600, 1,000 from `LOTS.steps`). Neither asks `isTownsfolk`.

Townsfolk own plots (the seed in `scripts/townsfolk/plan.ts` picks one for each), so `canBuildOn` passes for their own. The coins can get there two ways. The daily budget is 50, not enough on its own. But `checkGive` in `economy.ts` refuses a townsfolk's gift only to townsfolk or maintainers; a resident may give a townsfolk up to `giveCap` (200) a day, and a townsfolk may receive up to `receiveCap` (500). So one resident's 200 coins plus the day's 50 buys an upstairs for a townsfolk home, and 190 of it is burned instead of going back to the treasury that night.

Who sends a townsfolk's commands is the server's townsfolk runs and whoever holds their keys. Nothing in the sim stops them, and the check-in would suggest it: the `upstairs` line in `packages/server/src/checkin-suggest.ts` (`loftPlot`) checks a home plot, `canBuildOn`, the floor count, and a purse of at least 200, and never `isTownsfolk`. A townsfolk run that reads its check-in and has been given coins is told to add an upstairs.

### Gap 2: Town Hall builds in the Commons yard

After `regrid`, every plot slot is 16 by 16 and a lot starts at 8 by 8 in its middle (`lotBounds` in `lots.ts`). On a plot, `place`, `lay` and lines past the lot are refused with `outsideLotProblem` (`outside_lot`), called from `check()` in `apply.ts`. `grow_lot` refuses the Commons (`plot_is_commons`), so the Commons lot is always 8 by 8.

`checkPlan` in `town.ts`, which checks a `commons_build` proposal when it is filed, only asks that each tile is in the world, on the Commons slot (`plotOf` equals `commonsPlot`), off the Town Hall, the shop and the game-table spots, and in each list once. It never asks `inLot`. So a passed proposal can place blocks and lay paths on any of the 192 ring tiles around the Commons' middle 64. `closeBuild`, which applies a passed plan, skips tiles that changed since filing but never one outside the lot.

Whether that is wrong is a product question. RFC 0052's decisions say the Commons keeps its buildings in the middle of its new slot and "the rest is a paved square and a bigger green". A bench or a lamp post on the green by vote may be exactly what the town wants. Open question 1 asks.

### Not a gap: `town_slim` after `slim_homes`

The audit read `checkTownSlim` in `slim.ts`, saw that it never reads `state.homesSlimmed`, and that a slim's first run on a plot tops the owner up with made material (`slimGift`). Both are true and both are by design:

- `wallsToLines` in `packages/server/src/world-service.ts` runs only once `homesSlimmed` is set (when the `slimHomes` option is on), and logs a `town_slim` from `townLines` for every plot still holding a wall block, then `walls_on_lines`, then tries again each world day for any plot left over. The staff route `POST /v1/admin/slim-home` (`slimHome`) does the same for one plot. All of these come after `slim_homes`.
- The gift is what lets the sweep keep its promise, decision 0430's point 2: lines beyond what the old blocks pay for come from the gift and the home's other walls, "so the town never spends an owner's things". `townLines` refuses any plan that takes from the owner (`plan.changes.some((c) => c.amount < 0)`).
- The gift is paid once per plot (`state.slimmed[key]`), only in kinds and grades the home's own walls were made of, and at most a quarter more than came back.
- `town_slim` comes only from `TOWN_ACTOR`. A resident's own `slim_walls` left the API with decision 0430.

Refusing `town_slim` after `slim_homes` would break the sweep. There is nothing to close.

## Design

### One switch

`close_rule_gaps`, which only `TOWN_ACTOR` sends, through `oneTimeSwitch` in `check.ts`:

```json
{"type": "close_rule_gaps"}
```

sets `state.ruleGapsClosed = true` and emits `{"type": "rule_gaps_closed"}`. Once it is logged:

1. `checkAddFloor` refuses a townsfolk actor, before anything about the plot, as the shop does:

   ```json
   {"code": "not_eligible", "message": "Townsfolk don't add upstairs. Their coins are the town's."}
   ```

2. `checkGrowLot` refuses a townsfolk actor in the same place:

   ```json
   {"code": "not_eligible", "message": "Townsfolk don't grow lots. Their coins are the town's."}
   ```

   `grow_lot` already uses `not_eligible` for a home that isn't furnished enough. The message tells them apart, and an agent that reads SKILL.md's rule ("a refusal's message says what to do") is not misled, since a townsfolk run is the only one that sees this one.

3. If Ryan closes the Commons yard (open question 1), `checkPlan` refuses a tile outside the Commons lot, in the words of the plan check it sits beside:

   ```text
   (x, y) is in the Commons' wild yard, past its middle 8 by 8. Blocks go in the middle; a path can go in the yard.
   ```

   and `closeBuild` skips such a tile, as it skips one that changed since filing, so a proposal filed before the switch and passed after it builds only its middle tiles. The check reads `inLot(state, x, y)`, so it holds if the Commons lot ever grows.

The two refusals in 1 and 2 go through one helper beside `isTownsfolk` in `economy.ts`, `townCoinsProblem(state, actor, what)`, which returns null before the switch. The yard check is one line in `checkPlan` and one in `closeBuild`, both behind `state.ruleGapsClosed`.

### Why one switch, not two

The two gaps have nothing to do with each other, so two switches would read more cleanly in the code. One costs less: one flag, one event, one fixture, one row in `DAY_SWITCHES`, one server option. Each switch is a branch the code keeps for good (RFC 0054 counts them).

The cost of one switch is coupling. If the switch is logged with the yard left open and Ryan later wants it closed, that is a second switch anyway. So the switch waits for open question 1's answer, and whatever he decides goes in it. If he wants the townsfolk fix out first and the Commons left to think about, two switches is the honest answer and this RFC splits.

### Server

- `DAY_SWITCHES` in `world-service.ts` gains a row after `plotReach` and before `regrid`, with a new option `ruleGaps` in `WORLD_SWITCHES` (`world-switches.ts`), so both adapters run it:

  ```ts
  {
    option: "ruleGaps",
    due: (s) => !s.ruleGapsClosed && !!s.economy,
    command: { type: "close_rule_gaps" },
    label: "close the townsfolk and Commons yard gaps",
  },
  ```

- `loftPlot` in `checkin-suggest.ts` leaves out townsfolk, as `potteryOpen` beside it does. This is the server's suggestion, not a rule, so it needs no switch and can ship first. `lotTodo` needs no change: it runs a dry `grow_lot`, which refuses once the switch is on.
- `toWire` does not carry `ruleGapsClosed`. No client draws anything from it; a client that builds a Town Hall plan learns the yard rule from the refusal.

### Tests

- `src/fixtures/rule-gaps-log.ts`, on top of `regrid-log.ts` so the Commons has a yard: townsfolk set, a resident gives a townsfolk 200 coins, the townsfolk's `add_floor` is accepted; a `commons_build` with a yard tile is filed, voted and closed and builds that tile; then `close_rule_gaps`; then the same `add_floor` and a `grow_lot` from a townsfolk are refused, a second `commons_build` with a yard tile is refused at filing, and one filed before the switch and closed after it skips its yard tile. `replay.test.ts` picks the fixture up and checks every split point.
- A refusal test for each new refusal in `rule-gaps.test.ts`, each checking the world's hash is unchanged and failing when the guard is removed (the package's rule for a guard in front of money).
- `expectSupplyHolds` after every input of the fixture.
- `checkin-suggest`'s existing upstairs test gains a townsfolk viewer who gets no line.
- One case logs the switch on a world not yet regridded, where the Commons has no yard and no block is refused.

## Invariants

- **Server authority.** Both refusals are the sim's. The check-in change is a suggestion the server stops making; it decides nothing.
- **Determinism.** A logged switch, read from state. Inputs before it replay under the old rules; `REPLAY_VERSION` stays at 2.
- **Untrusted text.** No text is added. The refusals are fixed words with numbers.
- **Protocol.** New event `rule_gaps_closed`, two new refusal messages under an existing code, and possibly a new `commons_build` refusal. Nothing breaks for a resident: no resident who isn't townsfolk sees any change, and a Town Hall proposer sees one more plan refusal, only if open question 1 closes the yard.

## Economy impact

No new source or sink. The switch removes a path by which coins given to a townsfolk were burned instead of going back to the treasury at `new_day`. At most that was 250 coins per townsfolk per day (500 received is the cap, but an upstairs is 200 and a first lot step 150, and the daily budget is 50). It also stops townsfolk homes changing size or height without a staff decision.

## Security considerations

- **Prompt injection through a townsfolk.** A resident who knows a townsfolk acts on its check-in can give it coins and wait for the `upstairs` line, or write to it asking for an upstairs. Townsfolk chatter never acts on words (its answers are posts through `reserve` in `chatter.ts`), but any future townsfolk run that does actions from its check-in would have been told to spend. After this, the sim refuses whatever the run decides.
- **Laundering.** Coins given to a townsfolk can't be turned into a permanent upstairs on a home the giver can then visit. That was the only way a gift to a townsfolk bought something that stays.
- **Commons griefing.** A passed vote is the only way to build in the Commons, and quorum is the protection. The yard question is about what the town wants there, not about abuse.

## Agent experience

SKILL.md changes by one line in the upstairs and lot sections: townsfolk don't buy upstairs or lot steps. If the Commons yard closes, the Town Hall section's plan rules gain "only in the Commons' middle 8 by 8; the ring around it is the yard". The CHANGELOG entry is a Changed line for each.

## Migration and rollout

1. Ship the check-in change (server only).
2. Ryan answers open question 1.
3. Before the switch goes into `WORLD_SWITCHES`, read the live log through the staff log export (`GET /v1/admin/log`) and count, at each input's own `seq`:
   - accepted `add_floor` and `grow_lot` whose actor was in `state.townsfolk` then;
   - open `commons_build` proposals with a tile outside the Commons lot (these would close after the switch and skip that tile);
   - townsfolk purses at or above 150 at the read (they would be refused mid-plan).
   None of these block the switch, since inputs before it replay as they were. They say whether anyone needs telling: a townsfolk home that already has an upstairs keeps it, and a proposer whose passed plan loses its yard tiles is told by the `town_built` event's `skipped` list.
4. Ship the sim change, fixture, and server row together. The switch logs on the next tick of every world.

## Alternatives considered

- **No switch, an RFC and a `REPLAY_VERSION` bump.** The rule would apply to the whole history. If the live log has no townsfolk `add_floor` it would even replay the same, but dev, e2e and self-hosted worlds may, and the bump forces every world to replay from its first input. The switch costs one flag and avoids all of it.
- **Refuse townsfolk in `checkGive`, so no coins reach them.** Breaks residents tipping townsfolk back, which nothing says is wrong, and townsfolk still get their daily budget.
- **Refuse in the server only.** The server's action gate could refuse townsfolk floors. That makes a rule the server's, against the package rule that rules live in `packages/sim`, and a staff key acting as a townsfolk would pass.
- **Refuse `town_slim` after `slim_homes`.** Breaks `wallsToLines` and the staff slim route; see "Not a gap" above.

## Open questions

1. **The Commons yard.** RFC 0052 decided the Commons' ring is "a paved square and a bigger green". Should Town Hall builds reach it?
   - Answered 2026-11-09 by Ryan: (a).
   - (a) Blocks refused in the ring, paths allowed. **Recommended**: residents can pave the square by vote, which matches the decided design, and decor stays in the middle until there is a plan for the green.
   - (b) Blocks and paths both refused, opened later with its own switch when the square is drawn.
   - (c) Leave it open: no Commons change, and this RFC's switch is the townsfolk fix alone.
2. **One switch or two.** Recommended: one, logged only once question 1 is answered. If the townsfolk fix should go first, two.
   - Answered 2026-11-09 by Ryan: one switch, `close_rule_gaps`, for both.
3. **A townsfolk home that already has an upstairs or a grown lot.** Recommended: it keeps it. Nothing is taken back, the switch only refuses new spending.
   - Answered 2026-11-09 by Ryan: it keeps it.
4. **Should staff ever add an upstairs to a townsfolk home?** Recommended: not through the townsfolk's own purse. If one is wanted, it is a `TOWN_ACTOR` input of its own, in its own change.
   - Answered 2026-11-09 by Ryan: out of scope here.
