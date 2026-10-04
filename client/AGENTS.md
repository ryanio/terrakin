# client/

Mobile-first web client. It shows what the server says. It never decides anything.

## Rules

- **No game rules here.** Don't check reach, ownership, or bounds before sending an action; send it and show the server's answer. (UI hints like the reach outline are fine, as long as the server stays the judge.)
- **Mirror, don't simulate.** `src/mirror.ts` applies server events. If `apply()` reports a gap, reload the snapshot rather than guessing.
- **Untrusted text uses `textContent`.** Never `innerHTML`, `insertAdjacentHTML`, or template strings into the DOM for chat or names.
- **Phone first.** Test at 390x844 (iPhone 13) before desktop. Tap targets at least 44px (`--tap` is 52px). Inputs at 16px font so iOS doesn't zoom. Respect `env(safe-area-inset-*)`.
- **The e2e tests are the contract.** `e2e/smoke.spec.ts` (the world at `/world`) and `e2e/feed.spec.ts` (feed, profile, post) drive the real build at iPhone 13 size. If you change element ids, controls, or the join flow, update them in the same PR and run `pnpm e2e`.
- **Keep it light.** Plain DOM + canvas. Adding a UI framework or renderer needs a decision record.

## Layout

- `index.html` all static DOM: the feed chrome (`#site`, `#page`) and the world (`#world-view`: canvas, landing curtain, HUD). `src/style.css` all styles.
- `src/main.ts` boots the router and mounts a page per route. `src/router.ts` is a tiny History API router: `/` feed, `/r/:id` profile, `/p/:id` post, `/world` the world, anything else a not-found card. Matching and analytics templates are pure and tested.
- Feed pages: `src/feed-view.ts`, `src/profile-view.ts`, `src/post-view.ts`, built from `src/post-card.ts`, `src/media.ts` (grid, image viewer, model tile), `src/composer.ts`, and `src/ui.ts` (toast, back-closable overlay, copy). `src/api.ts` makes every REST call and parses each response with the protocol schemas. `src/dom.ts` builds elements with text as text nodes, so post text can't become markup. `src/format.ts` holds the pure helpers (relative time, media layout, new-post counting).
- `src/model-viewer.ts` the three.js viewer. Only reachable through `import()`; never import `three` anywhere else ([decision 0013](../docs/knowledge/decisions/0013-load-three-js-only-when-someone-opens-a-3d-model.md)).
- `src/world.ts` the world: connection, input, render loop. Its own chunk, started on `/world` and stopped (loop canceled, socket closed) when you leave.
- `src/net.ts` WebSocket with reconnect and token resume (`localStorage`). The feed reads the same token to post, like, and follow.
- `src/mirror.ts` local read-only copy of the world.
- `src/render.ts` canvas drawing. `src/camera.ts` tile/screen math (pure, tested).
- `src/landing.ts` the landing curtain (join form). `src/chrome.ts` the brand mark and "Bring your AI" popover shared with the feed bar.
- `src/telemetry.ts` GA4 events and Sentry (production only, lazy `src/sentry.ts`). Never send names, chat, notes, tokens, or resident ids: page views go out as route templates (`/r/:id`), and URLs in error reports are templated the same way. Tests in `telemetry.test.ts` and `feed.test.ts` pin the scrubbing.
- Design system: tokens on `:root` and reusable pieces at the top of `style.css` (`.column`, `.paper`, `.card`, `.pill`, `.pill-button`, `.btn-primary`, `.eyebrow`, `.tag`, `.note`, `.avatar`, `.icon`). Build new views from these.

## Running

`pnpm dev` from the root starts the server and Vite together. Vite proxies `/v1` (including the WebSocket) and `/media` to `TERRAKIN_SERVER` (default `http://localhost:8787`). Open the printed network URL on your phone to test on a real device.
