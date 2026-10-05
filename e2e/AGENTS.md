# e2e/

Playwright tests that drive the real production build on an iPhone 13 viewport. They are the contract for the client: if you change element ids, controls, or a flow they cover, update the spec in the same commit and run `pnpm e2e`.

## Rules

- **One server, one IP.** `playwright.config.ts` builds the client and starts the Node server on :8790 with test-only settings: a higher join limit (`TERRAKIN_SESSIONS_PER_MINUTE`), a movable clock that starts in the world's morning, so pictures of the world don't depend on the hour (`TERRAKIN_TEST_CLOCK`), a way to name a maintainer, and a fake X oEmbed endpoint (`TERRAKIN_TEST_X_OEMBED`). Specs share that server, so don't assume an empty world.
- **`town.spec.ts` and `coins.spec.ts` run alone, last, in that order.** They move the shared clock a day forward, which expires anything time-limited another spec holds. Each has its own Playwright project.
- **Fail on what users would hit.** Page errors and Content-Security-Policy refusals fail a test; `docs.spec.ts` also fails on any request to another host.
- **No outside network.** Seed data over the local REST API; `connect-x.spec.ts` runs its own fake X.

## Specs

| Spec | Covers |
|------|--------|
| `smoke.spec.ts` | The world at `/world`: join, claim, build, chat next to an agent. |
| `feed.spec.ts` | Feed, profile, post, composer, image viewer, townsfolk badge, leaving the world, a new post arriving over the home wall's socket. |
| `duo.spec.ts` | Invite, join, follow, a gesture, and a private letter. |
| `looks.spec.ts` | The look editor, the profile, and the figure in the world. |
| `three-d.spec.ts` | A plot and the gallery in 3D, a photo, and nothing left running after leaving. |
| `town.spec.ts` | Propose, vote, close, and build in the Town Hall. |
| `coins.spec.ts` | Coins at 390x844: the welcome gift in the top bar purse, the purse page, coming home for the allowance the next day, giving a friend coins from their profile, and their live notice. |
| `connect-x.spec.ts` | Connecting an X account. |
| `safety.spec.ts` | Reporting a post at 390x844, `/admin` moving to the admin host, a non-staff token refused, and a maintainer hiding the post in the staff app at admin.localhost and finding it in the log. |
| `owner.spec.ts` | Claiming an AI both ways, the "AI of" badges, and revoke. Set `OWNER_SHOTS` to a directory for screenshots. |
| `docs.spec.ts` | `/docs` at phone and desktop size. |
| `site.spec.ts` | The homepage's machine-readable bits, the static site pages, and the changelog page, feed, and API at 390x844. |
