---
title: "Jobs are on at terrakin.org: the Worker sets jobs, the Node server leaves it off, and the switch ships with its docs"
date: 2026-10-11
status: accepted
tags: [server, jobs, deploy]
---

The Node server's half is superseded by [decision 0373](0373-every-node-world-opens-the-systems-terrakin-org-runs-recipes.md): every Node world opens jobs too, and `POST /v1/test/open-jobs` is gone.

# Jobs are on at terrakin.org: the Worker sets jobs, the Node server leaves it off, and the switch ships with its docs

## Context

[RFC 0030](../../rfcs/0030-jobs.md)'s PRs 1 to 5 built jobs in the sim, on the API, and on the web behind `WorldService`'s `jobs` option, which no adapter set ([decision 0260](0260-jobs-reach-the-api-behind-an-option-no-adapter-sets-with-fiv.md), [decision 0261](0261-on-the-web-a-job-is-a-row-at-the-town-hall-a-chip-and-a-toas.md)). PR 6 turns them on. `open_jobs` is a logged input that stays for good, so where it is logged is a choice: a self-hosted or test world shouldn't change under its owner, and the docs shouldn't say jobs are open before a world has them. Levels were turned on the same way a day earlier ([decision 0249](0249-levels-are-on-at-terrakin-org-the-worker-sets-levels-the-nod.md)).

## Decision

- The Worker passes `jobs: true`, in code beside `levels`, with no setting to flip. terrakin.org logs `open_jobs` once, on the first tick after the World object restarts on the new build. The switch waits for levels, which are already open there.
- The Node server doesn't pass it. A self-hosted world, `pnpm dev`, and the e2e servers start without jobs, and a test opens them with `POST /v1/test/open-jobs`.
- The switch, the docs that describe jobs as open (SKILL.md, the changelog entry, `docs/deploy.md`), and the devlog post go out in one push.
- Nothing on the web is turned on. It follows `jobsOpen` on the world snapshot and `jobs` on a profile.

## Consequences

- From the deploy on, a version of the Worker from before `open_jobs` existed in the sim can't be rolled back to: its sim refuses the command and replay stops. Fix forward, as for any new command.
- The first board is whatever the day of the switch gives. With every part of the game open, as on terrakin.org, each of the thirty days from 2026-10-11 has three jobs and one that needs nothing bought, and Halloween's two (candy for Clem, a jack-o'-lantern for Bram) come up on October 27 and 31.
- The eight givers are the founding townsfolk, who hold those handles on terrakin.org, so every job there names its giver's resident, the Town Hall draws them, and each wears a note in the world on the days they ask. A world without them reads "for the town".
- A resident who is here when the switch is logged hears `jobs_opened` once. An agent hears through its check-in: `jobs` is on every answer from then on, the changelog line comes with its first check-in after a day that has the entry, and the daily suggestion names the board once to a resident with a hearth who has finished the first visit. No `todo` line asks for a job.
- A browser tab that was open before the switch keeps its cached profile, so its home wall shows no job card until the page is loaded again. The Town Hall and the world read the snapshot and follow at once.
- The deploy's smoke check looks for `jobsOpen` on `GET /v1/world` (`SNAPSHOT_FIELDS` in `scripts/deploy-smoke.ts`). The World object can keep running the build before for some minutes after an upload, longer than the check waits, so the check can be red on this deploy and green when run again.
- A self-hosted world has no way to turn jobs on short of changing the adapter. If a setting is wanted later, it reads into the same option.
- `packages/server/src/jobs.test.ts` pins that the Worker passes the option once and the Node server never, that a world without the option logs no `open_jobs`, that one with it logs it once right after levels, and that a second `open_jobs` is refused as `already_open`.
- The path was played in a Node world given the Worker's switches: levels and recipes open, the eight townsfolk seeded and named in `TERRAKIN_TOWNSFOLK`, a resident with a hearth from before the switch, then a restart with the option on. The boot logged `open_jobs` once, the board had three jobs with their givers' residents, and a take, a jar of herb tea made and handed in, the `job_done` notice, the check-in's line, and the profile's count all came through.
- Code: `packages/server/cloudflare/worker.ts` (`jobs: true`), `packages/server/src/world-service.ts` (the `jobs` switch in `DAY_SWITCHES`), `scripts/deploy-smoke.ts` (`jobsOpen`).
