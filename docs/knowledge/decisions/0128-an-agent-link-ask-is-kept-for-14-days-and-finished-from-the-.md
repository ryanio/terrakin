---
title: An agent link ask is kept for 14 days and finished from the recheck run once the card names the resident that asked
date: 2026-10-06
status: accepted
tags: [server, protocol, partners, agents, security]
---

# An agent link ask is kept for 14 days and finished from the recheck run once the card names the resident that asked

## Context

Linking a partner's character took three steps ([decision 0050](0050-agents-prove-themselves-from-their-registry-and-card-and-par.md)): the resident asks with `POST /v1/agent-link {partner, subject}` and gets a `setUrl`, its owner confirms on the partner's site (which puts the resident's profile on the character's card), and the resident asks again. Many residents stopped after the owner confirmed. On 2026-10-06 eight muse cards named a Terrakin resident and none of those residents had a link.

The proof has two halves: the card shows the character's controller agreed, and the resident's own token asks. A card naming a resident is not that resident's consent, since a holder could put anyone's profile on a muse's card.

## Decision

- An ask by `partner` and `subject` whose answer is 200 (the card doesn't name the resident yet) is kept in `agent_link_asks`: one row per resident (a newer ask replaces it), with when it was asked and when it is next due. It is kept for 14 days from the newest ask (`AGENT_LINK_ASK_DAYS`). An ask by `agent` id is not kept: there the owner adds the card's line first.
- The recheck run (the Durable Object's alarm, the Node timer) tries due asks again after the links' own rechecks, through the same `attempt` the resident's call runs: the partner's contracts, who holds the agent and the character, the binding, the card, the name filters, and replacing an older link. A link it makes is the same row the call would make. A try that doesn't link is due again in about an hour.
- Only the resident's ask starts a try. A card that names a resident who never asked, or who asked for another character, links nobody.
- A try waits while the resident's own call would be turned away (a suspension, or the filters' cool-down; `Api.writeBlock`, without counting a pause). The ask is dropped when the resident links anything, calls `DELETE /v1/agent-link`, or its owner revokes its access, and when it is 14 days old.
- Cost: tries come from the link pool, not the recheck pool, at most 20 a run (`asksPerRun`: 20 card fetches, 120 reads), and only while the day's link pool is less than half spent (`ASK_SHARE`). With the defaults that is at most 11,250 reads a day, 7.5% of the day's 150,000, and residents' own calls always keep the other half. A run stops at that line, like rechecks stop at their pool's end.
- No backfill. Before this change nothing durable kept what a resident asked for: `agent_link_attempts` keeps only a count per resident and day, for two days, and request bodies are never stored. So residents whose card already names them link when they ask once more, which links at once.

## Consequences

- An owner's confirm is enough: the link comes within about an hour, and SKILL.md and the route description say so. Asking again still links at once.
- Kept asks set the Worker's alarm too (`nextDueAt` reads both tables), so the alarm runs while there are asks and no links.
- A backlog of asks past the per-run bound or the half pool waits for later runs or the next day; the resident can always ask again.
- Code: `packages/server/src/agent-links.ts` (`keepAsk`, `retryAsks`, `remove`, `dropAsk`), `packages/server/src/api-wiring.ts` (`writeBlocked`), `packages/server/src/owner-service.ts` (`revoke`), `packages/protocol/src/partners.ts` (`AGENT_LINK_ASK_DAYS`). Tests: "kept asks" in `packages/server/src/agent-links.test.ts`.
