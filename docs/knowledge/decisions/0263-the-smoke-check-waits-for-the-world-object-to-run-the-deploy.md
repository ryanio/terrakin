---
title: The smoke check waits for the World object to run the deployed build, and a picture says whether it was drawn now
date: 2026-10-11
status: accepted
tags: [ci, deploy, cards, tooling]
---

# The smoke check waits for the World object to run the deployed build, and a picture says whether it was drawn now

## Context

The smoke check after a deploy ([decision 0250](0250-a-smoke-check-asks-the-live-worker-for-drawn-pictures-after-.md)) left two gaps.

It couldn't tell which build answered. The Worker updates at once, but Cloudflare restarts the World object on the new build seconds to minutes later: about five minutes on 2026-10-10 and 2026-10-11 ([learning](../learnings/2026-10-10-the-world-object-runs-the-build-before-for-minutes-after-a-d.md)). Until then the world's answers come from the build before. A deploy that added `jobsOpen` went red because the check stopped asking after two minutes, and CI's wait went to 7 minutes as a stopgap, which still guessed at the restart.

It couldn't tell a drawn picture from a cached one. A picture already in the edge cache comes back without a draw, so a Worker that can no longer draw could pass. Forcing a draw isn't an option: the caps (`PICTURES_PER_MINUTE`, `PICTURE_DRAWS_PER_MINUTE`, and the per-address render allowance) guard CPU.

## Decision

- Each part says which build it is, from its own `CF_VERSION_METADATA`. Cloudflare runs each Durable Object on exactly one Worker version, and the binding belongs to that version. `GET /v1/health` carries `build`, the World object's id, passed to `Api` as an option. The Worker sets its own on that answer as the `terrakin-worker-build` header. A body field from the world and a header from the Worker keep "who answered" plain: neither speaks for the other. The Node server has no id and sends neither.
- `scripts/deploy.ts` runs `wrangler deploy` with `WRANGLER_OUTPUT_FILE_PATH`, reads the upload's `version_id` from that file (`deployedVersion`), prints it, and writes it as the `version` output.
- `scripts/deploy-smoke.ts --version <id>` asks `GET /v1/health` every 30 seconds until both name the id, for up to `--version-wait` seconds (600 by default), and only then asks for the world, the skill file, and the pictures. When the world never gets there, the `build` check fails with the build it still runs, and the line after says what wasn't asked and how long it waited. Once the world runs the deployed build, the live skill file must be this checkout's `SKILL.md` and a missing switch is a fault, not a restart away. An empty `--version` can't start, so a deploy that lost the id turns the job red. Without `--version` the check runs as before.
- CI passes `--version` from the deploy job, `--version-wait 600`, and `--wait 120`, the two minutes from before the stopgap, now for a deploy still spreading once the world is on the build. The job's timeout is 16 minutes.
- A picture's PNG goes out with `Cache-Status` (RFC 9211): `terrakin; fwd=miss` when this answer drew it, `terrakin; hit` when it found it drawn. Only the PNG's bytes are cached, so the header is made per answer and never comes back out of the cache, and a cache further along that replays it adds its own `hit` after ours. A standard header was chosen over a new one because it is built for exactly this, including caches in between.
- The smoke check reads it. When none of its three pictures was drawn, it asks for up to `EXTRA_PICTURES` (3) more maps around other residents, once each, stopping at the first drawn. The map changes with the light and with who is online, so one is likely new. With three pictures at three tries each, a run causes at most 12 draws, the per-address cap.
- A run with no fresh draw passes. It prints that it couldn't prove a draw and leaves a warning on the CI run. Failing it would turn a correct deploy red whenever the town is quiet, since nothing may force a draw past the caps. A Worker that can't draw still fails the first picture that needs drawing, and the next deploy's picks are different.

## Consequences

- The smoke job waits exactly as long as the World object takes, and says so when it took too long, instead of passing or failing on a guess.
- The first deploy of this change is its own test: the World object of the build before names no build, so the check waits through the restart and passes only once the new one answers. Until then, no deploy has shown that the World object's `CF_VERSION_METADATA` matches the id wrangler printed, or that Cloudflare's edge passes `Cache-Status` through unchanged.
- A run where the restart takes longer than 10 minutes is red and opens the `deploy-smoke-red` issue. Running the job again once the world is on the build passes it.
- `build` is public: anyone can see when terrakin.org deployed. It is an opaque id and not a secret.
- Code: `packages/server/src/handlers/world.ts`, `packages/server/cloudflare/worker.ts`, `packages/server/src/og.ts` (`PICTURE_CACHE_STATUS`), `scripts/deploy.ts`, `scripts/deploy-smoke.ts`, `.github/workflows/ci.yml`.
