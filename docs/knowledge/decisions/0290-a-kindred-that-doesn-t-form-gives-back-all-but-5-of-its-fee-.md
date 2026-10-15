---
title: A kindred that doesn't form gives back all but 5 of its fee, and members can chip in toward it
date: 2026-10-15
status: accepted
tags: [sim, economy, kindreds, numbers]
---

# A kindred that doesn't form gives back all but 5 of its fee, and members can chip in toward it

## Context

Issue #69: founding a kindred took 25 coins, burned up front and never returned, while a resident earns about 10 to 15 a day ([decision 0279](0279-kindreds-land-in-the-sim-with-rfc-0033-s-answers-weeks-from-.md)). The founder carried all the risk of finding three households within 14 days, alone, and nothing told a resident short of the fee how to get there. Nobody had founded one. The issue recommended giving the fee back when forming fails, letting members share it, and saying the path to it.

## Decision

- The fee stays 25 and is burned at founding, as before. A kindred still forming after 14 days is disbanded, and then all but `KINDREDS.trialBurn` (5) come back, minted with the reason `kindred_refund`: what members chipped in to each of them, and the rest to the founder. When a forming kindred empties or staff disband it, members' chip-ins come back but the founder's share doesn't: leaving is the founder's choice. A formed kindred gives nothing back: forming is what the fee buys.
- A member who chipped in can't be removed while it forms (`chipped_in`), so a steward can't take their coins and replace them. They can leave themselves, and still get their chip-in back if it doesn't form.
- `chip_in_kindred {kindred, coins}`: a member who isn't the founder pays coins to the founder while the kindred forms (`kindred_share` on both ledgers, a `kindred_chipped_in` event for its members). Members together chip in at most the fee less the trial burn (20), so the founder always carries 5 of the risk, and the founder (or the record a founder was merged into) can't chip in to themselves. Chip-ins are kept on the kindred (`chips`). A refund for a record that was merged goes to the record it was merged into.
- The founding flow on the web and the check-in's `kindred` line say the fee against the resident's coins and the days the allowance takes to cover the rest. The check-in now offers `kindred` to a resident short only of coins, too. `GET /v1/kindreds` carries your `balance`; the kindred's view carries `chippedIn`, and the rules `trialBurn` and `allowance`.
- No logged switch. Kindreds opened at terrakin.org on 2026-10-15 and a kindred disbands unformed 14 days after its founding, so no live log holds an unformed disband before 2026-10-29, and no log holds a `chip_in_kindred`, which is new. This ships before then. The kindreds fixture's hash changed, since it disbands one unformed kindred.

## Consequences

- Trying costs 5 coins; a failed attempt with friends costs the founder 5 and them nothing. No path mints more than the fee less 5 for one kindred, against the 25 burned, so no ring of accounts profits.
- The founder still needs the whole 25 in hand to found: chip-ins come after. Charging the fee at forming instead was weighed and left out, since a forming kindred could then stall on a founder short of coins at the moment the third household joins.
- A Town Hall founding grant (the issue's option 4) waits on the coin-flow purse in issue #63.
- Code: `refundFee`, `checkChipInKindred`, and `chippedIn` in `packages/sim/src/kindreds.ts`; `foundingCost` in `packages/server/src/checkin-suggest.ts`; `foundingLine` in `packages/client/src/kindreds.ts`; and the fee card on the kindred's page.
