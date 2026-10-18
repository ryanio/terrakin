---
title: The dev client can read the live world, and only read it
date: 2026-10-18
status: accepted
tags: [tooling, client, safety]
---

# The dev client can read the live world, and only read it

## Context

Judging a layout takes content. A card grid with one card in it, a feed with no posts, a market with no listings: each shows its empty state, which is the one case the layout always gets right. A design pass over `pnpm dev:test` kept running into this, and the way round it was seeding a world by hand, which takes a script per surface and still gives a town that looks nothing like the real one: no long plot names, no resident who admired four homes this week, no shelf where some stock is seasonal and the rest isn't.

terrakin.org has all of that and its API is public. The client's dev server already proxies `/v1`, `/media` and the rest to `TERRAKIN_SERVER` ([packages/client/AGENTS.md](../../../packages/client/AGENTS.md)), so pointing that at the live site is a one-line change. The reason not to is obvious: the same proxy would carry a `POST` just as happily, and a dev server is exactly where a stray click, a half-written test, or an agent with a token does something to a real town nobody asked for.

Copying the database was the other option. It means `wrangler d1 export`, a file of residents' letters, chat and purses sitting on a laptop, and a second copy of the world drifting from the first. For looking at a page, that is a lot of private data to move for no gain.

## Decision

`pnpm dev:live` runs the client on :5193 with the proxy pointed at `https://terrakin.org`, and the dev server refuses everything that isn't a read.

`packages/client/src/dev-proxy.ts` holds the two questions, pure and tested: `worldIsHere` (the world is on this machine, where writing is the point) and `passesToAnotherWorld` (a request may go on). When the world is somewhere else, anything but a `GET` or `HEAD` under `/v1`, `/media` or `/og` is answered `405 read_only` by a middleware that runs before the proxy, so no action, upload, post or purchase can leave the dev server for a world it doesn't own. Requests for the dev server's own files are not the world's business and go through. The proxy also sends the target's own `Host` (`changeOrigin`), since a world somewhere else routes by the name it's asked for.

Nothing is copied: it is the public API, read over the wire, signed out. A page that needs a resident still wants `pnpm dev:test` and `pnpm persona`, and a live token never goes near it.

## Consequences

- Looking at a real page is one command. The alignment pass that followed this found two things a seeded world had hidden: plot cards in a row on `/visit` whose Visit buttons sat up to 33px apart, because only some plots have a name of their own, and the front page's live line, whose two rows didn't share a left edge.
- The guard is the whole safety argument, so it is tested rather than trusted: `packages/client/src/dev-proxy.test.ts` pins that reads pass, that every writing method under those paths is refused, and that the dev server's own files are left alone. Changing the paths the proxy carries means changing `TO_THE_WORLD` with it.
- It reads production, so it is subject to whatever the live site rate-limits and shows a signed-out visitor, and a page that only exists for a signed-in resident will look empty. That is the trade: the public pages are the ones with enough in them to judge, and they are the ones this gives you.
- `.claude/settings.json` allows `pnpm dev:live` so an agent can run it without a prompt. That allowance is only defensible while the guard holds; a change that lets writes through would have to take the allowance with it.
