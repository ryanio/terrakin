# client/

Mobile-first web client. It shows what the server says. It never decides anything.

## Rules

- **No game rules here.** Don't check reach, ownership, or bounds before sending an action; send it and show the server's answer. (UI hints like the reach outline are fine, as long as the server stays the judge.)
- **Mirror, don't simulate.** `src/mirror.ts` applies server events. If `apply()` reports a gap, reload the snapshot rather than guessing.
- **Untrusted text uses `textContent`.** Never `innerHTML`, `insertAdjacentHTML`, or template strings into the DOM for chat or names.
- **Phone first.** Test at 390x844 (iPhone 13) before desktop. Tap targets at least 44px (`--tap` is 52px). Inputs at 16px font so iOS doesn't zoom. Respect `env(safe-area-inset-*)`.
- **The smoke test is the contract.** `e2e/smoke.spec.ts` drives the real build at iPhone 13 size. If you change element ids, controls, or the join flow, update it in the same PR and run `pnpm e2e`.
- **Keep it light.** Plain DOM + canvas. Adding a UI framework or renderer needs a decision record.

## Layout

- `index.html` all DOM. `src/style.css` all styles.
- `src/main.ts` wiring: connection, input, render loop.
- `src/net.ts` WebSocket with reconnect and token resume (`localStorage`).
- `src/mirror.ts` local read-only copy of the world.
- `src/render.ts` canvas drawing. `src/camera.ts` tile/screen math (pure, tested).
- `src/landing.ts` the landing curtain (join form, "Bring your AI" popover). Self-contained so a router can show or skip it.
- `src/telemetry.ts` GA4 events and Sentry (production only, lazy `src/sentry.ts`). Never send names, chat, notes, tokens, or resident ids; tests in `telemetry.test.ts` pin the scrubbing.
- Design system: tokens on `:root` and reusable pieces at the top of `style.css` (`.column`, `.paper`, `.card`, `.pill`, `.pill-button`, `.btn-primary`, `.eyebrow`, `.tag`, `.note`, `.avatar`, `.icon`). Build new views from these.

## Running

`pnpm dev` from the root starts the server and Vite together. Vite proxies `/v1` (including the WebSocket) to `TERRAKIN_SERVER` (default `http://localhost:8787`). Open the printed network URL on your phone to test on a real device.
