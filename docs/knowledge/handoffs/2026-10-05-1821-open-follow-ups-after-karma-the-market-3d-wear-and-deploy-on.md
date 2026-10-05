---
title: Open follow-ups after karma, the market, 3D wear, and deploy on green
date: 2026-10-05
tags: [process, economy, deploy, agents]
---

# Open follow-ups after karma, the market, 3D wear, and deploy on green

## Start here

1. Read `AGENTS.md`, `docs/knowledge/INDEX.md`, this note, and the one before it, [Karma, the market, 3D wear, and deploy on green](2026-10-05-1817-karma-the-market-3d-wear-and-deploy-on-green.md), which says what each feature does.
2. Other sessions work in this repo at once. Work in a worktree: `git worktree add -b <name> .claude/worktrees/<name> origin/main`, then `pnpm install --frozen-lockfile --offline`. The main checkout has someone's uncommitted `docs/plans/digital-art-gallery.md`; leave it alone.
3. `pnpm verify` was green at `2d1ece5` (about 1,530 tests) and `pnpm e2e` passed 55. Push with the guarded routine: fetch, rebase, `git merge-base --is-ancestor origin/main HEAD`, check `git diff origin/main --stat`, push to main.
4. To see a client change in the browser from a worktree, see [the launch.json learning](../learnings/2026-10-05-the-preview-tool-reads-the-main-checkout-s-launch-json-not-a.md).

## State of things

- **Live on terrakin.org:** karma on profiles and appreciation coins ([decision 0055](../decisions/0055-karma-is-scored-from-90-days-of-appreciation-outside-the-sim.md)), the market with escrow, fees, and stalls ([decision 0056](../decisions/0056-the-market-holds-listings-in-escrow-in-the-sim-burns-a-listi.md)), wear on 3D figures, and the look editor fixes. All were deployed by hand with `pnpm cf:deploy`, last at `24f7125`. `GET /v1/market` answers.
- **The CI deploy job (`2d1ece5`) has never run.** No GitHub Actions run exists for that push. The only CI after it is `3e5b645`, which is `[skip ci]`. So the job in `.github/workflows/ci.yml` is untested.
- **A second deploy path may exist.** `2d1ece5` shows a queued check suite from `cloudflare-workers-and-pages`, which means a Cloudflare Workers Builds git integration is connected to this repo. If it deploys on push, main would deploy twice, and it may already have been deploying before CI's job existed.
- **One flaky e2e test:** `e2e/duo.spec.ts:165` ("with no plot yet, sharing your home turns itself off…") failed once in CI on `97fdf63` (`locator.check: Clicking the checkbox did not change its state`), then passed on the next three runs.

## Next

In order. Each is startable from main.

1. **Settle how main deploys.**
   - See whether Cloudflare builds this repo: Workers & Pages, the `terrakin` worker, Settings, Builds. The `cloudflare-builds` MCP tools can list its builds: `workers_list`, then `workers_builds_list_builds`.
   - If a build there deploys on push, either turn it off (it's an account setting: ask Ryan first) or delete CI's `deploy` job. Keep one path.
   - If CI's job stays, make it run: push a commit that isn't `[skip ci]` and check `gh run list --repo ryanio/terrakin`. If Actions still doesn't start, read the repo's Actions settings and `gh api repos/ryanio/terrakin/actions/permissions`. If the deploy step fails, the `CLOUDFLARE_API_TOKEN` secret (set 2026-10-03) likely lacks a scope, and the `cf-deploy-token` skill makes a new one with Ryan.
2. **Fix the flaky `duo.spec.ts:165` checkbox.** Read the spec and `e2e/AGENTS.md`. The likely cause is checking the box before the view finishes its own update. Wait for the control's settled state (its `aria-checked`, or the request it sends) instead of retrying.
3. **Let staff take down one listing** (decision 0056 follow-up). A made thing's label is now public in the market, and staff can only close a stall by suspending its seller.
   - Add a server-only sim input, say `remove_listing {listing, by}` from `TOWN_ACTOR`, modeled on `void_proposal`. It returns the lot to the seller, or holds it if their things are full: decide which, and record it in 0056.
   - Add a staff route in the moderation section of `protocol/src/routes.ts` and log the action through `SafetyService.recordAction`. Add `listing` to `REPORT_KINDS` so residents can report one.
   - Then a button in the staff app (`admin/`). Tests in `sim/src/market.test.ts`, `server/src/market.test.ts`, and `server/src/staff.test.ts`.
4. **Page `GET /v1/market`** past 200 listings with `before` (a listing id), the way `/v1/feed` pages, and say so in SKILL.md and the CHANGELOG.
5. **Weigh praise by the giver's tier** in `scoreKarma` (`server/src/karma.ts`), the same way reactions are weighed: Newcomer praise worth 1 instead of 2. That's the cheapest guard against account rings, which decision 0055 accepts as a risk today. Update 0055's table and SKILL.md's karma table.
6. **Grants and bounties, RFC 0008 phase 5.** Read the RFC's "The treasury and who gives from it". Write a decision for who confirms a town bounty is done (the RFC's open question) before building. Karma has a `bounty` source waiting (5 points).

## Open questions for Ryan

- The market lists from a hearth plus 3 days in Terrakin, not the RFC's Neighbor karma, because nobody was a Neighbor yet. When should `MARKET_LISTING.tier` (`protocol/src/market.ts`) go up to `neighbor`?
- Should main deploy from CI's job or from Cloudflare's own git builds? Keep one.
- Who confirms a town bounty is done: a second vote, a maintainer, or the proposer?
- RFCs 0009 to 0011 and issue ryanio/terrakin#40 (welcome kits) still wait on a call.
