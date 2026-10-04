---
title: The API reference is rendered from the generated OpenAPI document
date: 2026-10-04
status: accepted
tags: [docs, client, protocol, security]
---

# The API reference is rendered from the generated OpenAPI document

## Context

People and agents need one place to read the API: every endpoint with its schemas, a way to try a call, search, and the guides that explain how to use it. Since decision 0017 the route table generates the OpenAPI document, so a hand-written reference page would be a fifth copy of the API, and the first one nothing checks. The site is mobile-first, runs under a strict Content-Security-Policy, and sends nothing to third parties beyond GA4 and Sentry (decision 0015).

## Decision

terrakin.org/docs is a second page (`client/docs.html`) where Scalar (`@scalar/api-reference`, pinned to an exact version) renders the committed `protocol/openapi.json`, the same document `/v1/openapi.json` serves.

- The guides are the document's description, so they share Scalar's sidebar and search. `pnpm gen` writes them to `client/src/docs/guides.generated.md` from `docs/guides/getting-started.md` (written once, for people), `protocol/SKILL.md` (the agent quickstart and the safety rules, split out by `##` heading, without its endpoint table), and the OpenAPI document (the WebSocket message tables come from `x-websocket` and the `ClientMessage` and `ServerMessage` schemas). `pnpm gen:check` fails when the file is stale. Generation fails when a SKILL.md section it needs is missing or a link points at a heading that doesn't exist.
- OpenAPI summaries are plain text, so the generator drops code marks from route summaries; descriptions keep their markdown.
- Theming goes through Scalar's CSS variables with `theme: "none"` (`client/src/docs/docs.css`), using the shared storybook tokens (`client/src/tokens.css`) and our self-hosted Fraunces and Figtree. Nothing is forked.
- Everything that would reach a third party is off: `telemetry: false`, the hosted agent and MCP disabled, `withDefaultFonts: false` (no fonts.scalar.com), no request proxy, and the "Open API Client" button hidden (it links to client.scalar.com). "Test Request" calls our own origin directly. The e2e test fails on any request to another host.
- The page follows decision 0015: GA4 gets the template `/docs` and the title "Docs", whatever section the address points at.

Why Scalar: it is actively maintained, renders OpenAPI 3 with a real sidebar, search, try-it, code samples, and markdown sections in one component, and it themes through CSS variables. Redoc has no try-it. Swagger UI has no sidebar worth the name. Stoplight Elements is larger and slower to change. RapiDoc is lighter but less maintained and harder to theme.

## Consequences

- Adding or changing a route updates the reference with no extra step: `pnpm gen` already has to run, and the docs read its output.
- Size: Scalar is big. /docs downloads about 3.4 MB of JavaScript and 260 KB of CSS, about 1 MB gzipped (the reference chunk alone is 1.65 MB, 486 KB gzipped), plus fonts. The docs page is its own Vite build (`client/vite.docs.config.ts`) rather than a second entry, because a shared chunk would put the parts of zod Scalar uses into every app visitor's download. The app's bundle is unchanged. The reference loads as a lazy chunk, so the bar paints first.
- CSP: no change to the policy. Each page gets the same policy from the build plugin, with no `unsafe-eval`. zod probes for `new Function` while it builds schemas, which shows up as a violation even though zod catches it, so the docs page sets `z.config({ jitless: true })` before anything else loads (`client/src/docs/jitless.ts`). The app page still shows that probe; the same switch would fix it there.
- Routing: Cloudflare's assets serve `docs.html` at `/docs` (and redirect `/docs/` and `/docs.html` there); the Node server tries `<path>.html` before its single-page fallback. The app's router treats `/docs` as a full page load. Deep links are Scalar's hashes (`/docs#tag/social`, `/docs#description/first-visit`).
- Scalar upgrades are a version bump in `client/package.json`. Re-run `pnpm e2e`: it checks the sidebar, an operation, a reload, CSP violations, and third-party requests at phone and desktop size. Check new configuration options for anything that phones home.
- The OpenAPI file's own download button is off, because a download from the page would include the guides. The bar links the real `/v1/openapi.json`.
