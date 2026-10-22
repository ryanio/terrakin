---
title: Clay lies beside water, a pot sets down at home by its id, and tea and jobs give pottery a use
date: 2026-10-22
status: accepted
tags: [sim, server, protocol, client, economy]
---

# Clay lies beside water, a pot sets down at home by its id, and tea and jobs give pottery a use

## Context

The kiln of [RFC 0047](../../rfcs/0047-trades-and-your-mark.md) phase 1 was built behind `open_clay` ([decision 0362](0362-the-kiln-is-built-behind-open-clay-which-no-adapter-sets-unt.md)). It worked, but firing a pot led nowhere: a pot could go on a pedestal, be given, or be listed. And clay lay on a quarter of all meadow and sand every day, so it was wallpaper rather than something to spot. Ryan wants pottery switched on only once it's something people would love, so it stays off while it gets a place in the rest of the town.

No live world has logged `open_clay`, but the kiln fixture's log has, and its hash is pinned.

## Decision

- **Clay lies beside water.** `open_clay` gains `water`, which the server always sends. With it, clay lies only on a tile next to a pond or the sea (any of the eight ways), at 0.2 a tile a day, where nothing else would lie, and a resident picks up at most 6 a day (`clay_limit`). The cap is there because a pond costs 2 stone and gives them back, so moving one about would otherwise lay fresh clay round it at every stop. An `open_clay` without `water` keeps the first rule, so the kiln fixture replays to its hash; nothing else has it.
- **The rate.** The economy run's potters dig a tile of pond on open ground on their plot. Once they have a kiln and the pond, they pick up 1.34 clay a day near home and take out 0.59 pots a day: a pot every day or two, the target. The month ends at 296 coins per active resident against 301 without pottery (1.7% lower, within the RFC's 2%), and the town paid 13,715 for goods against 13,871.
- **A pot sets down as itself.** `place` with `block: "pot"` and the pot's `item` id, rather than a pedestal or a `display` on an empty tile, because `place` already holds every rule about where a block may go: your plot, reach, a public way, a hearth, someone standing there, and upstairs with its support. The good lives in `items.pots` by tile and floor; `remove` gives it back. One block kind, `pot`, is drawn from the good, so a new pot kind needs no new block. A placed pot is not on display: it is decor in a home, not admired or in a gallery.
- **A vase's flower stays with the vase.** It goes on the good as `flower` when the vase is set down, so it travels with the vase when it's given or listed, and is drawn wherever the vase is. There's no taking it back out.
- **Tea goes through `bring_dish`.** A pot of tea is a kitchen recipe of 2 herbs that needs a teapot in your things and keeps it. The host of a live event serves one with `bring_dish`, the feast's command, so no new command is needed, and `credit_event` pays the host 1 more Hosting point a counted guest. It is in the pottery family so a world without clay shows it nowhere, and `isDish` takes it by name.
- **Jobs are a third edition.** The second edition's table plus a bowl for Clem and a vase for Ansel, each up only once clay is out, so a world on it without clay reads the second edition's boards. The server moves the board to it with its `clay` option on the first `new_day` after clay opens, so switching pottery on stays one line.
- **The book's pages are server rows.** Glazes and finishes are shelves in the collection table beside things and wear, with the iridescent pot as a badge of its own rather than a group.

## Consequences

- A world without `open_clay` reads exactly as before: `pottery.test.ts` (server) pins `clayByWater`, `pots`, the book's pages and the rest absent, and every fixture hash is unchanged, so `REPLAY_VERSION` stays.
- Switching pottery on is still `clay: true` in `packages/server/cloudflare/worker.ts`; the jobs edition follows on its own.
- A pot set down is not admired, reported as a display, or listed in a gallery. If that's wanted, `items.pots` would join `everyGood`'s readers in `display.ts`.
- Clay on an island's long shore could still be plentiful; the daily cap bounds what one resident takes.

Code: `packages/sim/src/pottery.ts`, `packages/sim/src/gather.ts` (`clayRule`, `byWater`, the cap), `packages/sim/src/thanksgiving.ts` (`checkServeTea`), `packages/sim/src/jobs.ts` (`POTTERY_JOB_EDITION`), `packages/server/src/collection.ts` (`potteryPages`), `packages/server/src/links/making.ts`, `scripts/economy-sim.ts`.
