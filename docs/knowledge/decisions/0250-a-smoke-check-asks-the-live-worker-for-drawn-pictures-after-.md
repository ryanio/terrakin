---
title: A smoke check asks the live Worker for drawn pictures after each deploy and a red one opens an issue
date: 2026-10-10
status: accepted
tags: [ci, deploy, cards, tooling]
---

# A smoke check asks the live Worker for drawn pictures after each deploy and a red one opens an issue

## Context

A dependency bump (satori 0.35) passed CI and broke terrakin.org for about a day. The new version loads HarfBuzz through `self.location.href`, which a Worker doesn't have, so every `/og/...png` redirected to the static `/og.png` and `POST /v1/plots/photo` answered `unavailable`. The suite stayed green because it draws in Node. The revert added a test that fails on a satori that loads HarfBuzz ([packages/cards/AGENTS.md](../../../packages/cards/AGENTS.md)), which guards that one cause. Nothing asked the deployed Worker whether it can still draw.

The deploy job's own check was one `GET /v1/health`.

## Decision

- `scripts/deploy-smoke.ts` asks the live site for what only the Worker can prove, with about ten read-only GETs, no token, no resident, and nothing written:
  - `GET /v1/health` answers 200 with `ok` and a `seq`.
  - `GET /v1/world` parses and shows every switch the Worker sets that the snapshot carries. The list is read from the text of `packages/server/cloudflare/worker.ts`, and `SNAPSHOT_FIELDS` says where each shows; a test fails when the Worker sets one with no row.
  - Three pictures the Worker has to draw, picked from that snapshot: a plot someone owns, a resident's look, and the map around a resident. Each must be a 200 `image/png` starting with a PNG's bytes. Redirects aren't followed, so the redirect to `/og.png` that a failed draw sends is a failure.
  - `/skill.md`, `/llms.txt`, and `/changelog.xml` answer 200 with their types.
  - The homepage is HTML that loads a hashed module script, the build's own, and that script answers as JavaScript (a file the assets lack answers 200 with the page's HTML).
- CI runs it in a `smoke` job after `deploy`, only when that run uploaded: `scripts/deploy.ts` writes `deployed` and `script` to the job's outputs, and a run that skipped as superseded skips the smoke check too. Its `if:` has `!cancelled()`, since a job with no status check is skipped whenever a job anywhere before it was, and `e2e` is skipped on pushes that still deploy. Nothing depends on `smoke`, and `deploy`'s `if:` and the `changes` job are as they were ([decision 0200](0200-e2e-keeps-only-journeys-a-lower-test-can-t-prove-with-a-budg.md)).
- It asks again for what failed every 30 seconds for up to 2 minutes. A picture is asked for at most 3 times, so one run causes at most 9 picture requests, under the 12 draws a minute one address may cause.
- A red check fails the run and opens an issue labeled `deploy-smoke-red`, or comments on the open one; the next green check closes it. This is the `nightly-red` pattern, with `issues: write` only.
- Nothing is rolled back automatically. A version that added a sim command can't be rolled back past once that command is in the log ([docs/deploy.md](../../deploy.md)), so a rollback is a person's call.
- The Worker serves no commit or version id, and this adds none. Two stand-ins say which build is live: the homepage must load the script the deploy job built, and the pass line for `/skill.md` says whether it is this checkout's `SKILL.md`.

## Consequences

- A Worker that can't draw turns the run red within a few minutes of the deploy instead of when someone notices a missing preview card.
- A picture already in the edge cache is served without a draw, and the answer doesn't say which happened. CI seeds the pick with the commit, so each deploy asks for a different plot and different residents, and the map around someone changes with the light and the weather. That makes a fresh draw likely, not certain. A response header saying a picture was drawn would close this.
- The World object keeps running the build before for minutes after a deploy ([learning](../learnings/2026-10-10-the-world-object-runs-the-build-before-for-minutes-after-a-d.md)), longer than the check waits. So the health and world checks usually see the old object, and a switch new in a deploy fails its first check; running the job again once the object has restarted passes it and closes the issue. A version id in an answer from both the Worker and the World object would let the check wait for exactly the build it deployed.
- A red smoke check makes the run red, so `scripts/e2e-needed.ts` compares the next push with an older green run and e2e runs on more pushes until a check is green again.
- A newer push cancels a run's smoke check along with the rest of the run. That deploy goes unchecked, and the newer run's check covers what is live after it. The cancelled run isn't green either, so the next push is compared with an older run, as after a red check.
- `POST /v1/plots/photo` isn't checked: it needs a resident and writes an upload. It draws with the same code in the same Worker as the pictures by link.
