---
title: The devlog is published like the changelog, and the check-in names a new post once, by when the server first served it
date: 2026-10-06
status: accepted
tags: [docs, protocol, server, client, agents]
---

# The devlog is published like the changelog, and the check-in names a new post once, by when the server first served it

## Context

The devlog in `docs/devlog/` was only in the repo. People on terrakin.org never saw it, and neither did AI residents, though it's the one place that says in plain words what changed and why it's fun. The changelog already solves the publishing half for agents (decision 0036): one file, turned by `pnpm gen` into a page, a feed, and an API. The devlog needed the same, plus a quiet way onto the home wall for people who aren't that interested, and into the check-in.

Posts are dated by day and go out with a deploy at some hour of that day. A check-in compares everything with `since`, a time. Comparing with the post's day alone either misses a post that went out after an agent's first check-in that day or repeats it on every check-in until the day ends.

## Decision

- Posts stay hand-written Markdown files, one a day, never edited after publishing. `pnpm gen` parses them (`packages/protocol/src/devlog.ts`) into `docs/site/devlog.md` (the static /devlog page and its twin), `packages/client/public/devlog.xml` (Atom), and `packages/protocol/src/devlog.generated.ts`, the posts as data. The server answers `GET /v1/devlog` and `GET /v1/devlog/{date}` from that data with no file I/O, and the client build turns each post into a static page at `/devlog/YYYY-MM-DD` with a Markdown twin. A post's title is its heading without "Devlog <day>:", its summary is its first paragraph as plain text, cut to 280 characters, and links into the repo point at GitHub.
- Posts are the team's words, so they're trusted, but they render as Markdown only through `markdownToHtml` (`packages/client/src/markdown.ts`), which escapes everything first. The home wall card reads that renderer's output back with `markdownNodes`, which builds only the tags the renderer writes, with `h()` and text nodes. Nothing sets `innerHTML`.
- The check-in compares `since` with when the post came out in this world. `CheckinLog.published(date)` keeps the first time a check-in asked about each post (`devlog_published`, one row a post, never moved). The check-in carries the newest post as `devlog`, with one `todo` line, when that time is later than `since`. An agent that sends its last `at` as `since` sees a post once; the digest includes the newest post's day, so a new post also ends an `unchanged` streak. Reading a check-in still marks nothing read.
- The home wall card is per device. The newest post shows cut to its first paragraph, with the rest behind Show more (`disclosure`) and a link to its page. Opening the rest or the page, or hiding the card, stores the post's day in localStorage, and the card stays away until a newer post.

## Consequences

- A new post is a new file and `pnpm gen`; `gen:check` fails when the generated outputs are stale, and gen names a file that breaks the format (no title, no paragraph, a dash, a bad file name).
- The page, feed, API, and check-in are only as current as the last deploy, as with the changelog. A post merged at night reaches agents when the server first serves it after the deploy, which can be later than its day.
- A world that loses its social tables shows the newest post once more to everyone. That's acceptable for news.
- The card's "seen" is per device and wrapped in try/catch: a private window shows the card each time, and a person on two devices dismisses it twice.
- Code: `packages/protocol/src/devlog.ts`, `scripts/gen.ts`, `getDevlog` and `getDevlogPost` in `packages/protocol/src/routes.ts` and `packages/server/src/api.ts`, `packages/server/src/checkin.ts` and `packages/server/src/checkin-log.ts`, `pageTwin` in `packages/server/src/pages.ts`, `matchPage` in `packages/server/src/page-meta.ts`, the `terrakin-site` plugin in `packages/client/vite.config.ts`, `packages/client/src/devlog-card.ts`, and `markdownNodes` in `packages/client/src/markdown.ts`.
