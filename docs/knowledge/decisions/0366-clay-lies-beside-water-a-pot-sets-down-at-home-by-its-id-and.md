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
- **The rate.** The economy run's potters dig a tile of pond on open ground on their plot. Once they have a kiln and the pond, they pick up 1.31 clay a day near home and take out 0.53 pots a day: a pot every day or two, the target.
- **A kiln takes 2 stone.** Stone was the bottleneck: at 4, potters spent their first week walking for it. The run's first-week check, of potters with a week or more in the month: at 3 stone 16 of 32 had a kiln within their first week (50%), at 2 stone 28 of 34 (82%), with a median of 1 day from starting to a kiln. So a kiln costs what a tile of pond does. A world whose clay came by the first rule keeps 4 (`POTTERY.kilnStoneFirstRule`), so the kiln fixture's hash holds.
- **What the cheaper kiln costs the money supply.** The month ends at 293 coins per active resident against 301 without pottery, 2.7% lower, which misses the RFC's first check (within 2%); at 3 stone it was 294 (2.3%), and at 4 stone 296 (1.7%). The gap is the recipe cards: supply is 954 coins lower (40,414 against 41,368), and potters burned 985 coins on the vase's and the teapot's cards, 22.9 each, because more of them got far enough to want one. Nothing is minted: the town paid 13,834 for goods against 13,871 (no higher), and the town buys no pottery or cups. We keep 2 stone, because the check exists to catch coins appearing, and this is the small sink the RFC planned, paid once per resident per card. If the 2% line should hold anyway, the lever is the cards' prices (20 and 25), not the kiln.
- **A pot sets down as itself.** `place` with `block: "pot"` and the pot's `item` id, rather than a pedestal or a `display` on an empty tile, because `place` already holds every rule about where a block may go: your plot, reach, a public way, a hearth, someone standing there, and upstairs with its support. The good lives in `items.pots` by tile and floor; `remove` gives it back. One block kind, `pot`, is drawn from the good, so a new pot kind needs no new block. A placed pot is not on display: it is decor in a home, not admired or in a gallery.
- **A vase's flower stays with the vase.** It goes on the good as `flower` when the vase is set down, so it travels with the vase when it's given or listed, and is drawn wherever the vase is. There's no taking it back out.
- **Tea goes through `bring_dish`.** A pot of tea is a kitchen recipe of 2 herbs that needs a teapot in your things and keeps it. The host of a live event serves one with `bring_dish`, the feast's command, so no new command is needed, and `credit_event` pays the host 1 more Hosting point a counted guest. It is in the pottery family so a world without clay shows it nowhere, and `isDish` takes it by name.
- **Jobs are a third edition.** The second edition's table plus a bowl for Clem and a vase for Ansel, each up only once clay is out, so a world on it without clay reads the second edition's boards. The server moves the board with its `clay` option one edition a `new_day`, so a world still on the first edition reads the second for a day and never skips it, and switching pottery on stays one line.
- **Every finish shows before it is yours.** The kiln sheet ends with a pot in the picked glaze in each finish and its odds (79, 15, 5, and 1 in 100), and the book's Finishes page draws each one faint with its odds until a pot of yours has it. The odds stay where they are: the run gives an engaged potter a pot every day or two, so about one iridescent pot in six months of firing and a crackle one every month or so: rare enough for a badge, and the faint page says what to hope for.
- **A guest takes the tea home.** At an event whose host served tea, each guest the credit counts gets a `cup_of_tea` the host made, a pottery keepsake with no recipe, like a piece of art. It is what a guest feels of the tea; it is worth no coins and the town doesn't buy it, so it adds nothing to supply.
- **A pot set down is news.** The Visit page's line (RFC 0020) counts pots set down apart from blocks and says "A pot set down today", below blocks going up. That is what RFC 0020 already reads, a count in `plot_news` with its column added on boot, so a home with new pots draws visitors without a new score. Admiring stays a person's tap on the plot.
- **The book's pages are server rows.** Glazes and finishes are shelves in the collection table beside things and wear, with the iridescent pot as a badge of its own rather than a group.

## Consequences

- A world without `open_clay` reads exactly as before: `pottery.test.ts` (server) pins `clayByWater`, `pots`, the book's pages and the rest absent, and every fixture hash is unchanged, so `REPLAY_VERSION` stays.
- Switching pottery on is still `clay: true` in `packages/server/cloudflare/worker.ts`; the jobs edition follows on its own, a step a day.
- A pot set down is not admired on its own, reported as a display, or listed in a gallery; it counts toward a plot through its news line. If more is wanted, `items.pots` would join `everyGood`'s readers in `display.ts`.
- Clay on an island's long shore could still be plentiful; the daily cap bounds what one resident takes.

Code: `packages/sim/src/pottery.ts`, `packages/sim/src/gather.ts` (`clayRule`, `byWater`, the cap), `packages/sim/src/thanksgiving.ts` (`checkServeTea`), `packages/sim/src/jobs.ts` (`POTTERY_JOB_EDITION`), `packages/server/src/collection.ts` (`potteryPages`), `packages/server/src/links/making.ts`, `scripts/economy-sim.ts`.
