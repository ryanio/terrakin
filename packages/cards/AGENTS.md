# packages/cards/

Link preview cards (the 1200x630 images X, Discord, Slack and iMessage show for a shared link). satori lays out a template as SVG, resvg (wasm) draws the PNG. The same code runs in a Cloudflare Worker and in Node. [Decision 0028](../../docs/knowledge/decisions/0028-link-preview-cards-and-page-meta-at-the-edge.md) says why.

Depends on nothing in the repo, so the colors and sizes it keeps from the sim, `packages/ui`, and the map are copies, and `packages/client/src/cards-copies.test.ts` checks each against its source: a new copy gets a line there. The server turns API data into a `Card` (`packages/server/src/og.ts`) and serves it.

On Cloudflare this package is a Worker of its own, `terrakin-cards` (`cloudflare/worker.ts`, the root `wrangler.cards.jsonc`), which the main Worker asks for a drawing over its `CARDS` service binding ([decision 0299](../../docs/knowledge/decisions/0299-card-drawing-moves-to-a-worker-of-its-own-reached-over-a-ser.md)). satori, resvg's wasm and the fonts are about 3.5 MB, and the main Worker runs on every request, so they stay out of it. The contract is `CardDrawer` in `src/render.ts`, which both sides use; a `Card` and a `Rendered` are plain data, so both cross RPC as they are. `pnpm cf:deploy` uploads this Worker before the main one, since a service binding to a Worker that doesn't exist is refused.

The cards Worker also takes scene photos ([RFC 0049](../../docs/rfcs/0049-scene-photos.md), `SceneDrawer`, `cloudflare/scene.ts`): it drives Browser Run over its `BROWSER` binding, loading only the main site's photo page and failing every other request. A browser stays open two minutes after its photo and its photo page takes the next ticket in place, so the scene's drawing programs stay compiled (decisions [0382](../../docs/knowledge/decisions/0382-scene-photos-are-drawn-by-browser-run-in-the-cards-worker-on.md) and [0390](../../docs/knowledge/decisions/0390-scene-photos-keep-a-browser-and-its-photo-page-open-two-minu.md)). It speaks the DevTools protocol over the binding's own socket, with no browser library, since the one Cloudflare publishes brings dependencies for downloading browsers that fail the audit ([decision 0387](../../docs/knowledge/decisions/0387-browser-run-is-driven-over-its-devtools-socket-with-no-brows.md)).

## Rules

- **Resident text is drawn, never parsed.** Names, bios and posts are string children of `text()` boxes. Nothing here builds markup from them; `svg()` and `img()` only ever take our own markup and data URIs the server checked with `imageDataUri()`.
- **Check every value before it's drawn.** Colors go through `safeColor` (`src/color.ts`), and every number in a plot is kept to its tile. `drawingSvg` checks each part of a figure (paths of commands and numbers, safe colors, its own clip and tile indices, capped counts). `petSvg` draws only the tags, attributes, and path data it checks, never a name.
- **`probeImage` reads hostile bytes.** It is the one image header reader in the repo, and the server sizes uploads with it (`packages/server/src/image-size.ts`). It checks every length against the file, allocates nothing from a length it read, and walks a JPEG once. A change to what it accepts changes what size a post records, so it comes with a case in `cards.test.ts` and has to pass `packages/server/src/image-size.test.ts`.
- **Clean and cut every string a resident wrote.** `drawable()` drops what the fonts can't draw (emoji, scripts outside Latin) and returns undefined when too little is left; `clip()` caps the length. satori wraps text but never shortens it.
- **Keep a render cheap**, about 100 ms in Node. No blurred `boxShadow` (each is a Gaussian blur), no SVG filters per card. The paper grain is rasterized once per process (`render.ts`).
- **Boot the wasm once.** `createCards()` boots once per process or isolate, since resvg refuses a second `initWasm`; each engine keeps one.
- **resvg reads `mix-blend-mode` only as CSS** (`style="..."`), never as an attribute.
- **A posted plot photo is a picture of its own, not a link card**: 1080x1350 (`POSTED`, laid out at 540x675 and drawn twice over), the instant photo filling it but for a thin clear margin, so whatever shows it is its paper. It has no grain of its own, since stretching the grain over a picture that size costs more than the rest of the drawing. Its stamp never lands on the brand under it. A post's card draws it bare and whole at the card's height (`imageFramed`), never in a second border.
- **Crops grow as the map grows them.** `FRUIT_SET` and the swell in `src/plot.ts` match the map's `paintCrop` (`packages/client/src/render/blocks.ts`); change both together.
- **Bump `CARDS_VERSION`** in `templates.ts` when a card's look changes, so cached cards are drawn again.
- **`src/brand.ts` is generated** by `pnpm brand` from `scripts/brand/logo.ts`. Don't edit it.
- **Fonts are the static WOFF files from @fontsource** (satori can't read WOFF2). `fonts.ts` lists them for Node and `worker.ts` imports the same files for wrangler; a test keeps the two in step.
- **satori stays pinned at 0.32.0.** Later versions load HarfBuzz from a separate wasm at run time, which Workers refuse. A test fails on a satori that imports it, and `.github/dependabot.yml` ignores satori, so move the pin by hand and only after a card draws under `pnpm cf:dev`. After each deploy, CI's `smoke` job asks the live Worker for three pictures and fails on the redirect to `/og.png` a Worker that can't draw sends (`scripts/deploy-smoke.ts`, [decision 0250](../../docs/knowledge/decisions/0250-a-smoke-check-asks-the-live-worker-for-drawn-pictures-after-.md)).

## Layout

- `src/templates.ts` the card types (`site`, `page`, `profile`, `post`, `plot`, `near`, `look`), their element trees, `cardSize` (1200x630, or `POSTED` for a posted plot photo), and `CARDS_VERSION`. `src/h.ts` the element builder (`div`, `text`, `img`, `svg`). `src/text.ts` cleaning, clipping, counts and dates (`cardText`, `drawable`, `clip`, `fit`).
- `src/plot.ts` the plot photo (`plotSvg`, `PlotCard`): our own SVG of a plot from data the server builds, with walls and their surfaces (a block's `marks`, from the sim's `WALL_LOOK`), decor (`PLOT_DECOR`), furniture (`PLOT_FURNITURE`), paths, ponds, crops (`PlotCrop`), pets (`petSvg`), upper floors (`PlotFloor`), and the sliver of world around it. `areaParts` draws any rectangle of the world (`PlotArea`). A photo can be `posted` (a tall instant photo, 1080x1350, for a post) or the card for a link, and can carry a `sky`, a `stamp`, a `title`, and a `story`.
- `src/pictures.ts` the other pictures by link: the map around someone (`nearSvg`) and the look card (`lookSvg`), both through `areaParts`.
- `src/drawing.ts` figures as recorded `Drawing`s, checked and drawn by `drawingSvg`. `src/color.ts` `safeColor`.
- `src/sky.ts` the sky every picture from above shares: `Sky`, `skyParts`, `nightWash`.
- `src/render.ts` `createCards()`: boots the wasm, rasterizes the paper, renders a card to PNG. `CardDrawer` is the contract both Workers use.
- `src/node.ts` and `src/worker.ts` the two engines; `src/fonts.ts` the font files for Node. `src/index.ts` the types and pure helpers, with no wasm. `cloudflare/worker.ts` the cards Worker, whose one RPC method is `render`.
- `src/images.ts` `probeImage` (a picture's type and size from its header) and `imageDataUri()`, which refuses formats resvg can't draw and pictures too big to decode in a Worker.
- `src/brand.ts` palette, mark and grain.

## Looking at them

`pnpm --filter @terrakin/cards samples <dir>` writes every sample card (`src/samples.ts`) as `og-<name>.png`. Look at them after any template change.
