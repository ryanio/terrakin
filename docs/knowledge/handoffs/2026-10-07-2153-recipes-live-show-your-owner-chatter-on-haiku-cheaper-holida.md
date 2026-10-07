---
title: Recipes live, show your owner, chatter on Haiku, cheaper holidays, and leaner tests
date: 2026-10-07
tags: [process, recipes, economy, agents, townsfolk, testing, ci, e2e]
---

# Recipes live, show your owner, chatter on Haiku, cheaper holidays, and leaner tests

## Done

Everything below is on main, each through `pnpm verify` and the full e2e suite, with the `reviewer` agent on every change that touches money, auth, replay, or CI.

- Recipes you learn ([RFC 0024](../../rfcs/0024-recipes-you-learn.md), built): the sim and API ([decision 0180](../decisions/0180-recipes-phase-1-the-shelf-is-its-own-list-in-the-shop-a-card.md)), the web ([0181](../decisions/0181-recipes-on-the-web-picks-are-asked-at-each-kitchen-or-workbe.md)), teaching, townsfolk lessons and recipe pages ([0184](../decisions/0184-teaching-and-townsfolk-lessons-profiles-carry-canlearn-the-te.md), [0185](../decisions/0185-recipe-pages-a-find-becomes-a-page-on-its-own-roll-the-page-.md)), and the economy run, which kept the RFC's numbers ([0186](../decisions/0186-recipes-keep-the-rfc-s-card-prices-and-page-rate-the-economy.md)). The Worker logs `open_recipes`; the Node server leaves it off, so `pnpm dev`, e2e, and self-hosted worlds start without recipes. Browser QA on a test world found two bugs, fixed before the switch: "Go there" stopped after one 24-tile walk, and the once-a-day teaching refusal read badly.
- Cheaper holiday stock: Halloween's costumes and decor cost half, from a logged `lower_holiday_prices` the Worker turns on ([decision 0210](../decisions/0210-halloween-s-costumes-and-decor-cost-half-from-a-logged-lower.md)).
- Show your owner: public pictures by link at `/og/plot`, `/og/look`, `/og/near` ([0160](../decisions/0160-pictures-by-link-are-public-cached-pngs-of-a-plot-a-look-and.md)), `links` on profiles, plots, posts and check-in items ([0161](../decisions/0161-api-responses-carry-links-to-share-built-from-ids-and-coordi.md)), deep links `/world?at=` with `&view=3d` ([0162](../decisions/0162-a-link-into-the-world-only-looks-and-going-there-is-a-tap.md)). The client build strips schema descriptions to stay under the first-load budget ([0163](../decisions/0163-the-client-build-drops-the-protocol-schemas-descriptions.md)).
- Townsfolk chatter on Claude Haiku 5.5 under a $0.28 daily dollar cap, 3 townsfolk a run, 2 Sonnet compare drafts a day on the staff townsfolk page, and @mention answers on the next minute sweep ([decision 0190](../decisions/0190-townsfolk-chatter-runs-on-haiku-5-5-under-a-daily-dollar-cap.md)).
- PR #47 reworked and merged: unique names at join with look-alikes caught, a confirm step on the join link, maintainers can re-key any agent, repeat joins left out of counts ([0148](../decisions/0148-resident-names-are-unique-at-join.md), [0149](../decisions/0149-a-maintainer-can-re-key-any-agent-and-the-trade-turns-off-wh.md)). Issue #46 stays open for the old duplicate records.
- Tests: e2e slimmed (local run 2:41 to about 1:05, 3D nightly with one per-push smoke, CI skips e2e on sim, scripts and docs pushes, a red-run ledger in `e2e/red-runs.md`, and a gate plus budget that `pnpm verify` enforces, [decision 0200](../decisions/0200-e2e-keeps-only-journeys-a-lower-test-can-t-prove-with-a-budg.md)). Unit audits removed or merged 82 low-value tests across sim, server and the client side with coverage unchanged, fixed a flaky notice-board test and two putter tests that could never fail, and added a "Writing tests" section to each package's AGENTS.md and the reviewer.

## State of things

- The CI deploy condition from decision 0200 ran on GitHub for the first time with these pushes. If deploys stop, look at the `changes` job and the `deploy` job's `if:` in `.github/workflows/ci.yml` first.
- On terrakin.org, `open_recipes` and `lower_holiday_prices` are logged on the World object's first tick after the deploy. `GET /v1/world` shows `recipesOpen: true` once it has.
- The unit audits stopped well short of their 15 to 20% target (2 to 3% each): most tests are table rows over real contracts, money guards, or replay pins. Each report's reasoning is in this session's transcript.
- The sim keeps about 6 exact duplicate fixture-hash checks under the rule that fixture tests stay.
- `GET /v1/catalog` and SKILL.md quote terrakin.org's holiday prices even on worlds without the switch; `GET /v1/shop` always has the world's own.

## Next

1. Read the staff townsfolk page's Sonnet and Haiku draft pairs and decide whether Haiku's voice holds; turn the compare off with `TERRAKIN_CHATTER_COMPARE=0` once decided.
2. A week after deploy, read the staff Newcomers page against the funnel baseline (decision 0141).
3. Run the server tests with `isolate: false` (about half the wall time) once `snapshots.test.ts` and `agent-links-lag.test.ts` stop relying on `vi.mock("./telemetry")`.
4. Cut the e2e jobs' `playwright install --with-deps` time, now the largest share of a CI e2e job (decision 0200).
5. Nothing pages anyone when the nightly 3D run goes red; add an alert or a check-in line.

## Open questions

- Ryan: delete the sim's exact duplicate fixture-hash checks?
- Ryan: issue #46 asks for the existing duplicate records to be dealt with; they're left out of counts now, but still in `residents`.
