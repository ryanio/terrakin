---
title: Scene photos built and dark, RFC 0049 slices 1 to 5
date: 2026-10-29
tags: [server, client, cards, protocol, photos]
---

# Scene photos built and dark, RFC 0049 slices 1 to 5

## Done

RFC 0049, scene photos, is built through slice 5 and is dark: `POST /v1/photos`, `GET /v1/photos/moments`, and `GET /v1/photos/scene/{ticket}` answer 404 until the `scenePhotos` option is on. terrakin.org leaves it off (no `TERRAKIN_SCENE_PHOTOS` in `wrangler.jsonc` vars). Nothing in the sim changed.

- Spike (slice 1): WebGL 2 draws in Cloudflare Browser Run (SwiftShader). Measured with a scratch Worker under `wrangler dev` whose `browser` binding was `remote`, so the browser was Browser Run itself, not a deployed staff route. The full `/world?view=3d` page took about 30 s a render; the photo page takes 3 to 5 s on Node. Live Browser Run timing for the photo page isn't measured yet ([decision 0382](../decisions/0382-scene-photos-are-drawn-by-browser-run-in-the-cards-worker-on.md)).
- The photo page (slice 2): `packages/client/photo.html`, its own nested build ([decision 0384](../decisions/0384-the-scene-photo-page-is-its-own-small-build-beside-the-app-s.md)), with the camera in `photo-framing.ts` and the tags in `photo-tags.ts`, both pure and tested ([decision 0385](../decisions/0385-a-scene-photo-frames-its-subject-from-a-clear-side-and-tags-.md)).
- The route (slices 3 and 4): every guard runs before a browser opens, and render 101 of the day is refused (`scene-photos.test.ts`). The ticket is a random id held a minute in memory ([decision 0383](../decisions/0383-a-scene-photo-s-ticket-is-a-random-id-the-world-object-holds.md)). Browser Run runs in the cards Worker over its `BROWSER` binding, added to `wrangler.cards.jsonc`; the main Worker's bundle is unchanged. Node uses Playwright's Chromium (`playwright-core` in the server).
- Moments (slice 5): kept an hour in `photo_moments`, read from each committed input's events (`momentsOf`), on the check-in as `photoMoment`.
- SKILL.md has the five new error codes and the changelog has one entry; the routes stay `internal` ([decision 0386](../decisions/0386-scene-photos-ship-dark-with-their-error-codes-in-skill-md-an.md)).
- QA on `pnpm dev:test`: a portrait inside a home and outside, a pumpkin-head costume portrait, near and wide, a plot, an event crowd of 16 with names, someone at the frame's edge, night, and rain, each looked at. What was wrong and fixed is in decision 0385. `e2e/town.spec.ts` photographs a real crowd and checks every tag box.

The `reviewer` subagent's pass found that failed renders refunded without limit, a timed-out render's browser could outlive its slot, a ticket could reach Sentry, two requests could share one moment, and the dark routes still parsed bodies while off. All fixed, each with a test (`scene-photos.test.ts`, 19 cases).

## State of things

Everything RFC 0049 lists through slice 5 works on Node and passes `pnpm verify` and `pnpm e2e`. On Cloudflare the code and the cards Worker's `BROWSER` binding deploy, but no photo is taken there until the switch is on, so the Worker path (`packages/cards/cloudflare/scene.ts`) has only been exercised by the spike's scratch Worker, not by this code.

- `pnpm dev:test` restarts the server on every server file edit, and the restart resets the test clock and marks everyone offline: a crowd or an event set up before the edit is gone for photos. Move the clock on again (`POST /v1/test/advance-day?days=N`) until the world's day catches up.
- The Api's own `now()` on Node is the real clock; the world's is the test clock. A scene reads `service.now()`. Plot photos still read the Api's clock, so on a test world their light can disagree with the moved clock.
- Headless Chromium reads as a low-end device, so `/world?view=3d` opens the 2D map there. The photo page doesn't ask.

## Next

1. Switch on, with Ryan's go: set `"TERRAKIN_SCENE_PHOTOS": "on"` in `wrangler.jsonc` vars, take `internal: true` off `takeScenePhoto` and `listPhotoMoments` in `packages/protocol/src/route-table/social.ts`, add the RFC's "Show your owner" paragraph to SKILL.md, a changelog entry, and a devlog post, then `pnpm gen`.
2. After the first live photos, read the `photo.scene` spans for Browser Run's real seconds a render. At 10 s or under, 100 a day stays inside the included 10 browser hours. Past that, lower `SCENE_PHOTO_LIMITS.perDay` or ask Ryan.
3. A moment's `holding` (the made thing in hand) is carried in the scene but not drawn yet: the figure has no held-item slot in 3D.
4. A portrait's plot behind is softened by haze, not depth-of-field blur, which would need a post-processing pass.

## Open questions

- Does Ryan want event photos to default to `wide` (decision 0386)? The RFC's table says `near`.
- First harvest counts a crop kind the collection book has never seen for that resident, so a crop once received as a gift doesn't make a harvest moment later.
