---
title: Test residents are built through real actions, with a test-only grant for coins and things
date: 2026-10-07
status: accepted
tags: [testing, tooling, economy]
---

# Test residents are built through real actions, with a test-only grant for coins and things

## Context

Checking a change by hand or with a browser tool needs a resident at the right stage: settled on a plot to see Build, holding things to see the kitchen sheet, a maintainer to see staff buttons. A fresh `POST /v1/session` gives none of that, and real play takes days to reach most of it. E2e specs had the same problem and each built its residents its own way, often by hand-sending the same actions.

Coins and things are the hard part. They live in the sim's world state, which only changes through logged commands, and the sim keeps `sum(coins) + treasury + held == minted - burned` after every input.

## Decision

`e2e/personas.ts` builds a resident to a named stage (`visitor`, `settled`, `stocked`, `pet`, `staff`, `owner`) or a spec, over any HTTP client. Joining, settling, the starter home, a pet, and an AI's owner link go through the same API a person or agent uses. Only coins and things come from a new server-only sim command, `test_grant {to, coins?, stacks?}`, and staff from the existing maintainer hook.

`test_grant` moves coins out of the treasury with the ledger reason `grant`, so nothing is minted and the supply identity holds without a special case. It adds stack kinds only (made goods still come from making), up to the inventory cap. Only `TOWN_ACTOR` may send it, and the server sends it only from `POST /v1/test/grant`, which exists when the Node server runs with `TERRAKIN_TEST_CLOCK=1` (refused at boot with `NODE_ENV=production`), answers loopback callers only, and sits outside the route table. The Worker has no way to turn it on, and a test checks its source never mentions it.

`pnpm dev:test` runs a test world beside a plain `pnpm dev`: server on 8797, client on 5183, test routes on, kept in the gitignored `.dev-test-world/` so a watcher restart keeps its residents. `pnpm persona <stage>` makes a resident there and prints the line of JavaScript that signs a tab in as them. Specs use the same builder through `persona` in `e2e/support.ts`.

## Consequences

- An agent can see a change as a settled, stocked, or staff resident in one command, instead of guessing or skipping the check.
- The sim gains one command no production log will ever hold. It's in `SERVER_COMMANDS`, so residents can never send it, and the protocol's action schema doesn't list it.
- Granted lines read like real ones: coins as a Town Hall grant in the purse, things as bought from the shop. That's fine in a test world, but a spec that checks purse lines or the things feed for a persona should expect them.
- A grant can't mint, so a test world's treasury can run dry after many large grants. The grant says so (`not_enough_coins`); restart the test world (`rm -rf .dev-test-world`) or ask for less.
- Things a grant can't give (made goods, pieces, finds) still need the real actions, which is where specs that test those flows should get them anyway.
- `packages/sim/src/test-grant.ts`, `packages/server/src/app.ts` (`TEST_GRANT_PATH`), `e2e/personas.ts`, `scripts/persona.ts`.
