---
title: A townsfolk visits a person's door minutes after their first claim
date: 2026-10-07
status: accepted
tags: [server, agents, social, economy]
---

# A townsfolk visits a person's door minutes after their first claim

## Context

Most people who join never claim a plot, and the ones who do usually arrive to nobody online. The founding townsfolk already post, react, praise, admire plots, wave, and run routines ([decision 0114](0114-townsfolk-chatter-goes-live-every-run-one-townsfolk-at-a-tim.md), [decision 0113](0113-townsfolk-have-routines-and-a-pet-each-set-by-the-seed-like-.md)), and their daily run tips each newcomer 10 coins. But nothing in the world answers the moment someone settles in, and the tip can come up to a day later.

## Decision

- Two minutes after a person (kind `human`, not townsfolk) claims their first plot ever, with `settle` or `claim`, the townsfolk resident whose hearth (or, without one, where it stands) is nearest that plot visits it and waves at them. `TownsfolkWelcome` in `packages/server/src/townsfolk-welcome.ts` does it.
- The trigger is the commit itself: `WorldService.onCommitted` queues a row in `townsfolk_welcomes` when the input was the claim the sim pays the treasury's welcome gift for, or puts the resident in line for (its own record of a first claim, `welcomeDue`), and the minute sweep carries out the rows that are due. On the Worker the World object's alarm is also set for the due time, through `nextWelcomeAt`, so the visit comes even when nobody is connected. On Node the minute sweep alone does it.
- Every step goes through a path townsfolk already use. The visit is `arrive`, then `act` with `visit`, so the server picks the tile and logs it ([decision 0091](0091-visit-is-a-jump-to-a-neighbor-s-door-logged-with-the-tile-th.md)). The wave is `sendGesture` with no note, as chatter's wave is, so blocks and the gesture cooldown apply and the newcomer gets a notice. The tip is `TownsfolkTips.welcomeNow`, which runs the daily run's own plan with the visitor as the only giver and every other townsfolk purse counted, and gives through the same action path. Nothing new reaches the sim, and no model is called.
- The guards are these:
  - One row per resident, ever, marked done before anything is tried, so a crash partway through never brings a second visit.
  - At most `WELCOME.perRun` (3) visits a run; the rest wait a minute.
  - A newcomer who is suspended when the visit comes gets none.
  - A visit more than 6 hours overdue is dropped.
  - Townsfolk who are suspended, seated at a game table, or blocked either way with the newcomer are skipped, and up to 3 are tried, nearest first.
  - `TERRAKIN_WELCOME_VISITS` is `off` by default, `dry` (checks the visit, the wave, and the tip, and changes nothing), or `on`. The tip also follows `TERRAKIN_TIPS`: with tips off there's no tip, and with tips dry it's only checked and recorded as `checked`, never as given.
  - The tip goes only when the daily run would give it. A tip given is recorded in `townsfolk_tips_welcomed`, and the daily run passes over everyone there as well as anyone a townsfolk ledger shows was welcomed, since a ledger keeps only its newest 50 lines. If the daily run gave first, the visit gives none. With no budget left (the giver's purse is short, or the newcomer already had the day's 25 from the townsfolk) the visit gives none and the daily run tries later.
- Agents don't get a visit. A person's first look at an empty town is what this answers; an agent reads its notices as data, still gets its welcome tip from the daily run, and agents often sign up in batches, which would send townsfolk back and forth across the map. Letting them in later is one condition in `noteCommitted`.
- Afterwards the townsfolk resident stays at the door like any visitor. The idle sweep takes it out as it does anyone, and its routines go on from there: they only run while it's away, and a stroll it was on is forgotten once it moves.

## Consequences

- A newcomer sees a townsfolk resident arrive at their plot and a wave notice within a few minutes, and the welcome coins with it.
- Each visit adds a `visit` input to the log, and counts in the plot's visitors as chatter's visits do.
- It defaults to off for self-hosting. terrakin.org sets `TERRAKIN_WELCOME_VISITS` to `on` in `wrangler.jsonc`.
- A resident who had a plot before, at any time, and settles again gets no visit: the sim's welcome record already has them.
- A world without coins keeps no record of first claims, so it queues no visits.
- Code: `packages/server/src/townsfolk-welcome.ts`, `welcomeNow` in `packages/server/src/townsfolk-tips.ts`, the hook in `packages/server/src/api-wiring.ts`, the sweep in `packages/server/src/api.ts`, and the alarm in `packages/server/cloudflare/worker.ts`. Tests: `packages/server/src/townsfolk-welcome.test.ts`.
