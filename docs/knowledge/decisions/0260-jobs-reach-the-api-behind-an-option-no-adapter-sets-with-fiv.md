---
title: Jobs reach the API behind an option no adapter sets, with five events on the wire, the satchel in the wear list, and a merged record handing in what its duplicate made
date: 2026-10-10
status: accepted
tags: [server, protocol, sim, jobs, checkin]
---

# Jobs reach the API behind an option no adapter sets, with five events on the wire, the satchel in the wear list, and a merged record handing in what its duplicate made

## Context

[RFC 0030](../../rfcs/0030-jobs.md)'s PR 4 puts jobs on the API. PRs 1 to 3 left them in the sim, dark ([decision 0255](0255-a-job-pays-10-points-and-three-count-a-week-the-economy-run-.md)). Turning them on is PR 6, so everything PR 4 adds has to work once `open_jobs` is logged and change nothing on the wire before it.

The review of the sim PRs left three things for this one: `checkin-suggest.ts` read `WEAR_INFO` for whatever a resident wears and had no entry for the town satchel; `toWire` dropped a `title_changed` that carried a job's title; and after a merge the kept record couldn't hand in what the duplicate had made. The RFC also leaves open which of the sim's events go out, how a job names its giver, where a resident reads what their count unlocked, and what a finished job's notice holds.

## Decision

- `WorldService` takes `jobs: true`, a switch in the day table after `levels`, due once levels are open. No adapter sets it. A test world opens jobs with `POST /v1/test/open-jobs`, beside `open-levels`: test clock only, this machine only, never in the Worker.
- Five of the sim's job events go out. `jobs_opened` is public. `job_taken`, `job_progress`, `job_done`, and `job_dropped` belong to their resident alone, like `coins` and `progress` (`PRIVATE_EVENTS` in `world-wire.ts`, which `eventsFor` and `run()` read). `job_total`, a merge's bookkeeping, and `job_edition_set` stay on the server: the count is on the profile, and the board is read from `GET /v1/jobs`, never mirrored. A `take_job` for a job a new edition dropped is refused with today's jobs in the message.
- A job's title goes out like a skill's. `TitleName` holds the skills' titles and the two from jobs, `toWire` passes a `title_changed` with either, and a profile's `level.title` shows either.
- The town satchel is in `WEAR_ITEMS`, after the earned garments and before partner wear. So `WEAR_INFO`, the protocol's wear enum, `wearStyle`, and every table keyed by wear have it, and nothing that reads `WEAR_INFO` for what a resident wears can miss it: the type holds every key. The collection book and the look editor leave it out, as they do earned wear, and the look editor lists it only while it's on.
- A merged record can hand in what its duplicate made. `hand_in` counts a thing whose maker was merged into the actor (`state.mergedResidents`) as the actor's own. A merge is one person's two records becoming one, done by a maintainer, and the thing keeps the id that made it, as all history does. A thing anyone else made is still refused. No fixture's hash moved: no log holds a `hand_in` that this accepts or refuses differently.
- `GET /v1/jobs` is the board for anyone. With a token it adds `you`: the job held, today's and this week's counts, the count for good, `canTake` with `why` (the sim's own `takeJobProblem`), and `unlocked`, what the count has unlocked. Without one `you` is `null`, as on the shop and the market. `GET /v1/progress` stays about levels: its `titles` and `wear` are what skills unlocked.
- A job's `from` is the giver's handle and name, fixed words from the protocol's table, with their resident `id` only while a townsfolk holds that handle in this world, the way the shop names its keeper. Without one the job is the town's, and the server's lines say "the town's job".
- The words for each job (`JOB_WORDS`) and each giver's name are in the protocol, since the sim has no use for them. A test fails on a job in any edition without words, and on a line whose count isn't its job's. SKILL.md's table is generated from both.
- A profile carries `jobs`, the count finished, once jobs are open. Townsfolk have none.
- The check-in carries `jobs` (`board`, `held`, `left`) as data, outside the digest. No `todo` line asks for a job. `tryToday` gives `jobs` once, with `take_job` as its tried command, in words that name no job.
- A finished job is one `job_done` notification from Terrakin, stored as its view: the job's fixed words, who asked, the points, the count, and what that count unlocked. The check-in writes one `todo` line for each unread one, which says how to show a title or wear the satchel when the count unlocked it.
- One link route, `/v1/act/<key>/jobs`, lists the board's jobs a link can finish and the job held, and takes `take=<job>`, `drop=yes`, or `hand_in=yes` (or a made thing's id). Teaching, hosting, and games are left off. Every page's "Next" list has the way in once jobs are open, and the link check-in says one line about a job held.
- On the web only what the wider types need: a job's title shows on a profile's chip, and a `job_done` notice is drawn in the server's words. The rest is the RFC's PR 5.

## Consequences

- SKILL.md, the OpenAPI document, and the changelog describe jobs before any world has them. Each says nothing changes until `jobsOpen` is on `GET /v1/world`.
- A world that never logged `open_jobs` reads on the wire as it did. `packages/server/src/jobs.test.ts` pins its reads key by key in a world with levels open. One scenario (two residents, 63 responses and a socket stream, 154,173 bytes) played on this change and on the commit before it differs only in the changelog's new entry, in the four check-ins that list it.
- The bare job page by link is a `once` route, like the pet page, so opened twice within two minutes it answers from memory.
- A resident wearing the satchel parses everywhere a look is read, so its drawings (the 2D figure, the item picture, and the 3D piece) land with the API: `packages/ui/src/figure.ts`, `packages/ui/src/item-art.ts`, `packages/client/src/scene3d/wear.ts`.
- For PR 5: the title picker and the look editor read what jobs unlocked from `you.unlocked` on `GET /v1/jobs`, not from `GET /v1/progress`; `GET /v1/first-visit`'s `tries` now holds `jobs`; and `pnpm persona` has no way to open jobs yet.
- For PR 6: pass `jobs: true` in the Worker. `jobs.test.ts` pins that neither adapter passes it today, and flips then.
- Where this differs from the RFC's sketch of the API: `you` is `null` without a token rather than absent; `you` gains `unlocked`, a held job its `shape`, and `rules` gains `board` and `unlocks`; the notification carries `total` and `unlocks`; and the giver's `id` is absent in a world without that townsfolk, where the RFC showed it always there.
- Code: `packages/protocol/src/jobs.ts` and `job-done.ts` (the notification's shape, apart so the web's first load takes it without the board's views), `packages/server/src/jobs.ts`, `packages/server/src/links/jobs.ts`, `world-service.ts` (the `jobs` switch, `onJobDone`), `world-wire.ts` (`PRIVATE_EVENTS`), `social-service.ts` (`jobDone`), `checkin-suggest.ts` (`TRY_NEXT`), `app.ts` (`TEST_OPEN_JOBS_PATH`), `packages/sim/src/jobs.ts` (`checkHandIn`, `takeJobProblem`), and `packages/server/src/jobs.test.ts`.
