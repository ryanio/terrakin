---
title: A maintainer awards treasury coins on their own word, capped and marked when it stays in their household
date: 2026-10-16
status: proposed
tags: [sim, economy, numbers, protocol, server, admin, governance, security, staff]
---

# A maintainer awards treasury coins on their own word, capped and marked when it stays in their household

## Context

Terrakin has four personas and one of them is the champion, but the world had no way to thank one with coins. The paths that existed each missed: a Town Hall `grant` proposal puts one named resident's merit to a public vote and needs a quorum a small town may not reach, a town bounty pays whoever claims a job, a gift from a maintainer's own purse is a personal gift rather than the town recognizing someone, and no staff route moved coins into a purse at all.

[Decision 0062](0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md) stands in the way on purpose. It made a maintainer the second key on every treasury payout, so that no payout rests on one person's word, and extended the household check to maintainers: `confirm_town_bounty` refuses a confirmer who is the claimant or the proposer, or in either's household. [Decision 0147](0147-test-residents-are-built-through-real-actions-with-a-test-on.md) keeps the one command with the right shape, `test_grant`, out of production entirely.

So recognition could not be built without deciding whether the two-key rule holds for a payout nobody voted on.

## Decision

**A maintainer awards treasury coins alone, with no vote and no second maintainer**, through `award_grant` ([RFC 0036](../../rfcs/0036-recognition-grants.md)). What stands in for the second key is a cap and daylight rather than a veto:

| Guard | Value |
|---|---|
| One award | at most `AWARDS.max`, 200 coins, which is `ECONOMY.giveCap` |
| Every award together | at most `AWARDS.perMonth`, 1,000 coins, over a rolling `AWARDS.windowDays` (30) |
| The treasury | only what it holds above `ECONOMY.budgetReserve` |
| The recipient | never townsfolk, and must meet `townEligibility` |
| The awarder | a maintainer, a staff sign-in rather than a staff key, and one the staff mapping names |

**An award inside the awarding maintainer's own household is allowed and marked, not refused.** `resident` (the maintainer's own resident) is required on the command, and the sim refuses an award it cannot place in a household. When it is one, `household: true` goes on `state.awards`, on the public `award_paid` event, and on the treasury's `LedgerLine`, which `GET /v1/town` publishes.

**The ledger line is the disclosure, not the event.** Events are not stored and there is no public event-history route, so a flag on the event alone would be visible only to whoever held a socket at that second. An award paid overnight would have left a public record identical to an arm's-length one. The flag lives on the line so it can be read back at any time.

**This narrows decision 0062 for awards only.** Vote-passed grants and town bounties keep their two-key rule, and `confirm_town_bounty` is unchanged.

## Why

- A treasury payout nobody voted on still needs *some* check, and for a thank-you worth 200 coins a second maintainer's time is dearer than the risk. A guard that refuses the main use is a veto, not a guard.
- The exposure of a careless or stolen maintainer sign-in is bounded and recoverable: 1,000 coins over 30 days, against a treasury of about 9,700 growing 700 a day, so the worst case is under two days of growth and it cannot touch the welcome-gift reserve.
- The operator already holds much stronger powers (suspend, disband a kindred, merge records, re-key any agent, void any bounty). What they did not hold was a way to be *seen* doing a favour, which is what the mark adds.
- The repo is public and self-hosted elsewhere, so the honest option was to make self-dealing visible rather than to forbid it and be worked around.

## Consequences

- Terrakin is a world where one staff member can move town coins. Anyone reading [decision 0062](0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md) alone will have the wrong picture, which is why this record exists.
- **Every maintainer's email must be in `TERRAKIN_STAFF_RESIDENTS`**, or they cannot award at all. The mapping was good practice before; it is now a requirement, because the household mark depends on it.
- `AWARDS`' numbers are replay-affecting once a live world holds an award, so changing one needs a logged switch. `src/fixtures/awards-log.ts` pins a hash with an arm's-length award, a household award, and a pruning past the window.
- The caps are global rather than per maintainer, so one sign-in can spend the month for everyone. Worth revisiting when there is more than one maintainer.
- The `award` notification carries the amount and no words. Whether it should carry the maintainer's reason is open, and would be the first staff-authored text residents ever see; adding it later is additive.
- **A suspended resident cannot be awarded**, checked in the handler because the sim never sees suspensions. Rewarding someone who is currently being punished is incoherent. **A block is deliberately not checked**, unlike a `grant`, which cannot name someone across a block: an award is a payment and not contact, so someone who blocked a maintainer can still be thanked by the town through them.
- Code: `packages/sim/src/awards.ts`, `packages/sim/src/economy.ts` (`treasurySpare`, `moveTreasury`'s extra), `packages/protocol/src/safety.ts` (`AWARD_RULES`, the staff request and answer), `packages/protocol/src/coins.ts` (`TreasuryLine.household`), `packages/protocol/src/social.ts` (the `award` notification), `packages/server/src/handlers/safety.ts`, `packages/server/src/staff-keys.ts` (`KEY_NEVER`), `packages/admin/src/bounties-view.ts`.
