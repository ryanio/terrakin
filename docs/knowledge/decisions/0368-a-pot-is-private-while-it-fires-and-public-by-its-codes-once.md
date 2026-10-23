---
title: A pot is private while it fires and public by its codes once it is out of the kiln
date: 2026-10-23
status: accepted
tags: [sim, server, protocol, client]
---

# A pot is private while it fires and public by its codes once it is out of the kiln

## Context

A second fresh agent played pottery cold, still switched off, and scored it 5 out of 10. A rare pot came out of the kiln and nobody else heard of it, tea served at an event where nobody was counted went nowhere, and a newcomer with one pond often found no clay three days running.

Until now `kiln_emptied` said only where and who: the kiln, `by`, nothing about the pot. The pot went into its loader's private things. For the home wall to say "Wren fired an iridescent sea vase", something public has to carry the pot.

No live world has logged `open_clay`, so the event's shape and the rules behind it can change without moving `REPLAY_VERSION`.

## Decision

- **Firing is private, out is public.** While a pot fires, only its loader sees what's in it (`kilns` on the inventory). Once it's taken out, `kiln_emptied` carries `pot`: its kind, glaze, finish and maker, never its label or id. That's what anyone would see once it's set down or listed, and the finish is luck the town can enjoy with its maker. A label stays its maker's words and goes out only where it always did, marked untrusted.
- **The home wall hears rare pots.** The server keeps the crackle and iridescent pots out of kilns in the last day in memory and puts them on the snapshot as `rarePots`. The wall names each by its maker and codes. A restart forgets them, which is fine for news.
- **Tea counts the same guests as the record.** Whether a cup reaches someone is the hosting record's rule (`guestProblem` in `packages/server/src/events.ts`, which `countGuests` uses too): ages, a hearth, households, the plot's own, circle kin, two hosts a day, and blocks. Ages and blocks live in the server, so the refusal for serving to nobody is the server's, checked before anything is logged, and the sim keeps a backstop: a `credit_event` with no guests at an event with tea gives the pot back (`tea_kept`). A block is never named; that guest is left out of the list.
- **A dug pond always has clay.** Each pond has `POTTERY.springsPerPond` (2) tiles beside it that hold clay every day, picked by a roll of the tile and day, so a newcomer's start is steady and moving a pond can't farm more than the daily cap of 6.
- **A pot handed in is shown.** The server keeps each pot handed in for a job (`town_pots`), and the shop lists the newest as "Pots from the town's potters".

## Consequences

- Anyone can learn a pot's finish the moment it's out, before it's set down or listed. A potter who wanted a rare pot kept quiet can't. That seems a fair price for the town sharing the moment.
- The economy run with `--kiln`: an engaged potter picks up 3.57 clay a day (1.31 before the springs) and takes out 1.00 pot a day, the kiln's own limit. 68% of potters have a kiln in their first week. Supply per active resident is 292, against 293 before; the clay cap and the one-pot kiln keep it from flooding.

Code: `packages/sim/src/gather.ts` (`springsOf`, `onSpring`), `packages/sim/src/pottery.ts` (`checkOpenKiln`, `pourTea`), `packages/server/src/events.ts` (`guestProblem`, `teaGuests`, `teaRefusal`), `packages/server/src/world-actions.ts` (`bringDish`), `packages/server/src/world-service.ts` (`rarePots`, `onTeaServed`, `onPotHandedIn`), `packages/server/src/town-pots.ts`, `packages/client/src/pulse.ts` (`potNews`).
