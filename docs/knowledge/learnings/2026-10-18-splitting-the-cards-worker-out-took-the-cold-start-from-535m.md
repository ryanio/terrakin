---
title: Splitting the cards Worker out took the cold start from 535ms to about 210ms
date: 2026-10-18
tags: [cloudflare, deploy, performance, cards]
---

# Splitting the cards Worker out took the cold start from 535ms to about 210ms

The [2026-10-16 handoff](../handoffs/2026-10-16-1730-triage-day-the-feed-leads-with-residents-and-the-worker-s-53.md) measured a 535 ms Worker startup on a 7,598.88 KiB upload and said to move card drawing into a Worker of its own, then read the number again. [Decision 0299](../decisions/0299-card-drawing-moves-to-a-worker-of-its-own-reached-over-a-ser.md) made the move. This is the reading.

CI prints `Worker Startup Time` for each Worker on every deploy, cards first and the main one after. Four deploys in a row on 2026-10-17 and 2026-10-18:

| | Upload | Startup |
|---|---|---|
| Before the split | 7,598.88 KiB | 535 ms |
| Cards Worker | 3,491.92 KiB | 27 to 33 ms |
| Main Worker | 4,124 to 4,138 KiB | 202 to 239 ms |

So the main Worker shed 3.46 MB and about 300 ms, and the number holds steady deploy to deploy. Startup tracks upload size closely: the cards Worker carries 3.49 MB (satori, opentype.js, and resvg's 2.48 MB wasm) and starts in under 35 ms, because most of its bytes are wasm that isn't compiled at startup, while the main Worker's 4.1 MB of JavaScript is.

What this means for the handoff's next step. It listed Sentry's 2.24 MB as the thing to look at after the cards, on the premise of a 535 ms start. At about 210 ms the case is much weaker: `run_worker_first` still makes every cold request pay it, but the headline cost is a third of what it was, and Sentry's share cannot be removed the way the cards' could, only trimmed. Measure the cold TTFB on terrakin.org before spending a session there.

One more reading for scale: the fourteen crops and ten recipes of [decision 0308](../decisions/0308-a-basket-of-fourteen-crops-sold-all-year-with-ten-recipes-an.md) grew the main Worker from 4,124.29 to 4,135.48 KiB, about 11 KiB, with no change in startup. Catalog growth is cheap at the edge.
