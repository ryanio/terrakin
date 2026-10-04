---
title: Link preview cards and page meta are drawn and written at the edge
date: 2026-10-04
status: accepted
tags: [server, client, seo, security, deploy]
---

# Link preview cards and page meta are drawn and written at the edge

## Context

terrakin.org is a single-page app. Every URL served the same index.html, so a shared profile or post showed the site's title, description and card, and crawlers that don't run JavaScript saw no content at all. We wanted a real title, description, canonical URL, Open Graph and Twitter tags, JSON-LD, and a picture of the thing being shared, without a second app or a build step per page. Ryan's other projects (musegod, flock) already draw cards with satori and resvg-wasm on Cloudflare and rewrite HTML with HTMLRewriter, so the approach was known to work there.

## Decision

- A new workspace package, `cards/`, holds the card templates (site, page, profile, post) at 1200x630 in the storybook brand. satori 0.32 (pinned: later versions load HarfBuzz from a separate wasm at run time) lays them out; resvg-wasm draws the PNG. Fonts are the static WOFF files from @fontsource. The Worker imports the wasm and fonts as modules; Node reads them from `node_modules`.
- The Worker serves `/og/site.png`, `/og/page/<slug>.png`, `/og/profile/<id>.png` and `/og/post/<id>.png`. It reads data through the World object's own API (the same GETs any client makes) and renders in the Worker, never in the World object, so drawing a card can't stall the world.
- A card is keyed by a hash of what it shows plus `CARDS_VERSION`. Rendered PNGs live in the Cache API under that key. Page meta links to `...png?v=<key>`; a request for the current version is cached for a year, anything else for ten minutes, and every answer has an ETag. Cache misses are capped per IP (or IPv6 /64) per minute per isolate; over the cap, unknown ids, and failures redirect to the static `/og.png`.
- For HTML pages the Worker runs `index.html` through HTMLRewriter: title, description, canonical, `og:*`, `twitter:*`, robots, per-page JSON-LD (ProfilePage with a Person, DiscussionForumPosting with author, date and counts), and a `<noscript>` copy of the profile or post with crawlable links. Unknown pages and ids get status 404, `noindex`, no canonical, and the site card. Pages with their own file (`/docs`, `/about`, `/privacy`, `/contact`) keep their tags and only get their card. Titles and descriptions of fixed pages come from `protocol/src/site.ts`.
- `server/src/page-meta.ts` builds one `DocumentEdits` value from API data. The Worker applies it with HTMLRewriter (`cloudflare/meta-rewriter.ts`); the Node server applies the same value with a small escaping string applier (`src/meta-html.ts`). Resident text only reaches the page through `setAttribute`, text-mode `setInnerContent` and `append` (or `escapeAttr`/`escapeText` in Node). The only raw HTML is our own markup and JSON-LD from `scriptJson()`, which escapes `<`, `>`, `&`, U+2028 and U+2029.
- `/world` stays indexable. It is the landing curtain (what Terrakin is, how to join) as much as the canvas, it's the "play" entry point people search for, and the canvas itself carries no text that could be thin content.

## Consequences

- The Worker bundle grows by about 2.6 MB uncompressed (resvg's wasm is 2.4 MB of it); it is about 1.4 MB gzipped, under the 3 MB free and 10 MB paid limits. `wrangler deploy --dry-run` reports it.
- A card costs about 100 ms of CPU on a miss, which needs the Workers paid plan's CPU limit. On the free plan a render can be cut off; the route then redirects to `/og.png`, so a share still has a picture.
- Every profile and post page now waits on one or two GETs to the World object before its HTML starts. If the object doesn't answer, the page goes out with index.html's own tags rather than a 404.
- New app routes need a case in `matchPage` (server) as well as the client router, and a new card needs `CARDS_VERSION` bumped. Pictures on cards are limited to PNG, JPEG, GIF and WebP under 6 MB and 12.6 megapixels, so a phone photo above that shows the card without its picture.
- Emoji and non-Latin scripts are dropped from cards (the bundled fonts are Latin only); a name or post that is mostly another script falls back to "A resident" or a plain line. Adding fonts for more scripts would grow the bundle.
