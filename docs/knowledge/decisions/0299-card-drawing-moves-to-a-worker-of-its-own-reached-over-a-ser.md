---
title: Card drawing moves to a Worker of its own, reached over a service binding
date: 2026-10-16
status: accepted
tags: [cloudflare, performance, cards, deploy]
---

# Card drawing moves to a Worker of its own, reached over a service binding

## Context

terrakin.org's HTML took 1.1 to 1.6 seconds to answer on a cold load, against 77 to 130 ms once an isolate was warm. At 44 residents most visits reach a colo with nothing warm, so the cold number is the one a newcomer meets.

The cause was the Worker's size. CI's own deploy output said `Total Upload: 7598.88 KiB / gzip: 2294.42 KiB` and `Worker Startup Time: 535 ms`, and `wrangler.jsonc` sets `run_worker_first: true`, so every request paid that startup before a byte of HTML went out.

About 3.5 MB of those 7.6 MB were the card stack, which a page request never touches: satori (591 KB), opentype.js (427 KB), resvg's `index_bg.wasm` (2.48 MB), `yoga.wasm` (72 KB), and nine @fontsource WOFF files. They were in the bundle because `packages/server/cloudflare/worker.ts` imported `@terrakin/cards/worker` at the top, for two calls: the `/og/*.png` route and `PlotPhotos.draw`.

Scoping `run_worker_first` so `/assets/*` skips the Worker was looked at and dropped: the HTML request has to go through the Worker, and it is the one that pays.

## Decision

Card drawing lives in a Worker of its own, `terrakin-cards` (`packages/cards/cloudflare/worker.ts`, `wrangler.cards.jsonc`), which the main Worker reaches over a `CARDS` service binding. Its one RPC method is `render(card)`, typed by `CardDrawer` in `packages/cards/src/render.ts`, which both sides use: a `Card` and a `Rendered` are plain data, so both cross RPC as they are.

The cards Worker has no routes, no `workers.dev` address and no `fetch` method, so only the binding reaches it, and it starts no Sentry client: a draw that throws comes back over RPC to the caller, which already catches it, reports it with the route it was serving, and falls back to the static `/og.png`.

Nothing about a card's look changed, and nothing moved out of `packages/cards/src/`: the Worker entry is three lines around the `cards` renderer that was already there, so the once-per-isolate wasm boot in `createCards` is the same one.

`pnpm cf:deploy` uploads the cards Worker first and then the main one. Order is not a preference: a Worker that declares a service binding fails to deploy while that service doesn't exist, so a first deploy from nothing has to go this way.

## Consequences

- The main Worker is 4105.55 KiB uncompressed, 993.74 KiB gzipped, down from 7598.88 KiB and 2294.42 KiB. The cards Worker carries the 3485.92 KiB that left.
- Drawing a card now costs a service binding hop. Cloudflare bills no extra request for one and the CPU is the same across both Workers, so the money is unchanged; the latency added is nothing on paper and a cold cards isolate in practice, which lands on `/og/*.png` and plot photos rather than on anyone's first page.
- A plot photo is now two hops: the World object asks the main Worker's `PlotPhotos` entrypoint, which asks the cards Worker. The limit is 32 Worker invocations in a request, so there is room.
- Local dev needs both: `pnpm cf:dev` runs `wrangler dev -c wrangler.jsonc -c wrangler.cards.jsonc`.
- A change to how a card is drawn now needs both Workers deployed, which `pnpm cf:deploy` does in one run. A change to the `render` contract is a two-step: the cards Worker first, the caller after.
- The Sentry stack is the next 2.24 MB, and it is in the main Worker because the main Worker reports. Splitting it is not the same kind of move.
