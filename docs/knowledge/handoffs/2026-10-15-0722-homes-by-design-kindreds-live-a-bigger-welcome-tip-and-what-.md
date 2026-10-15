---
title: Homes by design, kindreds live, a bigger welcome tip, and what to read next
date: 2026-10-15
tags: [homes, kindreds, economy, chatter, plans]
---

# Homes by design, kindreds live, a bigger welcome tip, and what to read next

## Done

- Chatter's refusals stopped after `e7bfb715`. In Worker logs, wave misses (`target: wave, not_allowed`) went from 27 of 43 answers in the 20 hours before the deploy to 1 of 44 after, and townsfolk waved 5 times where they had waved none. The only other refusals were 2 `too_long`.
- `1430ca32`, `693d11d4`: homes agents can design, [RFC 0032](../../rfcs/0032-homes-agents-can-design.md) built. Plot maps on `build` and the plan read, notes on every build answer, nine designs at `GET /v1/designs`, and on the web the designs in a new resident's home sheet, notes in the build bar, and maps on link pages (decisions 0280 to 0282 and 0286). No sim rule changed.
- `c06dfd41`, `5411606a`, `894a9823`, `b49cd0d6`: kindreds, [RFC 0033](../../rfcs/0033-kindreds.md) built and on at terrakin.org, with the RFC's recommended answers to all nine questions (decisions 0279 and 0283 to 0285). Kindred-mates still earn appreciation from each other: a kindred of 12 adds about 4.5% to the median member's coins, and the 24% case is a reaction ring twelve friends can already run without kindreds (Ryan, 2026-10-14).
- `6af6b7d9`, `e3ab00f9`: [decision 0278](../decisions/0278-coin-flow-the-townsfolk-welcome-tip-rises-to-25-and-jobs-sti.md), accepted. The townsfolk welcome tip is 25, so a newcomer's first day brings 75. Jobs still pay no coins. The economy sim gained flags to play coin-flow options (`scripts/coin-flow.ts`).
- `d3396280`: RFC status lines for 0021, 0022, 0023, and 0031. The event toast's Go was tapped on a phone viewport and works, so it needed no change.
- [plans/README.md](../../plans/README.md) has a Now and next section.

## State of things

- Everything above is on main and CI passed through `e3ab00f9`. Nobody has looked at kindreds or the designs on the live site yet.
- No kindred exists yet. One forms only once its members come from three households.

## Next

1. Around 2026-10-19, read the Newcomers page in the staff app: of people with a hearth, the share with a first thing (3 of 10 before), first jobs in a first week, and whether plot names and handles still get set. The bigger welcome tip and the designs in the home sheet both land in this window, so a change can't be pinned on one of them.
2. Then read the market since the Sell form began naming what the town buys, and decide whether the home wall shows newcomers a job.
3. Around 2026-10-24, the Halloween devlog.
4. Early November, read kindreds: how many formed and how many weeks each gathered. That decides between a garden corner, ask-to-join, and hall decorations, or nothing more.
5. Check how many agents build from a design or a map in the first week (`design` or `map` on `build` in the log).

## Open questions

- Whether the unused systems (bounties, teaching, Town Hall proposals, residents' events) need a push or a pause before anything new is added.
- The launch post and the listing are staged and unsent. Ryan sends them.
