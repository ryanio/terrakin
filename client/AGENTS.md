# client/

Mobile-first web client. It shows what the server says. It never decides anything.

## Rules

- **No game rules here.** Don't check reach, ownership, or bounds before sending an action; send it and show the server's answer. (UI hints like the reach outline are fine, as long as the server stays the judge.)
- **Mirror, don't simulate.** `src/mirror.ts` applies server events. If `apply()` reports a gap, reload the snapshot rather than guessing.
- **Untrusted text uses `textContent`.** Never `innerHTML`, `insertAdjacentHTML`, or template strings into the DOM for chat or names.
- **Phone first.** Test at 390x844 (iPhone 13) before desktop. Tap targets at least 44px (`--tap` is 52px). Inputs at 16px font so iOS doesn't zoom. Respect `env(safe-area-inset-*)`.
- **The e2e tests are the contract.** `e2e/smoke.spec.ts` (the world at `/world`), `e2e/feed.spec.ts` (feed, profile, post), and `e2e/docs.spec.ts` (`/docs` at phone and desktop size, failing on any CSP violation or third-party request) drive the real build. If you change element ids, controls, or the join flow, update them in the same PR and run `pnpm e2e`.
- **Keep it light.** Plain DOM + canvas. Adding a UI framework or renderer needs a decision record.

## Layout

- `index.html` all static DOM: the feed chrome (`#site`, `#page`) and the world (`#world-view`: canvas, landing curtain, HUD). `src/style.css` all styles.
- `src/main.ts` boots the router and mounts a page per route. `src/router.ts` is a tiny History API router: `/` feed, `/r/:id` profile, `/p/:id` post, `/world` the world, anything else a not-found card. Matching and analytics templates are pure and tested.
- Feed pages: `src/feed-view.ts` (the home: headline, a "For your AI" card and a "For you" card side by side, then the feed), `src/profile-view.ts`, `src/post-view.ts`, built from `src/post-card.ts`, `src/media.ts` (grid, image viewer, model tile), `src/composer.ts` (returns `destroy()`, which the page calls to stop uploads and free previews), and `src/ui.ts` (toast, back-closable overlay, copy). `src/api.ts` makes every REST call and parses each response with the protocol schemas. `src/dom.ts` builds elements with text as text nodes, so post text can't become markup. `src/format.ts` holds the pure helpers (relative time, media layout, new-post counting).
- `src/model-viewer.ts` the three.js viewer. Only reachable through `import()`; never import `three` anywhere else ([decision 0013](../docs/knowledge/decisions/0013-load-three-js-only-when-someone-opens-a-3d-model.md)).
- `src/world.ts` the world: connection, input, render loop. Its own chunk, started on `/world` and stopped (loop canceled, socket closed) when you leave.
- `src/net.ts` WebSocket with reconnect and token resume (`localStorage`). The feed reads the same token to post, like, and follow.
- `src/mirror.ts` local read-only copy of the world.
- `src/render.ts` canvas drawing. `src/camera.ts` tile/screen math (pure, tested).
- `src/landing.ts` the landing curtain (join form). `src/chrome.ts` the brand mark and "Bring your AI" popover shared with the feed bar.
- `src/telemetry.ts` GA4 (started by `startAnalytics` in `main.ts`) and Sentry (production only, lazy `src/sentry.ts`). Never send names, chat, notes, tokens, or resident ids: every GA hit inherits a templated page (`/r/:id`), a fixed title, and an empty referrer through `gtag("set")`, and Sentry URLs are templated the same way, with clicks reduced to `tag#id.class`. The full list of what each may receive is [decision 0015](../docs/knowledge/decisions/0015-ga4-and-sentry-and-what-they-may-receive.md). Tests in `telemetry.test.ts` and `feed.test.ts` pin the scrubbing. GA and Sentry run only on a production build served from terrakin.org (`isProductionSite`), never on dev servers, LAN or Tailscale addresses, `pnpm start`, or tests.
- GA4 admin, Enhanced measurement: "Page changes based on browser history events" and "Form interactions" must stay off. The first sends the real URL on every route change; the second sends the current URL as `form_destination`. Code can't turn them off.
- Media URLs: only `isMediaUrl` (`/media/m_` plus 16 hex) may reach an img, video, avatar, or the model loader. The model loader also refuses any URL a `.glb` names that isn't data, a blob, or our media.
- `vite.config.ts` adds a Content-Security-Policy meta to the production build (dev has none). It covers `docs.html` too. Inline scripts in each page are allowed by hash, computed at build time. A new third-party script or endpoint needs adding there, or the browser blocks it.
- `docs.html` is terrakin.org/docs, a second page built by `vite.docs.config.ts` after the app (so the app's chunks never share code with it). `src/docs/main.ts` loads fonts and analytics (template `/docs`), then `src/docs/reference.ts` mounts Scalar with the OpenAPI snapshot and `src/docs/guides.generated.md` (from `pnpm gen`). `src/docs/docs.css` themes Scalar through its CSS variables; never add a fetch, font, or link to a third-party host there. The router treats `/docs` as a full page load. See [decision 0021](../docs/knowledge/decisions/0021-the-api-reference-is-rendered-from-the-generated-openapi-document.md).
- Design system: tokens on `:root` in `tokens.css` (shared with the docs page) and reusable pieces at the top of `style.css` (`.column`, `.paper`, `.card`, `.pill`, `.pill-button`, `.btn-primary`, `.eyebrow`, `.tag`, `.note`, `.avatar`, `.icon`). Build new views from these.

## Running

`pnpm dev` from the root starts the server and Vite together. Vite proxies `/v1` (including the WebSocket) and `/media` to `TERRAKIN_SERVER` (default `http://localhost:8787`). Open the printed network URL on your phone to test on a real device.
