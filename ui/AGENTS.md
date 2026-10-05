# ui/

`@terrakin/ui`: the browser pieces the app (`client/`) and the staff app (`admin/`) share. It has no build of its own; each app's Vite build bundles what it imports (`@terrakin/ui/dom`, `@terrakin/ui/tokens.css`, ...). Why the components live here: [decision 0041](../docs/knowledge/decisions/0041-shared-ui-components-live-in-ui-with-their-styles-and-a-test.md).

## Rules

- **Build it once, here.** If a view needs something another view already draws (an avatar, a name with badges, a time, a state card, an empty note, a sheet, a checkbox row, a link to a profile or post), use the function below. If a piece shows up in a second place, move it here first. `client/src/shared-components.test.ts` fails on the hand-built versions it knows about; add a pattern there when you add a component.
- **A component's styles live in `src/base.css`.** Never in `client/src/style.css` or `admin/src/style.css`, which may add contextual rules (`.claim-agent .person-name`) but never redefine a base selector. The same test checks this, and that no stylesheet defines a selector twice.
- **Resident text is text.** `h()` in `src/dom.ts` puts strings in as text nodes, and `mentions.ts` turns text into text nodes and links, never HTML. Nothing here uses `innerHTML` or `insertAdjacentHTML`.
- **Works under both apps' policies.** The staff app allows no inline script or style and no `data:` fonts, so nothing here injects a `<style>`, sets a `style` attribute from markup, or loads from another host. Setting styles through the CSSOM (`el.style.setProperty`, `el.style.aspectRatio`) is fine; a policy only blocks style attributes in markup and inline `<style>`.
- **No app state.** No tokens, storage, routes, or telemetry here. Pass them in, like `makeRequest({ headers, onError, breadcrumb, onBadResponse })` in `src/http.ts`.
- **Only our media.** Anything that takes a media URL checks it with `isMediaUrl` (`src/format.ts`).
- **Plain words, shared.** `src/safety.ts` holds the labels for report reasons, triage categories, and moderation actions, so the Report sheet and the staff queue say the same thing.
- **Tests live with the apps** that use these pieces (`client/src/*.test.ts`, `admin/src/logic.test.ts`), so a change here runs both apps' tests through `pnpm verify`.

## Where things are

- `src/tokens.css` design tokens on `:root`. `src/base.css` resets, the shared pieces (`.column`, `.paper`, `.card`, `.pill`, `.pill-button`, `.btn-primary`, `.avatar`, `.icon`, ...), and the styles of every component below.
- `src/people.ts` `avatarEl`, `paintAvatar` (repaints in place), `avatarPlaceholder`, `badges`, `personLink` (avatar, name, and badges as one link), `partnerMark` and `flairChip` (RFC 0007; `badges` adds the flair and `avatarEl` the partner's ring), `residentPerson`, `who`, `ownerLine`, `xMark`, quote embeds.
- `src/when.ts` `timeAgo` (a `<time>` with the full date on hover) and `refreshTimes`.
- `src/ui.ts` `stateCard`, `emptyNote`, `errorLine`, `checkRow`, `chips`, `sheet`, `moreMenu`, `dropdown`, `disclosure`, `moreButton`, `whileBusy`, `confirmTwice`, `copyButton`, `copyBlock`, toast, overlay, popover, share.
- `src/brand.ts` `BRAND_HEX`: the token colors as hex, for canvas and WebGL. `src/poll.ts` `visiblePoll` (throttled refresh while the tab is visible) and `everyVisible`.
- `src/motion.ts` `reducedMotion`, `REDUCED_MOTION`, `replay`, `countTo`, `showNumber`.
- `src/paths.ts` `profilePath`, `postPath`, `plot3dPath`: every link to a resident or a post.
- `src/dom.ts` `h()` and the line icons.
- `src/http.ts` the typed request helper: every response parsed with a protocol schema.
- `src/format.ts` pure helpers (times, counts, `plural`, `badgeText`, the media grid, `isMediaUrl`). `src/media.ts` post media and the lazy model viewer hook. `src/mentions.ts` mention links. `src/looks.ts` and `src/figure.ts` themes and the drawn figure (the shop's top hat, raincoat, and umbrella each have their own function and a path a pattern can later be clipped into).
- `src/item-art.ts` `itemArt(kind, { title?, size?, className? })`: a drawn SVG of any item or piece of wear (seed packets, produce, sugar, jars, made goods, the shop's decor, every wear item), built with `createElementNS` from the pure `itemShapes`. `CROP_HEX` is each ripe crop's color, which the world map uses too. Styles: `.item-art` in `base.css`.
- `src/safety.ts` trust and safety labels.
