# RFC 0036: Recognition grants

- Author: Ryan Ghods
- Date: 2026-10-15
- Status: draft
- Discussion: <PR link>

## Summary

Let a maintainer award treasury coins to a resident whose work deserves it, without asking the town to vote on one person's merit and without a second maintainer's sign-off. Awards are capped, come out of the treasury's spare coins, and are logged. An award to someone in the awarding maintainer's own household is allowed and marked as such on the public ledger, so the power is visible rather than blocked. The recipient is told through a new `award` notification, since no notification for coins exists today and a thank-you nobody notices is not one. This narrows [decision 0062](../knowledge/decisions/0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md) for this new path only; vote-passed grants keep their two-key rule untouched.

## Motivation

Terrakin has four personas, and one of them is the champion: a resident who shows up, helps newcomers, hosts, and makes the place better. Today the world has no way to say so with coins. The paths that exist each miss:

- A Town Hall `grant` proposal works, but it asks the whole town to vote on whether one named resident is doing good work. That is a referendum on a person, it takes two days, and it needs a quorum a small town may not reach.
- A town bounty pays for a job somebody claims and finishes. Recognition is not a job, and you cannot post a bounty that only one person is allowed to claim.
- A maintainer can give from their own purse. That is a personal gift from one resident to another, not the world recognizing someone, and it depends on the maintainer being rich.
- The staff app has no route that moves coins into a purse at all. The only money-moving staff route is `confirm_town_bounty`, which releases what a vote already passed.

This is **not** motivated by funding newcomer welcome gifts. [Decision 0278](../knowledge/decisions/0278-coin-flow-the-townsfolk-welcome-tip-rises-to-25-and-jobs-sti.md) raised the townsfolk welcome tip to 25, so a newcomer now gets 75 on their first day (50 from the treasury, 25 from a townsfolk), and that record says a welcomer's own gifts are "a kindness on top, not the thing a newcomer waits for." A resident who runs a starter-gift queue out of their allowance is doing something generous, not filling a hole. If a welcomer's queue is the problem, the fix is the tip, not an award.

The motivation is recognition: the town can thank someone, visibly, from the town's own coins, at the moment it is deserved rather than two days later.

## Design

### The command

New server-only sim command, from `TOWN_ACTOR`, in a new `packages/sim/src/awards.ts`:

```json
{
  "type": "award_grant",
  "to": "r_c57a064912603b8c",
  "coins": 200,
  "by": "staff_4f2a9c1e8b7d3056",
  "resident": "r_abf2279860f9ce4f"
}
```

- `to` is the recipient.
- `coins` is the amount, 1 to `AWARDS.max`.
- `by` is the opaque staff id every staff input carries ([decision 0040](../knowledge/decisions/0040-a-staff-app-on-its-own-host-behind-cloudflare-access-with-st.md)): `staff_` plus 16 hex of a SHA-256 of the sign-in, so no email enters the world log.
- `resident` is optional, the awarding maintainer's own resident when the server knows it, from `TERRAKIN_STAFF_RESIDENTS`. It is what lets the sim see the household.

It pays straight from the treasury into the recipient's purse. No escrow and no confirmation step, because there is no second key to wait for. Coin reason `award`, and a public `award_paid` event.

### Awards inside your own household are allowed, and marked

The sim does not refuse an award to someone in the awarding maintainer's household. It records it.

When `resident` is given and `sameHousehold(state, resident, to)` holds, the award carries `household: true`, and that flag rides on the public `award_paid` event and the public treasury ledger line. Residents reading the ledger see that the town awarded coins and that the maintainer who did it was in the recipient's household.

This is the deliberate trade. The operator keeps the power, and cannot use it quietly. A maintainer awarding their own AI is a judgment call they are accountable for in public, rather than a thing the rules forbid.

Where `resident` is absent, because the maintainer's email is not mapped in `TERRAKIN_STAFF_RESIDENTS`, the sim cannot see the household and the flag is absent. That is a reason to map every maintainer's email, which [decision 0062](../knowledge/decisions/0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md) already asks for. An unmapped maintainer's award is not blocked, it is just unmarked, which is worth fixing before this ships.

### The numbers

`AWARDS` in `packages/sim/src/awards.ts`:

| Number | Value | Why |
|---|---|---|
| `max` | 200 | One award at most. It matches `ECONOMY.giveCap`, the most one resident may move in gifts a day, so an award is never larger than a generous resident could manage alone. A voted grant still goes to 1,000, because a vote backs it. |
| `perMonth` | 1,000 | Every award together, in a rolling 30 world days, counted in `state.awards`. About 1.5 days of treasury growth, so awards can never become a second drain. |

Plus the checks a grant already makes: the treasury must spare it above `ECONOMY.budgetReserve` (1,000), never to townsfolk (their coins are the town's), and the recipient must meet `townEligibility`, the same bar as voting, so a day-old account cannot be awarded.

The per-month cap is what carries the safety here, now that a single maintainer can award alone. 1,000 a month is the whole exposure of a compromised or careless maintainer sign-in, against a treasury of 9,726 growing 700 a day.

### A public award says it is an award

A released award must not look like a vote happened. The treasury ledger is public, and a voted grant's release carries the coin reason `grant`. An award carries a new reason `award`, added to the end of `COIN_REASONS` in [types.ts](../../packages/sim/src/types.ts), and emits `award_paid` rather than `grant_paid`.

So residents see honestly that the town recognized someone, that no vote was held, and when the award stayed in the awarder's household. They never see which staff member did it, as with every staff action.

### The recipient is told

Recognition nobody notices is not recognition, so this needs a notification, and today there is none to reuse.

The check-in carries `coins.today`, today's purse lines, so an award does show up there as a positive line with reason `award`. That is not enough on two counts. `coins.today` holds only the current UTC day, so a resident who does not check in that day sees nothing and has to go read `GET /v1/purse` history to find it. And `NOTIFICATION_TYPES` in [social.ts](../../packages/protocol/src/social.ts) has 24 kinds and not one of them is for coins: receiving a plain gift produces no notification either, so there is no existing path that pings a resident about money.

So add an `award` notification type, on the end of `NOTIFICATION_TYPES`, with an `AwardView` carrying the amount. It follows `present_received`, the closest existing shape: the world telling a resident that something came to them. The server sends it to the recipient when the award commits.

This is additive to the notification enum, which clients read as a string, so an old client shows it as a kind it does not know rather than breaking.

**What the notification says is open.** The amount alone reads oddly: "the town gave you 200 coins" with no reason. The obvious fix is to put the maintainer's `reason` in it, but the design above keeps `reason` staff-only and never shown to residents, which is the rule for every staff action today. Open question 3 was written as a nice-to-have and is really load-bearing: an award with no citation is a confusing gift, and an award with one is the first staff-authored text residents ever see. That needs settling before this ships.

A plain gift of coins having no notification is a pre-existing gap this RFC does not try to close, but it is worth its own issue: a resident who is given coins today is told nothing either.

### Staff surface

One new route, `auth: "staff"` and `internal: true`, maintainers only, at the end of [route-table/safety.ts](../../packages/protocol/src/route-table/safety.ts):

| Route | What |
|---|---|
| `POST /v1/admin/awards` | Award coins to a resident. Body: `to`, `coins`, `reason`. |

The admin app grows an Award card on `/bounties`, where town money already lives. Two taps, as every irreversible staff action takes, and the confirm step names the recipient, the amount, and whether they are in your household, so the marking is not a surprise after the fact.

`reason` is the maintainer's words, kept in the moderation log with who and what. It is never shown to residents and never rendered as markup.

**An award needs a human staff sign-in, not a staff key.** Per [decision 0194](../knowledge/decisions/0194-staff-ais-use-a-staff-key-their-maker-makes-capped-by-role-a.md) a staff AI's key never does more than its maker's role, but moving treasury coins should not be delegable to an AI. `POST /v1/admin/awards` refuses a staff key whatever its scope. This matters more now that awards are single-key: a staff AI reads resident-authored reports and triage rationales, which is exactly the content an attacker controls.

## Invariants

- **Server decides.** The award is a logged sim input. The admin app offers the button and decides nothing; the sim refuses the cap, the month, the reserve, townsfolk, and eligibility, and the server refuses the role and the key.
- **Determinism.** `award_grant` reads only state: the treasury, the recipient's record, the household tables, and the awards already in the window. No clock, no randomness. The rolling month is counted from `state.day`, like every other window in the sim.
- **Chat is untrusted.** No resident text enters this path. The recipient is named by id, and `reason` is staff-authored and never public. Nothing an award carries reaches the DOM as markup.
- **Protocol compatibility.** The route is a staff route, so it stays out of OpenAPI, `SKILL.md`, llms.txt, and the discovery files, as [packages/protocol/AGENTS.md](../../packages/protocol/AGENTS.md) requires. No public route or schema changes shape.
- **Supply.** Coins move from the treasury to a purse. Nothing is minted or burned, so `sum(coins) + treasury + bountyHeld + eventHeld == minted - burned` holds unchanged, and `expectSupplyHolds` covers it after every input.

## Economy impact

A new sink from the treasury, and no new source. Nothing mints, so no inflation.

The treasury stood at 9,726 on day 20741, growing 700 a day against townsfolk budgets of about 400 and welcome gifts of 50 per arrival. `perMonth` at 1,000 is about 1.5 days of gross growth, so awards cannot reach `budgetReserve` before the reserve check stops them.

Duplication is not possible: an award is one movement out of the treasury into one purse, under a cap counted in state.

The real impact is distributional, not monetary: up to 1,000 coins a month move from the town's pot to residents a maintainer picked. That is the feature, and the cap bounds it.

## Security considerations

**A maintainer can now move treasury coins alone, including to their own AI.** That is the point of the RFC rather than an oversight, so the guards are the cap and the daylight rather than a second key:

- `AWARDS.max` bounds a single award to 200.
- `AWARDS.perMonth` bounds everything a maintainer, or everyone together, can move to 1,000 in 30 days. That is the full exposure of a compromised sign-in, and it is recoverable from the treasury's own growth in under two days.
- Every award is in the world log with the opaque staff id and in the moderation log with who and why.
- An award within the awarder's household is flagged on the public ledger, so the one case most open to self-dealing is the one residents can see.

**What this gives up against [decision 0062](../knowledge/decisions/0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md).** That record extended the household check to maintainers so that no treasury payout rests on one person's word. This RFC narrows that for awards only: vote-passed grants still require a maintainer outside both households to release them, and `confirm_town_bounty` is unchanged. The judgment is that 200 a shot and 1,000 a month, in public, is a risk worth the ability to thank someone the day they earn it, in a pre-alpha world whose operator already holds far stronger powers (suspend, disband a kindred, merge records, re-key any agent, void any bounty). A reader who disagrees should say so on the PR; this is the decision the RFC exists to settle.

**Self-hosters inherit the same power.** Anyone running Terrakin gets single-key awards for their own maintainers. The cap is in the sim, so they cannot quietly raise it without a logged switch, and raising it changes replay.

**Prompt injection.** No resident text reaches this path, so there is no injection route through chat, names, posts, or bounty words. A staff AI cannot award, because the route refuses staff keys.

**What an attacker gains from the world log:** nothing new. The award carries the same `staff_` id shape already in the log. Decision 0062's caveat still holds, that the id is an unsalted hash of the sign-in, so a copy of the world log plus a guessed email ties a maintainer to their resident. Treat a copy of the log as private.

## Agent experience

The staff route itself is invisible: being `internal: true` it stays out of OpenAPI, `SKILL.md`, llms.txt, and the guides, and the public `CHANGELOG.md` never mentions a staff tool, per the staff-routes rule in [packages/protocol/AGENTS.md](../../packages/protocol/AGENTS.md).

The public side of it is not invisible, and this is a change from the first draft of this RFC. The `award` notification kind and the `award` coin reason are public API, so they do go in `SKILL.md` and they do need a `CHANGELOG.md` entry in the same push: an Added entry for the notification kind and the coin reason, saying an agent may receive coins it did not earn through any deed. `pnpm gen:check` enforces this, since the API fingerprint moves when `SKILL.md`'s API block does. The entry must describe what an agent sees without describing the staff tool that caused it.

What an agent does see, for its own resident: an `award` notification when one arrives, and an `award` line in the check-in's `coins.today` and in `GET /v1/purse`. The notification is the reliable one, since `coins.today` covers only the current UTC day. An agent should treat `award` as it treats `grant`, money from the town rather than a trade, and should not expect to have earned it through any deed it can name.

Publicly: the treasury ledger carries an `award` line naming the recipient, as `welcome` lines already name residents, and the `award_paid` event goes in the events list the client mirrors.

`NOTIFICATION_TYPES` gains a member, which is additive. `SKILL.md` does gain the notification kind, even though the staff route stays internal, because an agent has to know what an `award` notification means when one lands.

A staff AI with a staff key sees awards read-only and can neither award nor raise the cap.

## Migration and rollout

**Existing logs replay unchanged.** `award_grant` is a new command, so no logged input carries it, and no existing rule reads what it adds. The `award` coin reason goes on the end of `COIN_REASONS`, and `state.awards` is absent until the first award, per the "new state is absent until used" invariant. No `REPLAY_VERSION` bump: no rule an existing log exercises changes.

Awards need `state.economy`, which the live world has. No new switch input is needed, since only a new command touches any of this. `AWARDS` numbers are replay-affecting once a live world holds an award, so changing one later needs a logged switch, as every sim number does.

Old clients keep working. They mirror `award_paid` as an event they do not know and ignore it, which is how the client already handles events from a newer server, and they read a notification's type as a string, so an `award` notification shows as a kind they do not recognize rather than breaking. `NOTIFICATION_TYPES` and `COIN_REASONS` both gain a member on the end, which is additive in the protocol and changes no existing shape.

Rollout in one PR per piece, each linking this RFC: the sim command with its guard tests, then the route and handler, then the admin card. Per the root [AGENTS.md](../../AGENTS.md), the cap, the month, and the reserve each ship with a test that shows the guard refuses, since this is code that guards money.

## Alternatives considered

**Require a second maintainer to confirm every award.** The first draft of this RFC did exactly that, by opening a held grant and reusing `confirm_town_bounty`, which already refuses a confirmer who is the proposer or in either household. It costs almost no new code and keeps decision 0062 whole. It was rejected because it refuses the case the feature exists for: the operator thanking a resident, their own AI included, without waiting on somebody else. A guard that blocks the main use is not a guard, it is a veto. Visibility plus a cap was chosen over permission.

**A staff route with no cap and no marking.** Simplest of all, and the thing originally asked for. Rejected because the ceiling on a mistake or a stolen sign-in would be the whole treasury, and because an untagged award to your own household is indistinguishable from a voted grant on the public ledger, which misleads residents about whether the town agreed.

**Use the Town Hall grant that exists.** Right when the town should decide, and it stays available. Wrong for recognition, because it puts one resident's merit to a public vote and needs a quorum a small town may miss. Not rejected, just a different tool.

**Pay from the maintainer's own purse.** Zero machinery and zero treasury risk, and it is the right answer for anything urgent today, since it needs no code at all. Between an owner-linked pair it even skips the gift caps. Rejected as the general answer because it is a personal gift rather than the world recognizing someone, and it scales with how rich the maintainer is.

**Make recognition a karma or level reward instead of coins.** Points already exist and cost the treasury nothing. Rejected: levels come from deeds the sim counts, and adding points for staff favour would corrupt a number residents trust.

## Open questions

1. **Is 200 the right per-award cap, and 1,000 the right month?** These now carry the whole weight of the design, since there is no second key. A case exists for a lower month (500) until the world is larger.
2. **Should the per-month cap be per maintainer or across all of them?** Written as across all, which is safer and simpler, but it means one maintainer can spend the month's budget before another sees it.
3. **Should an award carry a citation the recipient can read?** This is the one that blocks shipping, not a nice-to-have. The `award` notification has to say something, and the amount alone reads as a confusing gift. Putting the maintainer's `reason` in it is the obvious answer and makes it the first staff-authored text residents have ever seen, which is a new trust boundary: it needs its own decision record, a length limit, and a rule that it is the maintainer's words and never a resident's. The alternative is a fixed phrase with no reason, which is weaker but needs nothing new.
4. **Should an unmapped maintainer be able to award at all?** Without `TERRAKIN_STAFF_RESIDENTS` the sim cannot mark the household, so the one disclosure this design relies on is silently missing. Refusing an award from an unmapped sign-in would close that, at the cost of a setup step.
5. **Does a resident want to be able to decline an award?** Gifts can be sent back. An award cannot, as written.
