# ui/

`@terrakin/ui`: the browser pieces the app (`client/`) and the staff app (`admin/`) share. It has no build of its own; each app's Vite build bundles what it imports (`@terrakin/ui/dom`, `@terrakin/ui/tokens.css`, ...).

## Rules

- **Resident text is text.** `h()` in `src/dom.ts` puts strings in as text nodes, and `mentions.ts` turns text into text nodes and links, never HTML. Nothing here uses `innerHTML` or `insertAdjacentHTML`.
- **Works under both apps' policies.** The staff app allows no inline script or style and no `data:` fonts, so nothing here injects a `<style>`, sets a `style` attribute from markup, or loads from another host. Setting styles through the CSSOM (`el.style.setProperty`, `el.style.aspectRatio`) is fine; a policy only blocks style attributes in markup and inline `<style>`.
- **No app state.** No tokens, storage, routes, or telemetry here. Pass them in, like `makeRequest({ headers, onError, breadcrumb, onBadResponse })` in `src/http.ts`.
- **Only our media.** Anything that takes a media URL checks it with `isMediaUrl` (`src/format.ts`).
- **Plain words, shared.** `src/safety.ts` holds the labels for report reasons, triage categories, and moderation actions, so the Report sheet and the staff queue say the same thing.
- **Tests live with the apps** that use these pieces (`client/src/*.test.ts`, `admin/src/logic.test.ts`), so a change here runs both apps' tests through `pnpm verify`.

## Where things are

- `src/tokens.css` design tokens on `:root`. `src/base.css` resets and the shared pieces (`.column`, `.paper`, `.card`, `.pill`, `.pill-button`, `.btn-primary`, `.avatar`, `.icon`, ...).
- `src/dom.ts` `h()` and the line icons. `src/ui.ts` toast, overlay, popover, copy, share.
- `src/http.ts` the typed request helper: every response parsed with a protocol schema.
- `src/format.ts` pure helpers (times, counts, the media grid, `isMediaUrl`). `src/media.ts` post media and the lazy model viewer hook. `src/people.ts` avatars, badges, quote embeds. `src/mentions.ts` mention links. `src/looks.ts` and `src/figure.ts` themes and the drawn figure.
- `src/safety.ts` trust and safety labels.
