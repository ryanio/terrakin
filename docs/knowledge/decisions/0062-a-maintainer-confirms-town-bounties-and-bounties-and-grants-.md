---
title: A maintainer confirms town bounties, and bounties and grants hold their coins in the sim until they pay
date: 2026-10-05
status: accepted
tags: [sim, economy, numbers, protocol, server, client, governance, agents]
---

# A maintainer confirms town bounties, and bounties and grants hold their coins in the sim until they pay

## Context

[RFC 0008](../../rfcs/0008-coins-karma-and-the-market.md) phase 5 is town money. A Town Hall proposal can make a `grant {to, amount, reason}` that pays from the treasury when it passes, and a bounty is a job the town (a passed proposal) or a resident (from their own purse, held in escrow) pays for once it's done. The RFC leaves open who confirms a town bounty is done: a second vote, a maintainer, or the resident who proposed it. It also leaves the caps, expiry, and what happens to coins nobody earns.

## Decision

**A maintainer confirms a town bounty, from the staff app.** It's a server input, `confirm_town_bounty {bounty, to, by}`, logged with who confirmed. The sim refuses it unless the claimant has marked the job done, and refuses a confirmer who is the claimant or the proposer, or in either's household. A maintainer who finds the job isn't done sends the claimant back (`reopen_bounty`). A resident's own bounty is confirmed by the resident who posted it, as the RFC says.

**A passed grant waits for a maintainer too.** The RFC has a grant pay when it passes. With a quorum of 3 in a small town, one person with three accounts could pass a grant to a friend, so a grant gets the same second key: when it passes, its coins move into a town bounty already held by its resident and marked done, and a maintainer releases it with the same `confirm_town_bounty`. Nobody else can claim it, and it doesn't expire.

The three choices, for treasury coins:

| Who confirms | For | Against |
|---|---|---|
| The proposer | Fast, no staff time | One resident and a friend (or their own AI) can propose a job, claim it, and confirm it, so one passed vote moves up to 1,000 treasury coins on one person's word |
| A second vote | Residents decide, as with the first vote | Two more days per payout, a quorum a small town may not reach, and the same Sybil exposure as the first vote |
| A maintainer | Someone outside the deal checks the work before any coin moves | Staff time, and the town waits on staff |

A maintainer is the safest for treasury coins, and it's easy to change. Confirming is one server input, so a later decision can let a passed second vote or the proposer send the same input, and every log so far replays the same.

**Coins are held in the sim.** A bounty's reward leaves the poster's purse (or the treasury, for a town bounty or a grant) when it's posted and sits in the bounty until it's paid, cancelled, or expires. The supply identity becomes `sum(coins) + treasury + held in bounties == minted - burned`.

The steps:

- `post_bounty {title, text?, reward}` opens a resident bounty. `claim_bounty` takes it (one claimant at a time), `drop_bounty` lets go of it (or, for the poster of a resident bounty, sends the claimant back), `complete_bounty` is the claimant saying it's done, and `confirm_bounty {bounty, to}` is the poster paying them. `cancel_bounty` takes back an unclaimed one.
- A passed `bounty` proposal opens a town bounty with the proposal's title and text. A passed `grant` proposal holds its coins for its resident until a maintainer releases them.
- `void_bounty {bounty, by}` is a maintainer cancelling any bounty or held grant that hasn't paid. `void_proposal` still stops a grant before its vote closes.
- Nothing runs until the server sends `open_bounties`, which needs coins open.

**The numbers** are `BOUNTIES` in `packages/sim/src/bounties.ts`.

| Number | Value |
|---|---|
| A resident's bounty | 1 to 200 coins, and it counts toward the poster's daily give cap (200) |
| A town bounty or a grant | 1 to 1,000 coins, and the treasury must spare it above `budgetReserve` (1,000, kept for welcome gifts) when the proposal is filed and when it closes |
| Bounties one resident has posted and not finished | 3 |
| Bounties one resident holds a claim on | 3 |
| Title, text | 80 and 500 characters |
| Expiry | 30 days after posting, for a bounty still open or claimed |
| Finished bounties kept in the world | the newest 100 |

- **Payouts between residents keep to the gift caps.** Posting a bounty counts its reward toward what the poster gives today, and nobody posts on their first day. Paying one counts toward what the claimant receives today, and is refused once they're already at 500 (try tomorrow); an owner-linked pair skips that, as with gifts. Town bounties and grants come from the treasury and skip the caps, like the welcome gift.
- **Coins nobody earns go back where they came from.** Cancelling, voiding, or expiry returns a resident's reward to their purse and a town reward to the treasury. A passed grant or bounty the treasury can't spare when it closes moves nothing, and its event says so.
- **A bounty that's marked done doesn't expire.** It waits for its confirmation, or for the poster (or a maintainer) to send the claimant back. A maintainer can void one whose poster has gone quiet, which returns the coins to the poster.
- **Grants go to someone else.** Not the proposer, not their owner-linked household (checked when it's filed and again when it closes), not someone either of them blocked, and never townsfolk.
- **Townsfolk neither post nor claim.** Their coins are the town's, and `townsfolkPerResident` caps what they give one resident a day. Town bounties go through the Town Hall.
- **Bounties are public.** Who posted, who claimed, and who was paid are in `GET /v1/bounties` and in public events. Titles and texts are untrusted text, filtered at the edge like proposals (`bounty_title`, `bounty_text`), and never become an action ([decision 0004](0004-chat-is-untrusted-data.md)).
- **Staff go into the world log by an opaque id.** A maintainer signed in with a resident token is logged by their resident id. One signed in through Cloudflare Access is logged as `staff_` and 16 hex characters of a SHA-256 of their sign-in, so no email enters the log, which is kept for good. The moderation log names them as it does for every staff action.
- **The household check knows who an Access maintainer is.** The secret `TERRAKIN_STAFF_RESIDENTS` maps each Access email to a resident. `confirm_town_bounty`, `reopen_bounty`, and `void_bounty` carry an optional `resident`: the token's resident, or the mapped one, or nothing for an unmapped email. For `confirm_town_bounty`, the sim refuses a `resident` who is the claimant or the proposer, or in either one's owner-linked household, as it does `by`. For `reopen_bounty` and `void_bounty`, only the poster's side is refused: sending back a claim or voiding a resident's bounty can only help whoever posted it (the reward goes back to them), and a maintainer whose own AI claimed a reported bounty can still take it down. `by` stays the opaque `staff_` id.
- **Karma's `bounty` source is 5 points** for the claimant when a bounty pays ([decision 0055](0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)). A resident's bounties count once per poster and claimant in the 90-day window, so two accounts trading 1-coin bounties earn it once. Each town bounty counts, and so does a released grant: the credit is read from the logged confirmation, which doesn't say which it was.
- `src/fixtures/bounties-log.ts` pins a replayed hash with bounties and grants in it.

## Why

- **The treasury is everyone's.** A payout from it should never rest on one resident's word, and the vote that approved the job didn't see the work. A maintainer is the cheapest second key there is today.
- **Escrow is what the RFC asked for**, and it makes a bounty a promise: the reward can't be spent twice, and a claimant knows the coins exist.
- **A resident's bounty is a gift with a condition.** Without the give and receive caps, a bounty would be a way around them. 200 is the daily give cap, so posting can't move more than a gift could.
- **1,000 for the town** is the RFC's grant cap. The treasury mints 700 a day, five proposals can be open at once, and each resident files one a week, so the town can't promise more than it makes.
- **Expiry at 30 days** keeps a stale claim from holding coins forever. Done bounties wait instead, so a claimant who finished is never stiffed by the clock.

## Consequences

- Staff confirm town bounties in the staff app (`packages/admin/`, Bounties). If the town outgrows that, a second vote is the next step, by decision, as a new input that the sim accepts alongside this one.
- An Access maintainer whose email isn't in `TERRAKIN_STAFF_RESIDENTS` is still only an opaque staff id, so the sim can't check their household. Map every maintainer's email.
- `resident` is a new field, not a new `by`. Logging the resident as `by` would have been simpler, but then world state (a bounty keeps its `by`) would name which resident did a staff action, and staff identity is never shown to residents ([decision 0040](0040-a-staff-app-on-its-own-host-behind-cloudflare-access-with-st.md)). The field lives only in the logged input, which no route serves, and never in state or an event. Older inputs don't have it and replay as before. A `staff_` id is an unsalted hash of the sign-in, so anyone holding a copy of the log who guesses a maintainer's email could tie it to their resident; treat a copy of the world log as private.
- `reopen_bounty` and `void_bounty` check only `resident`, never `by`, so an input logged before the field existed can't be refused on replay. A token maintainer gets the check because the server sends their own id as `resident`.
- The RFC's proposal deposit (20 coins) still isn't built.
- Changing `BOUNTIES` changes how a log with bounties replays, like every sim number. Raise a cap with a logged input that switches it, as `set_shop_share` does.
- Code: `packages/sim/src/bounties.ts`, the `grant` and `bounty` kinds in `packages/sim/src/town.ts`, `packages/protocol/src/bounties.ts`, `packages/server/src/bounties.ts`, `packages/client/src/bounties-view.ts`, `packages/admin/src/bounties-view.ts`.
