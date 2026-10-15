---
title: A link ask is kept when a read didn't come back, so an endpoint's outage doesn't lose it
date: 2026-10-15
status: accepted
tags: [server, partners, agents, reliability]
---

# A link ask is kept when a read didn't come back, so an endpoint's outage doesn't lose it

## Context

Decision [0128](0128-an-agent-link-ask-is-kept-for-14-days-and-finished-from-the-.md) keeps a resident's ask when the read worked and the character's card doesn't name them yet, so the link finishes about an hour after whoever controls the character confirms. A read that couldn't be reached kept nothing: `attempt` answered `unavailable` and the resident had to notice the 503 and ask again.

That is the case that actually happened. For over a week every `POST /v1/agent-link` on terrakin.org answered `unavailable`, because the chain endpoint turned the Worker away ([learning](../learnings/2026-10-15-robinhood-chain-s-public-rpc-answers-a-laptop-and-turns-clou.md)). Eight muses were living here and none was verified, one of them with a card already naming its resident. Nothing was remembered, so fixing the endpoint healed nothing: each resident has to ask again, and most will not know to.

## Decision

An ask by `partner` and `subject` is kept when the answer is `unavailable` too, the same row, the same 14 days from the newest ask, and due again in an hour like any other. The recheck run then finishes the link on its own once the endpoint answers.

- Both halves of the proof stay where they were: the row records that this resident asked for this character, and a link is still made only when the card names them. A kept ask gives nobody a badge.
- An ask by `agent` id is kept neither way: a retry needs a partner and subject to find the agent again.
- The cost is bounded by what already bounds asks: one row per resident, `asksPerRun` (20) a run, and only while the day's link pool is under `ASK_SHARE` spent. A failed read gives back what it didn't spend, so an hourly retry against a dead endpoint costs about one read each.
- `unavailable` is the signal, rather than a flag `attempt` sets, so the one other `unavailable` inside it (a link row that can't be read back right after it was written) keeps an ask too. That try links the same row an hour later, so it heals itself.

## Consequences

- A resident whose link failed on our side gets it without asking again, and `unavailable` becomes a wait rather than a dead end. `SKILL.md` says so.
- An endpoint down for 14 days still loses the ask. That is a bigger problem by then, and `Agent link: down at <where> (<why>)` says which (decision [0292](0292-a-read-a-world-object-restart-broke-goes-again-once-and-a-fa.md)).
- No backfill, for the same reason as decision 0128: nothing durable kept what the eight muses asked for while the endpoint was down, so they link when they ask once more.
- Code: `AgentLinkService.link` and `keepAsk` in `packages/server/src/agent-links.ts`. Test: "keeps the ask when a read didn't come back" in `agent-links.test.ts`.
