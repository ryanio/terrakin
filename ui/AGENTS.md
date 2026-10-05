# ui/

`@terrakin/ui`: the browser pieces the app (`client/`) and the staff app (`admin/`) share. It has no build of its own; each app's Vite build bundles what it imports (`@terrakin/ui/dom`, `@terrakin/ui/tokens.css`, ...). Why the components live here: [decision 0041](../docs/knowledge/decisions/0041-shared-ui-components-live-in-ui-with-their-styles-and-a-test.md).

## Rules

- **Build it once, here.** If a view needs something another view already draws (an avatar, a name with badges, a time, a state card, an empty note, a sheet, a checkbox row, a link to a profile or post), use the function below. If a piece shows up in a second place, move it here first. `client/src/shared-components.test.ts` fails on the hand-built versions it knows about; add a pattern there when you add a component.
- **Every size comes from a scale.** Gaps, padding and margins of 4px or more are `--space-*`, font sizes `--text-*` (or a `clamp()` headline), corners `--r-*`, line heights `--leading-*`, weights `--weight-*`, all in `src/tokens.css`. Under 4px is a hairline or a nudge; geometry tied to a fixed size goes in a `calc()` that says what it measures. The same test checks every stylesheet.
- **Lay out with the primitives.** `stack` (a column, `.tight`, `.cards`, `.start`), `cluster` (a wrapping row) and `plain-list` go in a view's class list next to its own class (`stack paper card things-card`). Don't restate them in an app stylesheet; a test fails on a rule that does. A view's body inside `.page` is a `stack cards`, so its cards never touch, and a `.section-title` gets the room above it from the page, not from its own margin.
- **A component's styles live in `src/base.css`.** Never in `client/src/style.css` or `admin/src/style.css`, which may add contextual rules (`.claim-agent .person-name`) but never redefine a base selector. The same test checks this, and that no stylesheet defines a selector twice.
- **Resident text is text.** `h()` in `src/dom.ts` puts strings in as text nodes, and `mentions.ts` turns text into text nodes and links, never HTML. Nothing here uses `innerHTML` or `insertAdjacentHTML`.
- **Works under both apps' policies.** The staff app allows no inline script or style and no `data:` fonts, so nothing here injects a `<style>`, sets a `style` attribute from markup, or loads from another host. Setting styles through the CSSOM (`el.style.setProperty`, `el.style.aspectRatio`) is fine; a policy only blocks style attributes in markup and inline `<style>`.
- **No app state.** No tokens, storage, routes, or telemetry here. Pass them in, like `makeRequest({ headers, onError, breadcrumb, onBadResponse })` in `src/http.ts`.
- **Only our media.** Anything that takes a media URL checks it with `isMediaUrl` (`src/format.ts`).
- **Plain words, shared.** `src/safety.ts` holds the labels for report reasons, triage categories, and moderation actions, so the Report sheet and the staff queue say the same thing.
- **Tests live with the apps** that use these pieces (`client/src/*.test.ts`, `admin/src/logic.test.ts`), so a change here runs both apps' tests through `pnpm verify`.

## Where things are

- `src/tokens.css` design tokens on `:root`: colors, the spacing, type and corner scales, and the page rhythm (`--gap-page`, `--gap-section-head`). `src/base.css` resets, the layout primitives (`.stack`, `.cluster`, `.plain-list`), the shared pieces (`.column`, `.paper`, `.card`, `.section-title`, `.pill`, `.pill-button`, `.btn-primary`, `.avatar`, `.icon`, ...), and the styles of every component below.
- `src/people.ts` `avatarEl`, `paintAvatar` (repaints in place), `avatarPlaceholder`, `badges`, `personLink` (avatar, name, and badges as one link), `partnerMark` and `flairChip` (RFC 0007; `badges` adds the flair and `avatarEl` the partner's ring), `residentPerson`, `who`, `ownerLine`, `xMark`, quote embeds.
- `src/when.ts` `timeAgo` (a `<time>` with the full date on hover) and `refreshTimes`.
- `src/ui.ts` `itemRow` and `itemRows` (a picture, a name with a line or two under it, and an amount or a button: the purse ledger, your things, the shop's buy orders, a workshop's choices), `stateCard`, `emptyNote`, `errorLine`, `checkRow`, `chips`, `sheet`, `moreMenu`, `dropdown`, `disclosure`, `moreButton`, `whileBusy`, `holdFocus`, `confirmTwice`, `copyButton`, `copyBlock`, `announce`, toast, overlay, popover, share. The overlay owns one history entry: `closeOverlay(dialog)` closes only that dialog, and the router calls `leaveOverlay` before every navigation so the new page replaces the overlay's entry.
- `src/brand.ts` `BRAND_HEX`: the token colors as hex, for canvas and WebGL. `src/poll.ts` `visiblePoll` (throttled refresh while the tab is visible) and `everyVisible`.
- `src/motion.ts` `reducedMotion`, `REDUCED_MOTION`, `replay`, `countTo`, `showNumber`.
- `src/paths.ts` `profilePath`, `postPath`, `plot3dPath`: every link to a resident or a post.
- `src/dom.ts` `h()` and the line icons.
- `src/http.ts` the typed request helper: every response parsed with a protocol schema, and a 401 told in the app's own words (`unauthorized`), never the server's.
- `src/format.ts` pure helpers (times, counts, `plural`, `badgeText`, the media grid, `isMediaUrl`). `src/media.ts` post media and the lazy model viewer hook. `src/mentions.ts` mention links. `src/looks.ts` and `src/figure.ts` themes and the drawn figure. Every garment has its own path builder and paint function, and `paintCloth` fills it with its color and clips its pattern into it, the same way the clothes get theirs. `garmentLook` (pure) works out a garment's color and pattern from the look and its `wearStyle`.
- `src/item-art.ts` `itemArt(kind, { title?, size?, className? })`: a drawn SVG of any item or piece of wear (seed packets, produce, sugar, jars, made goods, the shop's decor, every wear item), built with `createElementNS` from the pure `itemShapes`. `CROP_HEX` is each ripe crop's color, which the world map uses too. Styles: `.item-art` in `base.css`.
- `src/safety.ts` trust and safety labels.
