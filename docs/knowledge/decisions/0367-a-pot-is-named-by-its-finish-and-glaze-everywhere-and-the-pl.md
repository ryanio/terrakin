---
title: A pot is named by its finish and glaze everywhere, and the plain finish is smooth
date: 2026-10-23
status: accepted
tags: [sim, server, protocol, client]
---

# A pot is named by its finish and glaze everywhere, and the plain finish is smooth

## Context

A fresh agent played pottery cold, still switched off, and scored it 6 out of 10. The parts worked, but the moment a pot came out of the kiln fell flat: one toast line, merged with the day's coins and pantry. A pot was described differently in each place. The web said "Smooth" where the API said `plain`, your things showed "Bare clay" with no finish, and market listings dropped the glaze and finish altogether, so a collector couldn't see what they were buying.

No live world has logged `open_clay`. Only the kiln fixture's log holds a fired pot, and a finish's name is part of the world's hash.

## Decision

- **One name, from codes.** The sim's `potName` says a pot as its finish, its glaze ("clay" when bare), its kind, and a vase's flowers: "Speckled rose vase of tulips". The `harvest` answer's `fired`, the check-in, plot news, market listings, the `pot_sold` notice, the craft link, and every place on the web use it. It never reads a label.
- **`plain` is `smooth`.** We renamed the code rather than making the web say "plain", because "Smooth clay bowl" is what the web always said and what reads well. The rename moves the kiln fixture's hash (`ad27995d` to `91280811`). `REPLAY_VERSION` doesn't move, because no live world has logged a harvest at a kiln, and a snapshot only a local test world could hold isn't worth a version. A local test world that fired pots before the rename can boot from a snapshot holding `plain`, so wipe it.
- **The reveal is the kiln sheet's.** Taking a pot out goes over REST so the sheet gets its `fired` answer and stays open, showing the pot large in its glaze and finish, its name, and its odds. A crackle or iridescent pot gets a ring of sparkles, which stays, still, under reduced motion. The world's toast leaves a fired pot out, so it's never one line among the coins.
- **Pottery's jobs take turns like a holiday's.** In the third edition, once clay is out, the bowl and vase jobs take every other turn of Making's lane (`takesTurns`), so one is up in any week outside a holiday. Only the third edition has them, and no live world reads it.
- **`hand_in` gives the commonest finish first.** A job never takes your rarest pot unless you name it.
- **Two notices.** `pot_sold` comes from Terrakin, with the pot's codes and numbers and never its buyer. `tea_poured` comes from the host through `notify`, so blocks apply. Neither carries words.

## Consequences

- Naming lives in one function, so a new pot kind, glaze, or flower is named everywhere at once.
- The economy run's Making points move a little with the jobs' turns. The supply check isn't affected, since jobs pay points, not coins.
- A guest whose things were full gets the cup held aside and no `tea_poured` notice, because the hook reads the `inventory` event, and a cup held aside has none.

Code: `packages/sim/src/pottery.ts` (`potName`, `RARE_FINISHES`), `packages/sim/src/jobs.ts` (`takesTurns`, `finishRank`), `packages/sim/src/fixtures/kiln-log.ts`, `packages/server/src/world-service.ts` (`firedOf`, `potsSold`), `packages/server/src/plot-news.ts`, `packages/client/src/garden-sheet.ts`.
