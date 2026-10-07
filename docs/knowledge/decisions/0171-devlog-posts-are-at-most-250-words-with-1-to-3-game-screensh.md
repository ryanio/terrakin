---
title: Devlog posts are at most 250 words with 1 to 3 game screenshots, checked by pnpm gen
date: 2026-10-07
status: accepted
tags: [docs, tooling, client, protocol]
---

# Devlog posts are at most 250 words with 1 to 3 game screenshots, checked by pnpm gen

## Context

The first devlog posts ran 600 to 1,000 words of text. Ryan asked for shorter posts with pictures. Terrakin is a world you look at, so the pictures should show what actually shipped. Paid illustrations or stand-in art would not do that.

## Decision

- A post has at most 250 words (`DEVLOG_WORDS_MAX` in `packages/protocol/src/devlog.ts`, headings counted, alt text not) and 1 to 3 screenshots. `parseDevlog` refuses a post that breaks either rule, so `pnpm gen` fails on it. One screenshot is enough when it shows the day's highlight. The four posts written before this were rewritten to the same rules, with screenshots of today's game.
- A screenshot is a Markdown image on a line of its own, `![alt](/devlog/images/<day>-<name>.jpg)`. The day must be the post's day, and alt text is required. The files live in `packages/client/public/devlog/images/` and ship as static assets. `pnpm gen` fails when a shown file is missing or over 400 KB, or when a file there isn't shown by any post.
- `pnpm devlog:shot` (`scripts/devlog-shot.ts`) takes them. It makes a persona on the `pnpm dev:test` world, opens a page in a phone-sized Chromium at 2x, and saves a JPEG at quality 80, usually 40 to 100 KB. `--bare` hides the world's buttons.
- `markdownToHtml` draws an image line as `<figure><img loading="lazy">`. It loads only paths under `/devlog/images/`, so a post can't pull from another host. `markdownNodes` keeps `src` and `alt` on images for the home wall card.

## Consequences

- Every post now needs the test world running to take its screenshots, which costs a minute or two.
- A post that is only about the API still needs a screenshot. The API details go in `CHANGELOG.md`, and the post shows whatever a resident would see.
- Images in the repo add up over time, about 100 to 300 KB a post. If that becomes a problem, they can move to R2.
- Code: `packages/protocol/src/devlog.ts`, `packages/client/src/markdown.ts`, the `.prose figure` styles in `packages/client/src/style.css`, `scripts/gen.ts`, `scripts/devlog-shot.ts`. Rules for writers: `docs/AGENTS.md`.
