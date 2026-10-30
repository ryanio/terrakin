# packages/client/

Mobile-first web client. It shows what the server says and never decides anything. How the pages fit together: [docs/architecture.md](../../docs/architecture.md).

## Rules

- **No game rules.** The server decides; show its answer, in plain words (`worldProblem` in `src/things.ts` for the world's refusals). You may hold back a button the mirror or your inventory already shows it would refuse (no plot for Build, an unripe crop), as long as the reason is on screen and the check is the sim's own exported function (`canBuildOn`, `isReady`, `harvestFits`), never a copy. UI hints like the reach outline are fine. A cost, a name, or a rule a page shows comes from the sim or the server's answer, never a number or a list written here.
- **Mirror, don't simulate.** `src/mirror.ts` applies server events. If `apply()` reports a gap, reload the snapshot.
- **Resident text is text.** Build DOM with `h()` from `@terrakin/ui/dom` or `textContent`. Never `innerHTML`, `insertAdjacentHTML`, or template strings for names, chat, posts, or notes. On a canvas, chat and names are canvas text only. Lines that carry a resident's name use the player-text style.
- **Phone first.** Test at 390x844 before desktop. Tap targets at least 44px (`--tap` is 52px), inputs at 16px so iOS doesn't zoom, respect `env(safe-area-inset-*)`. In the world the map is the point: under 480px the HUD gives back as much of it as it can (one media query at the foot of `src/world.css`), so a new control there is weighed against the world it hides. Every button there says what it does in words, the four actions with the word under the icon; only the speaker and the 3D view go by their sign alone. While you walk (`data-walking` on the HUD) the corner chrome dims and comes back when you stop, while what the world pins to your figure or says to you stays bright; it never moves or hides, so a button stays under your thumb and in the accessibility tree. Nothing on a page scrolls sideways.
- **Reduced motion.** Under prefers-reduced-motion everything that moves holds still (signs, weather, fireworks, flames, the kiln reveal), and figures stand on their tiles while walks keep their pace.
- **Only our media.** An img, video, avatar, or model loader takes a URL only through `isMediaUrl` (`/media/m_` plus 16 hex). Letter pictures go through `isLetterMediaUrl` (`src/letter-media.ts`), fetched with the token and shown from a `blob:` URL the page revokes. Partner art only through `isPartnerArt` (`/partners/<id>/<name>.svg`, our own copies in `public/partners/`).
- **The first load has a budget.** The build fails when the entry script and what it imports up front pass `FIRST_LOAD_BUDGET` gzipped (`vite.config.ts`). The budget never buys a smaller number with worse code: no shorter names, merged functions, or helpers left in the wrong module to save bytes. Run `node scripts/first-load.ts` before and after a change to it. The build cuts the first load into `vendor`, `rules`, and the entry by package, so more modules cost nothing, but a module the first load imports rides in it even when only a lazy page uses it. So:
  - Every page but the feed is built through `lazyView` in `main.ts`'s `pageFor`; a new page goes there as an `import()`.
  - REST calls are one module per API area in `src/api/`, and a page imports its own area's. A call only a lazy page makes never goes in a module the first load imports, and there is no file that re-exports them all. Every response is parsed with the protocol schemas. `src/first-load.test.ts` lists the areas the first load may import.
  - A style only a lazy view draws goes in that view's own stylesheet, beside its module and imported by it (`world.css` by `world.ts`); `src/style.css` holds what the first load can show. `src/shared-components.test.ts` fails on a sheet imported anywhere else.
  - A helper a first-load module needs lives in a small module of its own, never in a page's module (`letter-media.ts`, `visit-plot.ts`, `world-link.ts`).
  - The build drops the protocol schemas' descriptions (`noSchemaDescriptions`, `src/strip-describe.ts`) and stands in for zod's JSON Schema modules (`noJsonSchema`, `src/no-json-schema.ts`).
- **three.js stays lazy.** Import `three` only in `src/model-viewer.ts` and `src/scene3d/`, reached through `import()`; `view-3d.ts`, `world.ts`, and `photo-page.ts` are the only doors into `scene3d/`. `scene3d.test.ts` fails otherwise. 3D work follows the art direction and budget in [decision 0030](../../docs/knowledge/decisions/0030-3d-art-direction-and-performance-budget.md), and the world in 3D the view radius and frame budget in [decision 0060](../../docs/knowledge/decisions/0060-the-world-in-3d-draws-a-view-radius-around-you-within-a-fram.md). The night adds no new lights and no shadows.
- **Sound stays lazy, and off until tapped.** The sound code (`src/sound/soundscape.ts`, `voices.ts`, `mix.ts`) is reached only through `import()` from `src/sound/switch.ts`, which makes the AudioContext inside the tap that turns sound on, never before. `sound.test.ts` fails on a static import, and `e2e/sound.spec.ts` on a context made before the tap. Sounds are made with code, never files, and only your own moments make one.
- **Telemetry gets templates, not people.** GA4 and Sentry never see names, text, tokens, or ids: pages are templated (`/r/:id`), titles fixed, clicks reduced to `tag#id.class`. They run only on a production build served from terrakin.org, and Sentry only in browsers new enough to run the app, dropping any error whose every script is a browser extension's (`fromBrowserExtension`). What each may receive is [decision 0015](../../docs/knowledge/decisions/0015-ga4-and-sentry-and-what-they-may-receive.md); `telemetry.test.ts` pins it. Our own breadcrumbs go through `appCrumb` and carry codes and templates, never text. In GA4 admin, Enhanced measurement's "Page changes based on browser history events" and "Form interactions" must stay off.
- **The CSP is in `vite.config.ts`.** A new third-party script, font, or endpoint needs adding there, or the browser blocks it. `jitless.ts` is imported first so zod never probes `new Function` and the CSP sees no eval. The docs are static pages and load nothing beyond the site's stylesheet, fonts, and their one script.
- **A new route needs a case in `matchPage`** (`packages/server/src/page-meta.ts`).
- **The e2e suite is the contract.** Changing element ids, controls, or the join flow means updating `e2e/` in the same commit ([e2e/AGENTS.md](../../e2e/AGENTS.md)).
- **Pure modules stay pure.** `things.ts`, `pulse.ts`, `plot-market.ts`, `walk.ts`, `floors.ts`, `roofs.ts`, `resting.ts`, `lands.ts`, `pets.ts`, `fishing.ts`, `nearest.ts`, `tea-spots.ts`, `presents.ts`, `glaze-words.ts`, `weather.ts`, and `scene3d/world-layout.ts` are pure and tested: keep their decisions out of DOM code. (`weather.ts` also paints its sprites on a canvas; its choices stay in the functions `weather.test.ts` calls.)
- **Keep it light.** Plain DOM and canvas. A UI framework needs a decision record.
- **Pick a page layout.** Every page is a `pageLayout` (main and sidebar), a `wideLayout` (a grid of cards: Visit, Galleries), or a `.column` (forms and lists). Put what someone came for in the main column and what supports it in the sidebar.
- **A page loads through `lazyView` and `pageData`.** `lazyView` shows `skeletonPage` in the page's own layout (`SHAPES` in `main.ts`) until the page's `ready` resolves, with the page in the document but hidden. So a page draws no placeholders of its own for its first load, nothing in its `load` may measure, scroll, or take focus before `ready`, and `ready` resolves once the first content is in, not after later requests. A page that has to (a post's reply box, a letter thread, or tabs that open a sibling page) passes `own` and shows its own placeholders. A new page gets its data through `pageData` in `page-data.ts`: it drops answers for a page that was left, never overlaps asks, and a failed refresh leaves the page as it is. The feed, the profile, and the Town Hall keep their own loads.
- **A system shows only once it is open.** Jobs, circles, recipes, levels, pottery, lands, ways, and the plot market draw nothing and ask nothing until the snapshot or a profile says the world has opened them (`jobsOpen`, `circlesOpen`, `recipesOpen`, `level`, `clayOpen`, `plotMarketOpen`, ...). A world without one draws exactly as it did. Every Node world opens the systems terrakin.org runs.
- **A button sends the server's moves.** Where the server lists `you.moves` (events, bounties, games, circles, jobs), a button is one of them, and a refusal shows in words under it. Anything that spends coins, gives something up for good, or can't be undone is a second tap (`confirmTwice`): Hand in, Add an upstairs, paying or taking back a bounty, buying a plot, taking a plot listing back.
- **Build from the design system.** Tokens are on `:root` in `packages/ui/src/tokens.css`, sizes come from its scales, and layout from the primitives (`stack`, `cluster`, `plain-list`) ([packages/ui/AGENTS.md](../ui/AGENTS.md)); shared pieces are in `packages/ui/src/base.css`, which `src/style.css` imports. The staff app uses the same two files.
- **Use the shared components.** Root rule 11. Avatars, `personLink`, badges, `timeAgo`, state cards, empty notes, checkbox rows, sheets, and paths come from `packages/ui/`, with their styles in `base.css`. Here: `actProblem` (`src/api/world.ts`) for action results, `actFromButton` (`src/act.ts`) for a button that sends one action and refreshes the purse and page, and `colorChips`, `hairColorChips`, `hairChips`, `shapeChips`, and `dotChips` (`src/join-form.ts`). Don't build one by hand or restyle it here; `src/shared-components.test.ts` fails if you do, and on a selector defined twice in `src/style.css`.

## Writing tests

A unit test here answers the four questions in the root [definition of done](../../AGENTS.md#definition-of-done) first. Here the lowest level is the pure functions (words, layouts, the mirror, the walker) given real inputs. The source checks in `shared-components.test.ts`, `scene3d.test.ts`, `sound.test.ts`, and `first-load.test.ts` stay, because each is the cheapest guard of a rule above. A module this file calls "pure and tested" keeps its decisions out of the DOM code so they can be tested that way.

## Where things are

- `index.html`: all static DOM, including the Move in card, the world loader, and the footer slots. `src/main.ts`: boot, top bar, `pageFor`. `src/router.ts`: routes. `src/view.ts`: the page interface and shared cards (`errorCard`, `notFoundCard`, `joinCard`).
- `src/api/`: `request.ts` (the one request helper and the token), then one module per API area exporting one object (`shopApi`, `townApi`, ...). `me.ts` is who this browser is.
- `src/net.ts`: the WebSocket. `src/mirror.ts`: the client's copy of the world. `src/things.ts`: plain words for items, coins, and refusals.
- Pages are `*-view.ts` (`feed-view.ts`, `profile-view.ts`, `town-view.ts`, ...), with sections, cards, and sheets named for what they show (`jobs-section.ts`, `post-card.ts`, `report-sheet.ts`). Passkeys are `passkey*.ts`, joining is `join-form.ts` and `landing.ts`, the purse is `purse.ts`. `/admin` redirects to the staff app (`packages/admin/`).
- The world: `world.ts` (the page, its own chunk, which sends the world's actions) and `world.css`, `walk.ts`, `motion.ts`, `camera.ts`, `overhead.ts`, `render.ts` with its passes in `render/`, the build bar in `build-palette.ts`, and the sheets a tap opens (`garden-sheet.ts`, `home-sheet.ts`, `claim-sheet.ts`, ...).
- `scene3d/`: `art.ts` (the shared stage, `scoped`, `addAll`), `world.ts`, `plot.ts`, `page.ts`, and one builder per part. `view-3d.ts` is the 3D pages. `sound/`: `switch.ts` and the lazy rest.
- The scene photo page (`/photo`, [RFC 0049](../../docs/rfcs/0049-scene-photos.md)): `photo.html` and `src/photo.ts`, its own small build (`photoPage()` in `vite.config.ts`, [decision 0384](../../docs/knowledge/decisions/0384-the-scene-photo-page-is-its-own-small-build-beside-the-app-s.md)), `src/photo-page.ts` (the scene, the camera, the tags, the stamp), and the pure, tested `src/photo-framing.ts` and `src/photo-tags.ts` ([decision 0385](../../docs/knowledge/decisions/0385-a-scene-photo-frames-its-subject-from-a-clear-side-and-tags-.md)). It never sends an action, draws only the residents its scene names, and says `data-photo="ready"` or `failed` on the body. A browser kept open asks it for the next photo with `photoNext(ticket)`, and it keeps its 3D world and stage between photos, so each photo has to come out as a fresh page would draw it. Its stage is still (`still` in `scene3d/art.ts`) and draws the one frame the photo needs. A `near` or `wide` photo takes the roofs off its plot and the plot south of it (`openRoofs`), so whoever is home shows and no neighbor's roof covers the front.
- Shared with the staff app in `packages/ui/`: DOM, layout, people, times, paths, looks, figures, item and pet art, skeletons, tokens, and `base.css`.
- Docs pages: `src/site-page.ts`, `src/markdown.ts`, `src/docs-copy.ts`, `src/docs-sections.ts`, and the `terrakin-site` plugin in `vite.config.ts`.

## Rules by system

Home wall:
- The town comes before the posts, and the wall never leads with an empty number: the pulse card's second number is who's online, else plots claimed, and who's around never lists you. A long post folds behind Show more (`foldText`); its pictures always show. Nothing on the wall scrolls in a box of its own.
- The first paint goes in at once: the composer, the cards above the posts, and the posts wait behind one `.wall-fill` placeholder until all are in or `FIRST_PAINT_MS` passes (`whenPainted`). `e2e/feed.spec.ts` holds its layout shift under 0.05. A card that loads after the paint joins only once its place is scrolled out of sight (`whenUnseen`), so it never moves what's being read.
- New posts come as ids on a `watch` socket while the page is visible, with polling as the fallback. Townsfolk fill in only while real activity is thin. The devlog card, once opened or hidden on this device, stays away until a newer post.
- The front page's live line has its height set before any part is in, each part one line cut short, so filling it moves nothing; it shows no 0 and no line for an empty town.

Posts and social:
- Mentions, quotes, and web addresses go into text nodes and links, never HTML, and a link in a post leaves through `/away`, which names the host and shows the whole address.
- A like, reaction, or repost shows at once and goes to the server one request at a time (`PostToggles`), so a quick second tap is never lost and the counts end as the server's.
- A profile's avatar repaints on `MY_PROFILE_EVENT`, fired by `rememberMyProfile` and `forgetMe` after you change your own profile.

Joining and guests:
- Someone with no character walks the town first as a guest: a figure put in the mirror as `GUEST_ID`, walked by the same `Walker` and answered here, never sent, never counted, seen by nobody else. A guest's tap only walks. The canvas's `data-at` is where your figure stands, a guest's too. Its `data-settled` says the near column has taken its first shape (`markNearSettled` in `world.ts`), which e2e taps wait for.
- A name field keeps to the naming rule as it's typed (`nameRule`): the sim's `NAME_RULE_WORDS` as the hint and the sim's `nameProblem` asked before anything is sent. Suggest fills the field only while it's empty or still holds the last idea, so a typed name is never overwritten, and never offers a name the server refused with `name_taken`.
- A fresh join settles the plot Live here was tapped on, else opens the Claim plot picker (`claimOnJoin`), never for a returning character or a join from a link's place.
- No shape on join: `joinLook` sends the first shape with the hair and top.

Passkeys:
- `passkey.ts` is only the translation; every check is the server's. `passkeyWhy` is the one place a refused ceremony is put into words. Sign in with a passkey is hidden where the browser can't use one, rather than offered and refused.
- The passkey offer opens at most once a day per device, only after the page has been clear of sheets for `SETTLE_MS`, and steps aside for any sheet that opens over it. It and the home wall's prompt stay out of first-visit steps, which are server state the check-in reads. Remove and "Sign them out" say what sessions they end.

Getting started:
- `first-steps.ts` words `GET /v1/first-visit`; the jobs step shows only once the server lists `jobs`.
- The world's next-step chip stays away only where the button for its own step is already on screen and is no wider than the chips it stacks with. Plant a seed is one tap planned by `planFirstPlanting`, each action checked like any other; with no plan it says how by hand (`plantByHandLine`), never the step's hint.

A first plot and a home:
- The claim picker offers only plots the sim's `settleProblem` would take (never water or a street), and prefers a claim that closes nobody in by the sim's `claimExitsFrom`; a pick that would take a neighbor's last exit says so.
- Building a home follows `homeSteps` (a hearth already set isn't set again, `already_home` counts as done), sends nothing if the sheet is closed during the walk, and falls back to `build_starter_home` when the designs can't load.
- Until the mirror shows a plot of yours, `paintSettled` keeps the HUD to walking, Claim plot, Chat, the Feed link, and the buttons for where you stand; `index.html` starts the rest hidden.

Walking and the map:
- Walking: each step is checked with the sim's `stepFrom` against the mirror and drawn at once, at most two steps wait on the server and none while the mirror reloads, and a refusal stops the walk and walks you back to the server's tile. The pace never depends on key repeat or the network. `walk.ts` is pure and tested.
- `motion.ts` and `pets.ts` decide only drawing. Anything that has to agree across screens (a pet pottering at home) comes from the server clock and a hash of an id, never local randomness.
- A tap in 3D reaches the same `tapTile` as one on the map. A tap on something you can't build on names it and walks nowhere (`thingHereLine`). Your own pet and hearths never catch a tap meant to walk.
- Residents away sleep at their hearths and those out on a routine are drawn faded where they are. Online counts, "Nearby", and taps never include them.
- A link into the world only looks; going there is a tap. `world-link.ts` has no imports, since the first load reads it.
- In 3D the d-pad walks relative to the camera (`turnDir`); the `move` command is unchanged. Name tags, signs, and chat bubbles draw with `overheadMaterial` (no depth test), so no wall hides them. Lists of parts go into a scene through `addAll`, never `add(...list)`.
- World and game times come from the server's clock (the anchor in `time.ts`, a game's `now`), and a routine's hour shows in your own time and is sent as the UTC hour.

Building:
- A pick the world would refuse stays pickable, dimmed, with the reason under the tabs, and the world holds back the tap; the checks are the sim's (`groundShort`, `blockNeeds`). A build note never holds a tap back. Building closes chat, and opening chat ends building.
- Floors (RFC 0028): the mirror's `blocks` and `paving` stay the ground floor's, and a walk keeps to one floor. `floors.ts` decides which floor each tile shows. A world with nothing upstairs draws as it did.
- Roofs (RFC 0041) use the sim's `roofShape` and `roofTone`. The roof over the plot you stand on lifts away, and a picture of a plot leaves its own roof off.
- Lands, streets, and ways (RFC 0038, RFC 0046): the sea comes from the sim's `seaFrom`. Town squares (a plaza, `PLAZA_LOOK`), streets, and public ways are drawn through `Mirror.drawnPaving` only; walking, building, and lifting never see them, and a way never looks like a path someone laid.
- A Town Hall build dims nothing, since the town pays.

Growing, making, and finds:
- A station's sheet lists only what `inventory.recipes` says you know once recipes are learned (RFC 0024), since the mirror doesn't carry what anyone learned. Gather all leaves out recipe pages you know (the sim's `pageKnown`).
- Fishing (RFC 0023) shows Fish where the sim's `waterBeside` finds water. With no rod it says how to make one rather than sending `fish`.
- Pottery (RFC 0047): a firing pot's kind shows only to its loader, by the sim's `potName`. Every cost, odds, and name comes from the sim (`kilnLabel`, `FINISHES`, `firePotSteps`), never the page. Tea stands on a table or hearth, never a house's floor (`teaSpots`, pure and tested), and Serve is held back while nobody would be counted.

Levels, jobs, and circles:
- Levels (RFC 0029): the server counts and checks everything. A neighbor's skills show levels only, since their points are private. Titles show on profiles only, and nothing lists residents by level.
- Jobs (RFC 0030): in a world without jobs no page asks `GET /v1/jobs`. Every job button goes through `jobActs` and is off while one is out; overlapping reads land only the newest answer (`newestOnly`); a read that fails leaves what's drawn, and only `open: false` hides the section.
- Circles (RFC 0033): the server owns membership. Buttons are the server's `you.moves`, except Join (shown on any invite so the world's refusal says why) and the steward tools, shown to a steward. Days are human words, never a day's number.

Visiting, markets, and money:
- Players see coins, never tokens.
- A plot card's change line is the server's own `news`, never worked out here. A plot thumbnail's `aria-label` names who's standing there, since the card's words don't.
- The plot market checks a sale with a dry `buy_plot` or `list_plot` first and acts on a second tap. Claim plot stays away past a first plot once plots are for sale (the sim's `claimLimit`).
- Takedown notices are from Terrakin, with a neutral mark and no avatar or profile link, worded from the notice's fields only. Bounties follow [decision 0062](../../docs/knowledge/decisions/0062-a-maintainer-confirms-town-bounties-and-bounties-and-grants-.md).
- A link-only AI's token upgrade follows [decision 0241](../../docs/knowledge/decisions/0241-a-link-only-agent-trades-its-link-key-for-a-token-once-its-o.md). A plot photo keeps its plot and jumps there. On a phone the plot card rests folded in the top row.

Looks, weather, and the night:
- Hair is a style and a color, drawn under hats. The look editor offers holiday, partner, earned, and job wear only when the shop, `entitled`, `GET /v1/progress`, or `GET /v1/jobs` says so.
- Weather is a pure function of the world's day and the UTC hour, from the sim's `skyAt` and `weatherSpells`. Holidays come from the snapshot and the sim (`trickOrTreatDay`, `fireworkNight`).
- At night, what glows is the `glow` mark on a block's look in `scene3d/palette.ts`, and `daylight.test.ts` keeps the map's `mapGlow` and the 3D views lighting the same kinds. Windows light only in a home someone's in, and every night in the Town Hall and the shop, whose lit windows the map reads from `civicLights` in `render/buildings.ts` to match the 3D glass. Plot photos stay in daylight.

Docs and static pages:
- terrakin.org/docs is static pages whose one script is `src/docs-copy.ts`, bundled alone by `docsCopyScript` so the app's first load never changes for it. `/docs` keeps only SKILL.md's getting-going sections. Which pages are built is the `built` field in the protocol's `PAGES`. A docs page's title has no id, since the app's stylesheet styles ids like `#world`.
- The static pages in `packages/protocol/src/site.ts` are rendered from `docs/site/*.md`, the root `CHANGELOG.md`, and `docs/devlog`: edit the Markdown, never the output. How to play loads no script (its section links light with CSS scroll-driven animations), and a new section needs an entry in `GUIDE_SECTIONS`. Every page has one footer, `footerHtml()` in `src/site-page.ts`; change it there, never in a page.

## Running

`pnpm dev` from the root starts the server and Vite. Vite proxies `/v1` (including the socket), `/media`, the Markdown twins, the sitemaps, and `/og/` to `TERRAKIN_SERVER` (default `http://localhost:8787`). Open the printed network URL on your phone to test on a real device.

`pnpm dev:live` runs this client on :5193 against `https://terrakin.org`, so every page draws the live town over the public API, with nothing copied ([decision 0309](../../docs/knowledge/decisions/0309-the-dev-client-can-read-the-live-world-and-only-read-it.md)). It only reads (`readsOnlyFromElsewhere` in `vite.config.ts`): with `TERRAKIN_SERVER` anywhere but this machine, the dev server answers anything but a GET or HEAD under `/v1`, `/media`, or `/og` with `405 read_only` before the proxy sees it. To see a page that needs a resident, use `pnpm dev:test` and `pnpm persona`, and never paste a live token into it.
