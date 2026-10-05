---
title: Phase 1 coin numbers, tuned with a simulated month
date: 2026-10-04
status: accepted
tags: [sim, economy, numbers]
---

# Phase 1 coin numbers, tuned with a simulated month

## Context

[RFC 0008](../../rfcs/0008-coins-karma-and-the-market.md) gives starting numbers for coins and leaves them as an open question until a simulation checks them. Phase 1 has faucets only (the allowance, the welcome gift, the treasury's daily mint) and no sinks: the town shop and market fees arrive in later phases. So the supply can only grow, and the question is how fast, and whether the treasury can keep paying what it promises.

`scripts/economy-sim.ts` plays 30 days of 300 residents arriving over the month (more at the start), plus the 8 townsfolk. A third are regulars who come home nearly every day, a third visit every few days, a quarter drift away, and the rest come once. 85% settle. Some residents tip each other, 20 owner-linked pairs pass coins between them, and the townsfolk scripts give each newcomer 10 and hand out about 80% of their budgets as small tips. Every step is an input to the sim's own `apply`, the numbers are `ECONOMY` in `sim/src/economy.ts`, and the PRNG is seeded, so a run repeats and can't drift from the rules.

With the RFC's starting numbers (treasury mint 500, townsfolk budgets 100 each), the treasury runs dry in under two weeks. Welcome gifts for about 9 settlers a day cost 450, and eight townsfolk budgets of 100 cost up to 800 more, against 500 minted. Budgets of 100 also make the townsfolk a faucet half the size of the allowance for the typical active resident.

## Decision

| Number | Value | RFC start |
|--------|-------|-----------|
| Daily allowance | 10 | 10 |
| Streak bonus | +5 a day from the 7th day in a row | same |
| Welcome gift | 50, from the treasury | same |
| Treasury opening balance | 5,000, minted by `open_economy` | none |
| Treasury mint | 700 a day | 500 |
| Townsfolk budget | 50 each a day | 100 |
| Budget reserve | Budgets come only from what the treasury holds above 1,000 | none |
| Townsfolk to one resident | at most 25 a day, all townsfolk together | 25 |
| Gift caps | 200 given, 500 received a day | same |

What the script prints for the default run (seed 1, 30 days, 300 residents):

| Day | Active | Supply | Treasury | Per active resident | Minted that day |
|-----|--------|--------|----------|---------------------|-----------------|
| 0 | 25 | 5,210 | 3,950 | 50 | 210 |
| 7 | 59 | 12,975 | 2,580 | 175 | 1,250 |
| 14 | 77 | 22,760 | 2,640 | 260 | 1,520 |
| 21 | 110 | 34,645 | 2,350 | 293 | 1,855 |
| 29 | 125 | 49,875 | 2,690 | 377 | 2,040 |

In the last week the town paid out 649 a day in welcome gifts and townsfolk tips against a mint of 700, and no welcome gift had to wait. Month-end purses of settled residents who arrived in the first week: regulars 422 (median), every-few-days visitors 173, drifters 130, one-day residents 70.

Why these values:

- The allowance stays at 10 with the streak at +5. A regular earns a lantern (40) about every three days and a straw hat (60) in under a week, and ends the month near 420 if they spend nothing. That is enough to buy something small most weeks and still save for a larger item, which is the cadence the shop wants. Supply per active resident grows by roughly 12 a day, in a straight line, because the faucets are per resident and capped. There is no compounding, so no runaway.
- Townsfolk budgets drop to 50. Eight budgets of 50 (400 a day) give an active resident about 3 coins a day in tips: a nice surprise, well under the allowance. Unspent budgets go back to the treasury, so this is a ceiling, not a cost.
- The mint rises to 700 so it roughly matches what the town pays out at this size: about 350 in welcome gifts and 300 in tips. The treasury holds near 2,500 all month instead of draining.
- A reserve of 1,000 puts newcomers first. When the treasury is low, townsfolk tips shrink before welcome gifts do, and gifts still owed are paid before any budget.
- The opening balance of 5,000 covers a launch-day rush of about 100 welcome gifts.

Rules settled while building it, because the numbers depend on them:

- The 25-coin townsfolk limit is per resident per day across all townsfolk together, so eight townsfolk can't give one person 200. It is exact: a townsfolk gift that would go over is refused. Only the team's townsfolk accounts can run into it, so there is no total to hide, and it keeps the treasury's daily cost per resident fixed. Townsfolk gifts also count toward the receiver's 500 cap.
- The receive cap refuses a gift only once the receiver has already had 500 today, and the gift that crosses 500 goes through, so a day can end a little over the cap. If refusals depended on the amount, a giver could try amounts and work out what someone else had received. The give cap stays exact because it only reads the giver's own total.
- Owner pairs give each other without caps, but only from the UTC day after the pair first appears in `set_owner_pairs`. Linking a fresh account, giving, and unlinking can't be repeated within a day, and unlinking and linking again starts the wait over. Pairs in the first list ever sent, or sent before the world counted days, count as linked since day 0, so links made before this rule work at once.
- A townsfolk resident's whole purse goes back to the treasury at `new_day`, gifts they were given included, and at once when they leave the townsfolk list. The treasury's history is public, so the returns are one line for all townsfolk together, and so are the budgets. A line per townsfolk resident would show what each one gave and was given.
- A welcome gift is only ever paid in full. When the treasury can't pay one, or others are already waiting, the newcomer joins a line (`economy.owed`), and each `new_day` pays the line in order, after the mint and before townsfolk budgets, while the treasury can pay each gift in full. A partial gift that counted as had would let a run of new accounts drain the treasury and leave real newcomers with nothing.
- `open_economy` needs the world to count days, so every cap and allowance has a day to belong to.
- `home` while already standing on your hearth is accepted when it collects today's allowance, and refused as `already_home` otherwise. Without this, a resident who never left home could never collect.
- Joining doesn't pay the allowance, even onto your hearth, since any API call or open socket joins.
- "First day" (can receive gifts, can't give) means the day a brand new resident first joins while coins are open. Residents from before coins opened never have one.

## Consequences

- Phase 1 supply only grows. Phase 2's shop (half of each purchase burned) is the first sink, and these purses are sized for its prices. Rerun the script with the shop's prices once it exists.
- The mint is fixed, but welcome gifts scale with arrivals. At 600 arrivals a month (`--residents 600`) the treasury hovers near zero, townsfolk budgets stop, 358 welcome gifts wait for a `new_day`, and 36 are still waiting at month end. At 150 (`--residents 150`) it climbs to about 9,400. Either is a signal to retune the mint by decision, not a failure: the treasury never goes negative, and a waiting gift is paid in full later.
- To try a change, run `node scripts/economy-sim.ts --set treasuryMint=800` (any key of `ECONOMY`), then edit `sim/src/economy.ts` and update this record or supersede it.
