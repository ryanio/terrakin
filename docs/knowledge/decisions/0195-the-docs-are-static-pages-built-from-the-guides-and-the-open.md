---
title: The docs are static pages built from the guides and the OpenAPI document, with no Scalar
date: 2026-10-07
status: accepted
tags: [docs, client, protocol, performance]
---

# The docs are static pages built from the guides and the OpenAPI document, with no Scalar

## Context

Decision 0021 put the docs in Scalar, a Vue app that draws the API reference and the guides in the browser from the OpenAPI document. It cost about 600 KB of compressed JavaScript and 260 KB of CSS for one page, and about 0.7 seconds of main-thread work on a laptop before anything showed (several seconds on a phone), so the page needed a loading skeleton to look finished. It needed its own Vite build to keep Vue out of the app, the `jitless` switch to pass the Content-Security-Policy, a check of every upgrade for anything that calls Scalar's servers, and theming through its CSS variables, which never quite matched the site. What it gave us beyond a rendered reference was a try-it button, a schema explorer, and code samples in several languages. Agents use none of them: they read /skill.md, /docs.md, /docs/llms.txt, and the OpenAPI document.

## Decision

/docs and the API reference are static pages like /about, built by the `terrakin-site` plugin with no script:

- /docs is the generated guides with a contents list, then the reference's index and the API's conventions (`docsPageMarkdown` in `packages/protocol/src/reference.ts`). Its twin stays /docs.md.
- Each area of the API (each route-table tag but Live, the WebSocket, which its guide covers) has a page at /docs/api/<area>, with every route: what token it needs, its limits, its path and query parameters, its body and answer as field tables, and its error codes (`apiAreaMarkdown`). /docs/api/models has every shape in the OpenAPI document, with each world event and other union under its type. Each page has a Markdown twin beside it.
- Simple named shapes (strings, numbers, short enums) are spelled out in place; objects, unions, and long enums link to Models.
- Docs pages carry a "Docs" card in the side column that lists every page.

This supersedes decision 0021's choice of Scalar. Its other choices stand: the reference comes from the generated OpenAPI document, the guides from `pnpm gen`, and nothing on the page reaches a third party.

## Consequences

- The docs load as fast as any static page, read on a phone, and look like the rest of the site. The second Vite build, `docs.html`, `src/docs/main.ts`, its stylesheet, and the `@scalar/api-reference` dependency are gone.
- There is no try-it button, schema explorer, client-side search, or multi-language code samples. The browser's find works on each page, and anyone who wants an explorer can load /v1/openapi.json into one.
- Like every static page, the docs run no analytics, so GA4 no longer sees /docs visits.
- Old Scalar deep links (`/docs#tag/social`, `/docs#description/first-visit`) land at the top of /docs, since a fragment never reaches the server.
- `reference.test.ts` checks every public route appears once and every link lands on a heading; `site-page.test.ts` checks the rendered pages have an id for every link between them; `e2e/docs.spec.ts` walks from /docs to a route and a model at phone and desktop size.
