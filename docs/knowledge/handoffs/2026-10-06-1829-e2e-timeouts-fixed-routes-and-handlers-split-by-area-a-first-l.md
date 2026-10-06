---
title: e2e timeouts fixed, routes and handlers split by area, a first-load budget, agent-link diagnostics
date: 2026-10-06
tags: [ci, e2e, protocol, server, client, performance, agents]
---

# e2e timeouts fixed, routes and handlers split by area, a first-load budget, agent-link diagnostics

## Done

- e2e timeouts that kept main red and blocked deploys: `three-d.spec.ts` and `shop.spec.ts` are serial tests that share what the first one sets up, and every test has 60 seconds on CI and 30 locally ([decision 0109](../decisions/0109-ci-gives-each-e2e-test-60-seconds-and-a-laptop-still-30.md)).
- `pnpm kb new decision` numbers past the newest decision on `origin/main`, and `pnpm kb:check` fails when two decisions or two RFCs share a number (0052 and RFC 0004 are allowed, since prose cites both).
- The route table is one file per area in `protocol/src/route-table/`, joined in order by `routes.ts`, and the handlers are in `server/src/handlers/` by the same areas, typed by `AreaRouteIds`. Generated output is byte-identical, and the `reviewer` agent found no behavior change.
- `@terrakin/protocol` is `"sideEffects": false`, which took 22 kB off the client's first load, and the client build fails past `FIRST_LOAD_BUDGET` ([decision 0110](../decisions/0110-the-first-page-load-has-a-gzipped-size-budget-the-build-enfo.md)).
- An agent link that can't be read logs `Agent link: down at registry`, `partner`, or `card`, and the `agent_link.check` count carries the same `where`.

## State of things

- When this was written, CI for `cb36b0cf` (the last code commit) was still running. The three e2e timeouts that failed main earlier that day are fixed and pass locally; check `gh run list --branch main` before assuming main is green.
- On terrakin.org, every `POST /v1/agent-link` in the three days to 2026-10-06 answered 503 or 429; none linked. The public Robinhood Chain RPC and a real agent card both answer from a laptop, so the failure is on the Worker's side of one of those reads. The new log line will name which.
- Workers logs show `Replay diverged at entry 2474: not_joined` 21 times, all from one earlier Worker version. The live world boots and serves at seq 3321, so it's past, but it is the failure the snapshot handoff warns about when a version meets a log it can't replay.
- Townsfolk chatter is still a dry run: in the two days to 2026-10-06, 3 runs logged, each drafting 3 replies and no posts. The drafts are only on admin.terrakin.org.
- A package move (every workspace package under `packages/`) was in flight in another session; it rebases onto the split above.

## Next

1. After the next agent-link attempt, read the Workers logs for `Agent link: down at`. If it's `card`, check what the card host answers a Cloudflare Worker (a bot challenge would look like this); if `registry`, the RPC.
2. Load views per page to bring the first load down from 204.7 kB, then lower `FIRST_LOAD_BUDGET` to match (a task chip with the details was offered this session).

## Open questions

- Ryan: read the chatter drafts on admin.terrakin.org and decide whether `TERRAKIN_CHATTER_MODE` goes to `posts`.
