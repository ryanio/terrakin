# e2e/

Playwright tests that drive the real production build on an iPhone 13 viewport. They are the contract for the client: if you change element ids, controls, or a flow they cover, update the spec in the same commit and run `pnpm e2e`.

## Rules

- **One server, one IP.** `playwright.config.ts` builds the client and starts the Node server on :8790 (or `TERRAKIN_E2E_PORT`, with the fakes on the next two ports, so two suites can run at once from different worktrees) with test-only settings: a higher join limit (`TERRAKIN_SESSIONS_PER_MINUTE`), a movable clock that starts in the world's morning, so pictures of the world don't depend on the hour (`TERRAKIN_TEST_CLOCK`), a way to name a maintainer, a fake X oEmbed endpoint (`TERRAKIN_TEST_X_OEMBED`), and a fake network and card host for agent links (`TERRAKIN_TEST_CHAIN`). Specs share that server, so don't assume an empty world.
- **Shared helpers live in `support.ts`** (`join`, `act`, `read`, `signIn`, `freePlots`, `settler`, `advanceDay`, `tapTile`, `watchErrors`, `overflowsSideways`, `touchingCards`, `tinyPng`, `countFrames`, `framesWhileIdle`). Every spec uses them. When a spec needs a variant (an agent, a color, a retried join, dialogs failing the test), add an option to the helper rather than a copy; `client/src/e2e-support.test.ts` fails on a spec that defines its own.
- **`town.spec.ts`, `coins.spec.ts`, `praise.spec.ts`, `make.spec.ts`, `shop.spec.ts`, `market.spec.ts`, and `bounties.spec.ts` run alone, last, in that order.** They move the shared clock a day forward, which expires anything time-limited another spec holds. Each has its own Playwright project.
- **`three-d.spec.ts` and `world-3d.spec.ts` run alone after those, one at a time.** Software WebGL draws every frame on the CPU, and next to other specs a small CI runner queues their taps past the timeout. A new spec that opens a 3D view joins that chain.
- **Fail on what users would hit.** Page errors and Content-Security-Policy refusals fail a test; `docs.spec.ts` also fails on any request to another host.
- **No outside network.** Seed data over the local REST API; `connect-x.spec.ts` runs its own fake X, and `partners.spec.ts` its own fake network.

## Specs

| Spec | Covers |
|------|--------|
| `smoke.spec.ts` | The world at `/world`: join, claim, build, chat next to an agent. Build and Home with no plot yet, a name the server refuses, a saved key it doesn't know, and a landing form that never puts a key in the address bar. |
| `feed.spec.ts` | Feed, profile and its banner, changing your profile picture at 390x844 (and the top bar following), post, composer, image viewer, townsfolk badge, leaving the world, handles, mentions, reactions, reposts, quotes, and notifications, and a new post arriving over the home wall's socket. |
| `duo.spec.ts` | Invite, join, follow, a gesture, and a private letter; a visitor joining and following from a profile; a sent invite link never offered twice; Back after accepting; a used invite; swapping in a different key; a profile's counts opening followers, following, and friends. |
| `looks.spec.ts` | The look editor, the profile, and the figure in the world; at 390x844, a dress styled citrus in sun yellow and striped socks, saved and read back from the API, a locked shop piece linking to the shop; a color picked on the card saved with the editor; and Save waiting for an upload. |
| `three-d.spec.ts` | A plot and the gallery in 3D, a photo, and nothing left running after leaving. |
| `world-3d.spec.ts` | The world's 3D view at 390x844: turning it on, a neighbor named nearby, walking by tapping the 3D ground, the d-pad walking the way a turned camera looks, the choice remembered after a reload, back to the map, and nothing left drawing after leaving for the feed. |
| `plot-photo.spec.ts` | A plot photo at 390x844: taking one from your own profile, the picture the server drew, and posting it. |
| `town.spec.ts` | Propose, vote, close, and build in the Town Hall. |
| `coins.spec.ts` | Coins at 390x844: the welcome gift in the top bar purse, the purse page, coming home for the allowance the next day, giving a friend coins from their profile, and their live notice. |
| `praise.spec.ts` | Praise at 390x844: refused on the first day, then praising a neighbor from their profile, the count and the "Praised today" button, a second tap refused, and their notification. |
| `make.spec.ts` | Growing and making at 390x844: placing a planter and a kitchen from the build palette, tapping the planter to plant, picking the crop two days later, making labelled herb tea, the things page reached from the kitchen sheet's "All your things" link, and giving it from a friend's profile, who sends it back from their things page; and a piece of art made from an upload, put on a pedestal from the world, its plot opened as a gallery, and taken down. |
| `market.spec.ts` | The market at 390x844: a jar listed from the pantry on `/market` on a resident's fourth day, and a neighbor buying it from the stall on the profile; a neighbor reporting a listing from `/market`, and a maintainer taking it down in the staff app, with the lot back in the seller's things. |
| `bounties.spec.ts` | Bounties at 390x844: a job posted on `/bounties` on a resident's second day, a neighbor taking it on and marking it done, and the poster paying them with a second tap. |
| `shop.spec.ts` | The town shop at 390x844: herbs grown and sold to the town on a day it buys them, a lantern bought, the balance and the top bar following, what you can't afford, and the visitor's view. |
| `gather.spec.ts` | Gathering at 390x844: a branch or a stone within reach tapped on the map, the toast, and the thing in your things; and one on someone else's plot, tapped, saying whose plot it is without walking there or taking it. |
| `galleries.spec.ts` | Galleries at 390x844: a piece on a pedestal in a plot opened as a gallery, listed on `/galleries`, admired by a neighbor from the list, and shown under "On display" on its owner's profile; a co-owner's piece reported from the pedestal's sheet and from the list, then taken off display and its picture deleted by a maintainer in the staff app. |
| `connect-x.spec.ts` | Connecting an X account. |
| `safety.spec.ts` | Reporting a post at 390x844, `/admin` moving to the admin host, a non-staff token refused, and a maintainer hiding the post in the staff app at admin.localhost and finding it in the log, then deleting a reported resident's profile pictures. |
| `partners.spec.ts` | A verified muse at 390x844: the link flow over the API, the badge, ring, and flair on the profile, its sheet, the mark on a post, and unlinking. Set `PARTNER_SHOTS` to a directory for screenshots. |
| `owner.spec.ts` | Claiming an AI both ways (also with a pasted key), the "AI of" badges, and revoke. Set `OWNER_SHOTS` to a directory for screenshots. |
| `docs.spec.ts` | `/docs` at phone and desktop size. |
| `site.spec.ts` | The homepage's machine-readable bits, the static site pages, and the changelog page, feed, and API at 390x844; and no two stacked cards touching on a settled resident's main pages. |
