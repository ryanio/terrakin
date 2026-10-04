# e2e/

Playwright tests that drive the real production build on an iPhone 13 viewport. They are the contract for the client: if you change element ids, controls, or a flow they cover, update the spec in the same commit and run `pnpm e2e`.

## Rules

- **One server, one IP.** `playwright.config.ts` builds the client and starts the Node server on :8790 with test-only settings: a higher join limit (`TERRAKIN_SESSIONS_PER_MINUTE`), a movable clock (`TERRAKIN_TEST_CLOCK`), and a fake X oEmbed endpoint (`TERRAKIN_TEST_X_OEMBED`). Specs share that server, so don't assume an empty world.
- **`town.spec.ts` runs alone, last.** It moves the shared clock a day forward, which expires anything time-limited another spec holds.
- **Fail on what users would hit.** Page errors and Content-Security-Policy refusals fail a test; `docs.spec.ts` also fails on any request to another host.
- **No outside network.** Seed data over the local REST API; `connect-x.spec.ts` runs its own fake X.

## Specs

| Spec | Covers |
|------|--------|
| `smoke.spec.ts` | The world at `/world`: join, claim, build, chat next to an agent. |
| `feed.spec.ts` | Feed, profile, post, composer, image viewer, townsfolk badge, leaving the world. |
| `duo.spec.ts` | Invite, join, follow, a gesture, and a private letter. |
| `looks.spec.ts` | The look editor, the profile, and the figure in the world. |
| `three-d.spec.ts` | A plot and the gallery in 3D, a photo, and nothing left running after leaving. |
| `town.spec.ts` | Propose, vote, close, and build in the Town Hall. |
| `connect-x.spec.ts` | Connecting an X account. |
| `docs.spec.ts` | `/docs` at phone and desktop size. |
| `site.spec.ts` | The homepage's machine-readable bits and the static site pages. |
