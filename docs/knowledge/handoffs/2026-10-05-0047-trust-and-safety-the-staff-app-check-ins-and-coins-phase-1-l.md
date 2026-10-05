---
title: Trust and safety, the staff app, check-ins, and coins phase 1 live
date: 2026-10-05
tags: [process, deploy, safety, protocol, server, client, economy, agents]
---

# Trust and safety, the staff app, check-ins, and coins phase 1 live

## Done

All on `main` and deployed to terrakin.org (last deploy from 8584af1). `pnpm verify` (975 tests) and `pnpm e2e` (32) pass.

- **Trust and safety phase 1** (RFC 0006, decisions 0032 and 0033): 8742089, a4e5f90, 8566ace. Review fixes: hiding a post takes its files down everywhere, storage first; staff and townsfolk posts are never auto-hidden; `safety: true` routes (block, report, revoke, mark read) stay open during a suspension; report notes get the AI-reader check.
- **The staff app** at admin.terrakin.org (decision 0040): c63ef01 through c5983aa. Same Worker, served on `admin.*` hosts under `/_admin/`, behind Cloudflare Access (team `ryan-coral`, app "Terrakin Admin"; the team and audience tag are vars in `wrangler.jsonc`). Moderators by Access email, AI triage of reports through Anthropic with spend caps, exact-origin CSRF checks, moderator limits. Every staff route is `internal: true`: left out of OpenAPI, SKILL.md, llms.txt, the guides, and the changelog (Ryan: no admin in public docs). The shared client code moved to `ui/`.
- **Check-ins** (decision 0038): `GET /v1/checkin?since=<at>` and `/v1/act/{key}/checkin`. SKILL.md's first visit asks the owner how often to check in (suggests every 4 hours) and sets up the schedule.
- **Coins, phase 1** (RFC 0008, accepted; decision 0039): 525319a, f55a775, then the rest through 8584af1. The sim ledger and treasury, the allowance and streak, the welcome gift (paid only in full, queued when the treasury is short), `give_coins` with caps, owner pairs uncapped from the day after they link, townsfolk budgets. `GET /v1/purse`, the treasury on `GET /v1/town`, private `coins` events. On the web: the purse in the top bar, `/purse`, Give coins on profiles, coin notices, gifts and treasury moments in Happening now. The world opened coins at seq 323 with a 5,000 treasury.
- Learning: [never chain git push onto a rebase or a filter](../learnings/2026-10-05-never-chain-git-push-onto-a-rebase-or-a-filter-in-one-shell-.md). This session pushed a half-rebased branch (main had the sim half of coins for a few minutes) and once deployed a tree whose push had been refused (redeployed from main right after).

## State of things

- **Staff app needs one secret.** `TERRAKIN_MAINTAINER_EMAILS` isn't set (auto mode can't write secrets), so admin.terrakin.org signs in through Access but shows "staff only". Ryan runs `npx wrangler secret put TERRAKIN_MAINTAINER_EMAILS` with his two Access emails. With Access configured, resident tokens no longer open staff routes on terrakin.org either.
- **Triage is on**: `ANTHROPIC_API_KEY` was already a Worker secret. Auto-actions are gated (content must show the problem, high confidence, a second signal for suspected CSAM, never on staff or townsfolk).
- **Townsfolk get budgets but don't spend them.** The sim hands each townsfolk 50 coins a day and takes back what's left; no script gives tips yet.
- Coin numbers are tuned for about 300 arrivals a month. At 600 the treasury runs near zero and welcome gifts wait in line; retune `ECONOMY` by decision, with `node scripts/economy-sim.ts`.

## Next

1. **Townsfolk tips**: extend `scripts/townsfolk/` to spend each townsfolk's daily budget with `give_coins`: 10 to each newcomer who settled today, a tip for the best post of the day. The sim already caps 25 a resident a day and never to townsfolk or maintainers.
2. **Owner pairs as deltas**: `set_owner_pairs` logs the whole list on every link change. Add `add_owner_pair` and `remove_owner_pair` server commands and keep `set_owner_pairs` for replay.
3. **Coins phase 2, the town shop** (RFC 0008), once RFC 0005 step 2 brings items.
4. In the staff app, hide unsuspend and release from moderators on items a maintainer set (the server already refuses with 403).
5. The rest of the previous handoff's list: partners (RFC 0007), the gallery, RFC 0005 step 2, issues #20 and #31 to #37.

## Open questions

- The privacy page says "Anthropic handles that text under its commercial terms". It's a legal claim; Ryan should check it.
- Access app hardening, not done (an account setting): set the cookie to SameSite=Lax and HttpOnly, and consider a session shorter than 730 hours.
- Should gifts to townsfolk be allowed at all? Their purses return to the treasury each day, so a gift to one is a donation to the town. They're kept out of the public gift list for privacy.
